import { describe, expect, it } from "vitest";
import { canRetryIngestion, ingestionLifecycle } from "../ingestion-lifecycle.js";
import {
  MAX_FILES_PER_UPLOAD,
  batchProgress,
  convocationReadiness,
  planFileSelection,
} from "../upload-batch.js";

/**
 * Incidente del lote de 17 (IUS-2026-018, 2026-09-03).
 *
 * El abogado seleccionó 17 documentos y aparecieron 9. La auditoría registró
 * `count: 10`, así que el servidor sólo recibió diez: siete se descartaron en el
 * navegador antes de que la petición saliera, por un `slice(0, 10)` mudo.
 */
describe("una selección que no cabe se dice, no se recorta en silencio", () => {
  const names = (n: number) => Array.from({ length: n }, (_, i) => `doc-${i}.pdf`);

  it("una selección que cabe pasa entera y sin aviso", () => {
    const plan = planFileSelection(names(9));
    expect(plan.accepted).toBe(9);
    expect(plan.rejected).toBe(0);
    expect(plan.notice).toBeNull();
  });

  it("17 archivos con el límite anterior: se avisa de los que sobran", () => {
    // Con el techo de 10 que tenía el formulario, siete quedaban fuera.
    const plan = planFileSelection(names(17), 10);
    expect(plan.accepted).toBe(10);
    expect(plan.rejected).toBe(7);
    expect(plan.notice).toContain("17");
    expect(plan.notice).toContain("Quedan 7 fuera");
  });

  it("el techo actual cubre el objetivo de producto de 15 documentos", () => {
    expect(MAX_FILES_PER_UPLOAD).toBeGreaterThanOrEqual(15);
    expect(planFileSelection(names(15)).notice).toBeNull();
    expect(planFileSelection(names(15)).accepted).toBe(15);
  });

  it("el aviso concuerda en singular", () => {
    const plan = planFileSelection(names(11), 10);
    expect(plan.notice).toContain("Queda 1 fuera");
  });

  it("nunca se aceptan más de los que caben", () => {
    for (const n of [1, 25, 26, 100]) {
      expect(planFileSelection(names(n)).accepted).toBeLessThanOrEqual(MAX_FILES_PER_UPLOAD);
    }
  });
});

/**
 * La frase de convocatoria decía «6 de 9 documentos están preparados. Si analizas ahora,
 * 1 quedarán fuera de la evidencia» sobre 6 indexados + 1 procesando + 2 no indexables.
 * Los dos no indexables no aparecían en ninguno de los dos números: 6 + 1 no suman 9.
 */
describe("la cuenta de la evidencia tiene que cuadrar", () => {
  const many = (spec: Record<string, number>): string[] =>
    Object.entries(spec).flatMap(([s, n]) => Array.from({ length: n }, () => s));

  const caso = many({ INDEXED: 6, PROCESSING: 1, NOT_INDEXABLE: 2 });

  it("cada documento cae en exactamente una categoría", () => {
    const p = batchProgress(caso);
    expect(p.indexed + p.processing + p.notIndexable + p.failed + p.stalled + p.queued + p.uploading)
      .toBe(p.total);
  });

  it("los no indexables dejan de ser invisibles", () => {
    const r = convocationReadiness(caso);
    expect(r.usableCount).toBe(6);
    expect(r.pendingCount).toBe(1);
    // Lo que faltaba: decir qué pasa con los otros dos.
    expect(r.statement).toContain("2 no son analizables por su formato");
  });

  it("nombra lo que entra y lo que nunca entrará", () => {
    const r = convocationReadiness(caso);
    expect(r.statement).toContain("6 de 9");
    expect(r.statement).toContain("quedará fuera");
  });

  it("con todo resuelto pero parte inanalizable, no dice que estén los nueve", () => {
    const r = convocationReadiness(many({ INDEXED: 6, NOT_INDEXABLE: 3 }));
    expect(r.ready).toBe(true);
    expect(r.usableCount).toBe(6);
    expect(r.statement).toContain("6 de 9 documentos entrarán al análisis");
    expect(r.statement).not.toContain("Los 9 documentos");
  });

  it("un expediente enteramente preparado se dice sin matices", () => {
    expect(convocationReadiness(many({ INDEXED: 9 })).statement).toBe(
      "Los 9 documentos del expediente están preparados.",
    );
  });

  it("distingue lo que aún puede entrar de lo que ya no", () => {
    const r = convocationReadiness(many({ INDEXED: 4, PROCESSING: 2, ERROR: 1, NOT_INDEXABLE: 1 }));
    // Los dos en curso todavía podrían entrar; el error y el formato, no.
    expect(r.pendingCount).toBe(2);
    expect(r.statement).toContain("no pudo procesarse");
    expect(r.statement).toContain("no es analizable por su formato");
  });
});

/**
 * `ENSAYO ESPECIALIZACION xxx.docx` seguía diciendo «Procesando» ocho minutos después
 * de subirse — y más de una hora después, cuando se escribió esto. Su fila lo explicaba:
 * etapa `INDEXING_DELAYED`, `index_confirm_next_at` en nulo, sin código de fallo. La
 * confirmación se había rendido, nadie iba a volver a por él, y la pantalla seguía
 * mostrando trabajo en curso sin ofrecer «Reintentar».
 */
describe("INDEXING también puede detenerse", () => {
  const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

  it("subido al índice y con latido reciente: sigue en curso", () => {
    expect(ingestionLifecycle({ status: "INDEXING", attempts: 1, heartbeatAt: iso(2) }))
      .toBe("PROCESSING");
  });

  it("subido al índice y sin señales: detenido, no «Procesando» para siempre", () => {
    // Es el caso exacto de ENSAYO: la confirmación se rindió y refrescó el latido; diez
    // minutos después el abogado merece un botón, no un rótulo tranquilizador.
    expect(ingestionLifecycle({ status: "INDEXING", attempts: 8, heartbeatAt: iso(45) }))
      .toBe("PROCESSING_STALLED");
  });

  it("y entonces puede reintentarse", () => {
    expect(canRetryIngestion(
      ingestionLifecycle({ status: "INDEXING", attempts: 8, heartbeatAt: iso(45) }),
    )).toBe(true);
  });

  it("encolado sin que nadie lo tome no se llama detenido aunque sea INDEXING", () => {
    expect(ingestionLifecycle({ status: "INDEXING", attempts: 0, heartbeatAt: iso(45) }))
      .toBe("QUEUED");
  });
});
