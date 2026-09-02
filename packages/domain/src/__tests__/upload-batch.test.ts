import { describe, expect, it } from "vitest";
import {
  batchProgress,
  batchProgressLabel,
  convocationReadiness,
  documentStatusLabel,
  isTerminalIngestion,
} from "../upload-batch.js";
import {
  DOCUMENT_INTELLIGENCE_TERMS,
  INGESTION_STALLED_AFTER_MINUTES,
  documentIntelligenceState,
  shouldPollIngestion,
} from "../document-workspace.js";
import { canRetryIngestion } from "../ingestion-lifecycle.js";

/**
 * Carga múltiple y disponibilidad parcial.
 *
 * Un lote NO es una transacción: que un archivo falle no puede convertir la carga en
 * «Error al procesar expediente», y que tres sigan procesándose no puede bloquear los
 * doce que ya están listos.
 */

const many = (spec: Record<string, number>): string[] =>
  Object.entries(spec).flatMap(([status, n]) => Array.from({ length: n }, () => status));

describe("progreso agregado del lote", () => {
  it("cuenta 12 de 15 preparados con 3 en curso", () => {
    const p = batchProgress(many({ AI_INDEXED: 12, PROCESSING: 3 }));
    expect(p.total).toBe(15);
    expect(p.indexed).toBe(12);
    expect(p.processing).toBe(3);
    expect(p.settled).toBe(false);
    // Se distingue tener el archivo a salvo de poder analizarlo: son cosas distintas y
    // la copia anterior las fundía en un solo número ambiguo.
    expect(batchProgressLabel(p)).toBe("15 archivos cargados · 12 indexados por IUSIA · 3 procesando");
  });

  it("un archivo con error no convierte el lote en un fallo", () => {
    const p = batchProgress(many({ AI_INDEXED: 14, ERROR: 1 }));
    expect(p.settled).toBe(true);
    // Ni «Error al procesar expediente» ni un lote cancelado: 14 sirven.
    expect(batchProgressLabel(p)).toBe("15 archivos cargados · 14 indexados por IUSIA · 1 con error");
  });

  it("las imágenes NO se presentan como indexadas por IUSIA", () => {
    // Están cargadas y son consultables, pero IUSIA no las ha leído ni va a hacerlo.
    // Contarlas como «preparadas» sonaba a que sí.
    const p = batchProgress(many({ NOT_INDEXABLE: 5 }));
    expect(p.settled).toBe(true);
    expect(p.indexed).toBe(0);
    expect(p.uploaded).toBe(5);
    expect(batchProgressLabel(p)).toBe("5 archivos cargados · 5 disponibles para consulta");
  });

  it("un lote mixto no afirma que los 15 estén indexados", () => {
    const p = batchProgress(many({ AI_INDEXED: 10, NOT_INDEXABLE: 5 }));
    const label = batchProgressLabel(p);
    expect(label).toContain("15 archivos cargados");
    expect(label).toContain("10 indexados por IUSIA");
    expect(label).toContain("5 disponibles para consulta");
    expect(label).not.toContain("15 indexados");
  });

  it("mientras hay transferencia, la frase habla de carga y no de análisis", () => {
    const p = batchProgress(many({ UPLOADED: 2, UPLOADING: 3 }));
    expect(p.uploading).toBe(3);
    expect(p.uploaded).toBe(2);
    expect(batchProgressLabel(p)).toBe("2 de 5 archivos cargados · 3 subiendo");
  });

  it("un lote terminado no deja nada en curso", () => {
    expect(batchProgress(many({ AI_INDEXED: 3, NOT_INDEXABLE: 1, ERROR: 1 })).settled).toBe(true);
  });

  it("un lote vacío no rompe la frase", () => {
    expect(batchProgressLabel(batchProgress([]))).toBe("Sin documentos");
  });
});

describe("cuándo dejar de preguntar por un documento", () => {
  it("los estados terminales detienen el sondeo", () => {
    // Sondear indefinidamente quince archivos ya terminados es trabajo que nadie pidió.
    for (const s of ["AI_INDEXED", "NOT_INDEXABLE", "ERROR"]) {
      expect(isTerminalIngestion(s)).toBe(true);
    }
  });

  it("lo que sigue en curso se sigue consultando", () => {
    expect(isTerminalIngestion("PROCESSING")).toBe(false);
    expect(isTerminalIngestion("FILE_STORED")).toBe(false);
  });
});

