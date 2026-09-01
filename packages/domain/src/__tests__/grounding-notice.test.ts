import { describe, expect, it } from "vitest";
import { deriveOutcome, groundingNotice, humanizeAgentId } from "../orchestration-view.js";

/**
 * Regresión del incidente «los agentes trabajaron pero el abogado no recibe el
 * trabajo» (exe_xpxvvs1s09x6hp9p, 2026-09-01).
 *
 * La ejecución terminó COMPLETED, los cinco especialistas escribieron análisis reales
 * —25.395 caracteres sólo el de intake— y la pantalla mostraba «Sin evidencia
 * suficiente en el expediente» descartando todas las salidas. La misma pantalla, un
 * bloque más abajo, habría presentado esa conclusión como válida y «Basada en hechos
 * informados»: dos afirmaciones contradictorias sobre la misma ejecución.
 */
describe("la fundamentación se declara, nunca suprime el resultado", () => {
  it("declara fundamentación cuando hubo chunks recuperados", () => {
    const notice = groundingNotice({ documentCount: 3, evidenceChunkCount: 5 });
    expect(notice.tone).toBe("success");
    expect(notice.label).toBe("Fundamentado en el expediente");
    // Nada que advertir: el análisis se apoya en el expediente.
    expect(notice.detail).toBeNull();
  });

  it("advierte con el matiz genérico cuando no había documentos", () => {
    const notice = groundingNotice({ documentCount: 0, evidenceChunkCount: 0 });
    expect(notice.tone).toBe("warning");
    expect(notice.detail).toContain("hechos informados");
  });

  it("nombra la anomalía cuando hay documentos y no se recuperó ninguno", () => {
    const notice = groundingNotice({ documentCount: 2, evidenceChunkCount: 0 });
    expect(notice.tone).toBe("warning");
    // El aviso es específico y accionable: no esconde el fallo tras el copy genérico.
    expect(notice.detail).toContain("2 documentos");
    expect(notice.detail).toContain("indexación");
  });

  it("concuerda el número en singular", () => {
    const notice = groundingNotice({ documentCount: 1, evidenceChunkCount: 0 });
    expect(notice.detail).toContain("1 documento del expediente");
  });

  it("nunca devuelve un aviso que impida entregar el trabajo", () => {
    // El contrato completo: haya o no fundamentación, siempre hay etiqueta y tono,
    // y ninguna combinación produce un estado que corte la entrega.
    for (const documentCount of [0, 1, 7]) {
      for (const evidenceChunkCount of [0, 3]) {
        const notice = groundingNotice({ documentCount, evidenceChunkCount });
        expect(notice.label.length).toBeGreaterThan(0);
        expect(["success", "warning"]).toContain(notice.tone);
      }
    }
  });
});

/**
 * `deriveOutcome` conserva INSUFFICIENT_EVIDENCE porque es una señal cierta y útil
 * —telemetría y avisos—, pero ya no es un estado que oculte las salidas. Lo que
 * cambió es el contrato de presentación, no la verdad del dato.
 */
describe("deriveOutcome sigue distinguiendo el caso sin fundamentación", () => {
  it("marca INSUFFICIENT_EVIDENCE con documentos y cero chunks", () => {
    expect(
      deriveOutcome({ rootStatus: "COMPLETED", evidenceChunkCount: 0, documentCount: 2 }),
    ).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("no lo marca cuando el análisis era de sólo texto", () => {
    expect(
      deriveOutcome({ rootStatus: "COMPLETED", evidenceChunkCount: 0, documentCount: 0 }),
    ).toBe("COMPLETED");
  });

  it("la asimetría que delataba el defecto ya no cambia lo entregado", () => {
    // Antes: sin documentos se entregaba el análisis con un matiz; con documentos que
    // no recuperaron nada se entregaba MENOS. El caso con más insumos daba menos
    // producto. Ahora ambos entregan, y sólo difiere el aviso.
    const sinDocs = groundingNotice({ documentCount: 0, evidenceChunkCount: 0 });
    const conDocs = groundingNotice({ documentCount: 2, evidenceChunkCount: 0 });
    expect(sinDocs.detail).not.toBeNull();
    expect(conDocs.detail).not.toBeNull();
    expect(conDocs.detail).not.toBe(sinDocs.detail);
  });
});

/**
 * Nombre legible cuando el registro no resuelve el agente. El último recurso era el
 * `agent_id` crudo, que no es un nombre sino un identificador de sistema.
 */
describe("humanizeAgentId", () => {
  it("conserva el código de nodo y hace legible el resto", () => {
    expect(humanizeAgentId("03-investigador-normativo-jurisprudencial")).toBe(
      "03 · Investigador normativo jurisprudencial",
    );
  });

  it("funciona sin código de nodo", () => {
    expect(humanizeAgentId("pisoso-orquestador-juridico")).toBe("Pisoso orquestador juridico");
  });

  it("no rompe con una entrada degenerada", () => {
    expect(humanizeAgentId("")).toBe("");
    expect(humanizeAgentId("08")).toBe("08");
  });
});
