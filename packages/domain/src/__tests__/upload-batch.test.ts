import { describe, expect, it } from "vitest";
import {
  batchProgress,
  batchProgressLabel,
  convocationReadiness,
  documentStatusLabel,
  isTerminalIngestion,
} from "../upload-batch.js";

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
    expect(batchProgressLabel(p)).toBe("12 de 15 documentos preparados");
  });

  it("un archivo con error no convierte el lote en un fallo", () => {
    const p = batchProgress(many({ AI_INDEXED: 14, ERROR: 1 }));
    expect(p.settled).toBe(true);
    // Ni «Error al procesar expediente» ni un lote cancelado: 14 sirven.
    expect(batchProgressLabel(p)).toBe("14 preparados · 1 documento con error");
  });

  it("las imágenes cuentan como preparadas aunque no se indexen", () => {
    // El abogado puede abrirlas; contarlas como pendientes dejaría el lote en «0 de 5»
    // para siempre.
    const p = batchProgress(many({ NOT_INDEXABLE: 5 }));
    expect(p.settled).toBe(true);
    expect(batchProgressLabel(p)).toBe("5 documentos preparados");
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