describe("estado por documento en lenguaje del despacho", () => {
  it("no menciona nada de la maquinaria", () => {
    const labels = ["AI_INDEXED", "NOT_INDEXABLE", "ERROR", "PROCESSING", "FILE_STORED"].map(
      (s) => documentStatusLabel(s).label,
    );
    for (const label of labels) {
      for (const jerga of ["cola", "queue", "worker", "chunk", "OCR", "índice", "R2"]) {
        expect(label.toLowerCase()).not.toContain(jerga.toLowerCase());
      }
    }
  });

  it("distingue lo utilizable de lo que sólo se puede abrir", () => {
    expect(documentStatusLabel("AI_INDEXED").label).toBe("Indexado por IUSIA");
    expect(documentStatusLabel("NOT_INDEXABLE").label).toBe("Vista disponible · no indexado");
    expect(documentStatusLabel("ERROR").label).toBe("Error de procesamiento");
  });

  it("no distingue «en cola» de «procesando»", () => {
    // Al abogado no le cambia nada de lo que puede hacer ahora mismo.
    expect(documentStatusLabel("PROCESSING").label).toBe("Procesando");
    expect(documentStatusLabel("UN_ESTADO_FUTURO").label).toBe("Procesando");
  });
});

describe("convocar a IUSIA con documentos aún en proceso", () => {
  it("advierte cuántos quedarían fuera y NO arranca en silencio", () => {
    const r = convocationReadiness(many({ AI_INDEXED: 12, PROCESSING: 3 }));
    expect(r.ready).toBe(false);
    expect(r.usableCount).toBe(12);
    expect(r.pendingCount).toBe(3);
    expect(r.statement).toContain("12 de 15");
    // Lo decisivo: el abogado sabe qué pierde si no espera.
    expect(r.statement).toContain("quedarán fuera");
  });

  it("no advierte cuando el conjunto está completo", () => {
    const r = convocationReadiness(many({ AI_INDEXED: 15 }));
    expect(r.ready).toBe(true);
    expect(r.pendingCount).toBe(0);
  });

  it("con archivos fallidos declara cuántos entran de verdad", () => {
    const r = convocationReadiness(many({ AI_INDEXED: 13, ERROR: 2 }));
    expect(r.ready).toBe(true);
    expect(r.usableCount).toBe(13);
    expect(r.statement).toContain("2 no pudieron procesarse");
  });

  it("un expediente sin documentos es un caso normal", () => {
    const r = convocationReadiness([]);
    expect(r.ready).toBe(true);
    expect(r.statement).toContain("hechos que declares");
  });
});

/**
 * Regresión del incidente de IUS-2026-016 (2026-09-02).
 *
 * Dos fallos con UNA causa: la ruta de carga hablaba con Drive —cuatro carpetas
 * secuenciales, sin cota— antes de escribir la primera fila durable, y sólo insertaba
 * el documento DESPUÉS de que la subida al proveedor terminara. El ledger de aquel
 * expediente tiene `matter.create` y nada más: cero documentos, cero carpetas, ni un
 * evento `document.upload`. Eso es lo que vio el abogado — cinco archivos desaparecidos
 * y, en el segundo intento, «Subiendo» durante más de cinco minutos.
 */
describe("carga durable: el archivo deja de depender del navegador", () => {
  it("«Subiendo» sólo cubre la transferencia", () => {
    expect(documentStatusLabel("UPLOADING").label).toBe("Subiendo");
    // En cuanto los bytes están a salvo, la etiqueta cambia: lo que sigue es de fondo.
    expect(documentStatusLabel("UPLOADED").label).toBe("Cargado · Procesando");
  });

  it("distingue no haber recibido el archivo de no haber podido procesarlo", () => {
    // Un archivo que nunca llegó no puede aparentar estar en camino al índice.
    expect(documentStatusLabel("UPLOAD_FAILED").label).toBe("Error al subir");
    expect(documentStatusLabel("ERROR").label).toBe("Error de procesamiento");
  });

  it("una carga interrumpida es terminal y reintentable, no un limbo", () => {
    expect(isTerminalIngestion("UPLOAD_FAILED")).toBe(true);
    // Y sigue en curso mientras de verdad transfiere.
    expect(isTerminalIngestion("UPLOADING")).toBe(false);
    expect(isTerminalIngestion("UPLOADED")).toBe(false);
  });

  it("cinco archivos recién registrados NO son un expediente vacío", () => {
    // La contradicción que vio el abogado: «Subiendo…» y, a la vez, «Aún no has
    // aportado documentos». Con filas durables desde el primer instante, el total
    // nunca es cero mientras haya archivos en camino.
    const p = batchProgress(many({ UPLOADING: 5 }));
    expect(p.total).toBe(5);
    expect(p.uploading).toBe(5);
    expect(p.uploaded).toBe(0);
    expect(batchProgressLabel(p)).not.toBe("Sin documentos");
  });

  it("un archivo que falla al subir no arrastra a los otros cuatro", () => {
    const p = batchProgress(many({ UPLOADED: 4, UPLOAD_FAILED: 1 }));
    expect(p.total).toBe(5);
    // El que no llegó se cuenta como fallido, y los cuatro siguen su curso.
    expect(p.failed).toBe(1);
    expect(p.processing).toBe(4);
  });

  it("no se puede convocar ignorando archivos que aún se están subiendo", () => {
    // Antes sólo se miraba lo que estaba «procesando»: un archivo todavía en
    // transferencia se habría quedado fuera de la evidencia sin decir nada.
    const r = convocationReadiness(many({ AI_INDEXED: 3, UPLOADING: 2 }));
    expect(r.ready).toBe(false);
    expect(r.usableCount).toBe(3);
    expect(r.pendingCount).toBe(2);
    expect(r.statement).toContain("3 de 5");
  });
});

/**
 * Estado de carga como verdad del SERVIDOR, no del componente.
 *
 * El segundo incidente: el abogado cambió de pestaña, volvió, y «Subiendo…» había
 * desaparecido junto con los archivos. El estado vivía en la mutación de React, así que
 * desmontar el componente lo borraba. Ahora deriva del `ingestion_status` que devuelve
 * el servidor: navegar no puede cambiar lo que hay en D1.
 */
describe("navegar no altera la realidad de los archivos", () => {
  const asDocs = (statuses: string[]) =>
    statuses.map((s) => ({ ingestion_status: s, updated_at: new Date().toISOString() }));

  it("sigue consultando mientras algo está en movimiento", () => {
    expect(shouldPollIngestion(asDocs(["UPLOADING"]))).toBe(true);
    expect(shouldPollIngestion(asDocs(["UPLOADED"]))).toBe(true);
    expect(shouldPollIngestion(asDocs(["PROCESSING"]))).toBe(true);
  });

  it("deja de consultar cuando todo llegó a su destino", () => {
    expect(shouldPollIngestion(asDocs(["AI_INDEXED", "NOT_INDEXABLE", "ERROR"]))).toBe(false);
    expect(shouldPollIngestion(asDocs(["UPLOAD_FAILED"]))).toBe(false);
  });

  it("una transferencia que se quedó a medias no espera para siempre", () => {
    // Si el worker muere durante el envío, la fila quedaría en UPLOADING sin que nadie
    // la vuelva a tocar. Pasado el margen se declara detenida y se puede reintentar.
    const old = new Date(Date.now() - (INGESTION_STALLED_AFTER_MINUTES + 5) * 60_000).toISOString();
    expect(documentIntelligenceState("UPLOADING", old)).toBe("STALLED");
    expect(canRetryIngestion("PROCESSING_STALLED")).toBe(true);
  });

  it("una carga reciente NO se confunde con una detenida", () => {
    expect(documentIntelligenceState("UPLOADING", new Date().toISOString())).toBe("UPLOADING");
  });

  it("cada estado de carga es reintentable o terminal, nunca un limbo", () => {
    expect(canRetryIngestion("UPLOAD_FAILED")).toBe(true);
    expect(canRetryIngestion("ERROR")).toBe(true);
    // Lo que sigue avanzando no ofrece reintento: no hay nada que recuperar todavía.
    expect(canRetryIngestion("UPLOADING")).toBe(false);
    expect(canRetryIngestion("QUEUED")).toBe(false);
    expect(canRetryIngestion("INDEXED")).toBe(false);
  });

  it("los términos de carga no mencionan la maquinaria", () => {
    for (const state of ["UPLOADING", "UPLOAD_FAILED", "UPLOADED"] as const) {
      const term = DOCUMENT_INTELLIGENCE_TERMS[state];
      expect(term.label.length).toBeGreaterThan(0);
      for (const jerga of ["R2", "Drive", "bucket", "OAuth", "provider", "queue"]) {
        expect(`${term.label} ${term.hint}`).not.toContain(jerga);
      }
    }
  });

  it("«Cargado» dice explícitamente que el archivo ya es de IUSIA", () => {
    // Es la frase que cierra la ansiedad: deja de depender del navegador del abogado.
    expect(DOCUMENT_INTELLIGENCE_TERMS.UPLOADED.label).toBe("Cargado · Procesando");
    expect(DOCUMENT_INTELLIGENCE_TERMS.UPLOADED.hint).toContain("ya está guardado en IUSIA");
  });
});

/**
 * Regresión del incidente de los cinco documentos de IUS-2026-016 (2026-09-02 03:58Z).
 *
 * Los cinco quedaron en «Procesamiento detenido» a los diez minutos exactos. La
 * evidencia del ledger: `ingestion_attempts = 0`, `ingestion_started_at = NULL`,
 * `ingestion_timings = NULL` — el consumidor nunca llegó a marcarlos como empezados.
 * La UI los declaró muertos por PURA ARITMÉTICA sobre `updated_at`, sin un solo dato
 * sobre su estado real, y la cabecera decía a la vez «5 procesando».
 */
describe("«detenido» debe significar algo, no sólo antigüedad", () => {
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

  it("un trabajo que sigue dando señales NO se declara detenido", () => {
    // Subido hace media hora, pero la última etapa terminó hace un minuto: está vivo.
    // Antes esto era «Procesamiento detenido» y el abogado veía muerto lo que trabajaba.
    expect(
      documentIntelligenceState("PROCESSING", minutesAgo(30), new Date(), minutesAgo(1)),
    ).toBe("PROCESSING");
  });

  it("un trabajo sin señales durante el margen SÍ se declara detenido", () => {
    expect(
      documentIntelligenceState("PROCESSING", minutesAgo(30), new Date(), minutesAgo(20)),
    ).toBe("STALLED");
  });

  it("sin latido se cae a la marca de actualización, como antes", () => {
    // Documentos anteriores a la instrumentación: el comportamiento no cambia.
    expect(documentIntelligenceState("PROCESSING", minutesAgo(30))).toBe("STALLED");
    expect(documentIntelligenceState("PROCESSING", minutesAgo(1))).toBe("PROCESSING");
  });

  it("el latido no resucita un estado terminal", () => {
    expect(
      documentIntelligenceState("AI_INDEXED", minutesAgo(90), new Date(), minutesAgo(90)),
    ).toBe("INDEXED");
    expect(documentIntelligenceState("ERROR", minutesAgo(90), new Date(), minutesAgo(1))).toBe(
      "ERROR",
    );
  });
});

describe("la cabecera no puede contradecir a las filas", () => {
  it("cinco detenidos NO se cuentan como cinco procesando", () => {
    // El bug exacto: cabecera «5 archivos cargados · 5 procesando» con las cinco filas
    // en «Procesamiento detenido». Eran dos derivaciones distintas del mismo dato.
    const p = batchProgress(many({ STALLED: 5 }));
    expect(p.stalled).toBe(5);
    expect(p.processing).toBe(0);
    const label = batchProgressLabel(p);
    expect(label).toContain("5 con procesamiento detenido");
    expect(label).not.toContain("5 procesando");
  });

  it("un lote mixto refleja cada estado tal cual", () => {
    const p = batchProgress(many({ INDEXED: 3, PROCESSING: 1, ERROR: 1 }));
    const label = batchProgressLabel(p);
    expect(label).toContain("5 archivos cargados");
    expect(label).toContain("3 indexados por IUSIA");
    expect(label).toContain("1 procesando");
    expect(label).toContain("1 con error");
  });

  it("todo indexado se dice sin ruido", () => {
    expect(batchProgressLabel(batchProgress(many({ INDEXED: 5 })))).toBe(
      "5 archivos cargados · 5 indexados por IUSIA",
    );
  });

  it("un lote detenido está asentado: ya no va a cambiar solo", () => {
    // La barra de avance debe terminar aunque no acabe en verde.
    expect(batchProgress(many({ STALLED: 5 })).settled).toBe(true);
  });

  it("acepta tanto el estado derivado como el crudo para lo indexado", () => {
    // La cabecera recibe estados derivados; algunas rutas todavía pasan el crudo.
    expect(batchProgress(["INDEXED"]).indexed).toBe(1);
    expect(batchProgress(["AI_INDEXED"]).indexed).toBe(1);
  });
});
