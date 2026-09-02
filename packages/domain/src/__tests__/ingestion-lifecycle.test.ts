import { describe, expect, it } from "vitest";
import {
  INGESTION_LIFECYCLE_TERMS,
  PROCESSING_STALL_MINUTES,
  QUEUE_DELIVERY_MINUTES,
  canRetryIngestion,
  ingestionLifecycle,
  isIngestionInFlight,
} from "../ingestion-lifecycle.js";
import { batchProgress, batchProgressLabel } from "../upload-batch.js";

/**
 * Regresión del incidente de `CC JFRR.pdf` (IUS-2026-016, 2026-09-02).
 *
 * El abogado pulsó «Reintentar», la pantalla dijo «Reintentando…» y el documento volvió
 * a «Procesamiento detenido». La fila NO se tocó: su `updated_at` seguía siendo el
 * segundo de la carga original, `ingestion_attempts` seguía en 0 y no había ni etapa ni
 * código de fallo. El endpoint había devuelto 409 y nadie lo mostró.
 *
 * Dos definiciones de «reintentable» —la pantalla por estado derivado, el servidor por
 * columna cruda— y un estado que mentía: `PROCESSING` se escribía al ENCOLAR.
 */

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

describe("encolar no es procesar", () => {
  it("un documento encolado que nadie ha tomado está EN COLA, no procesando", () => {
    // Éste es el estado real de los cinco documentos del incidente.
    expect(
      ingestionLifecycle({ status: "PROCESSING", attempts: 0, enqueuedAt: minutesAgo(1) }),
    ).toBe("QUEUED");
  });

  it("procesa sólo cuando un consumidor SELLÓ que lo tomó", () => {
    expect(
      ingestionLifecycle({
        status: "PROCESSING",
        attempts: 1,
        heartbeatAt: minutesAgo(1),
      }),
    ).toBe("PROCESSING");
  });

  it("lo que nunca salió de la cola NO se declara «procesamiento detenido»", () => {
    // El bug exacto: diez minutos después de encolar, cinco trabajos que jamás
    // empezaron se describían como trabajos que se habían parado.
    const state = ingestionLifecycle({
      status: "PROCESSING",
      attempts: 0,
      enqueuedAt: minutesAgo(QUEUE_DELIVERY_MINUTES + 30),
    });
    expect(state).toBe("DELIVERY_FAILED");
    expect(state).not.toBe("PROCESSING_STALLED");
    // Y se dice en términos que describen lo que pasó de verdad.
    expect(INGESTION_LIFECYCLE_TERMS[state].label).toBe(
      "No fue posible iniciar el procesamiento",
    );
  });

  it("un trabajo empezado que deja de dar señales SÍ está detenido", () => {
    expect(
      ingestionLifecycle({
        status: "PROCESSING",
        attempts: 1,
        heartbeatAt: minutesAgo(PROCESSING_STALL_MINUTES + 5),
      }),
    ).toBe("PROCESSING_STALLED");
  });

  it("un trabajo empezado y vivo no se declara muerto por antigüedad de la carga", () => {
    // Subido hace una hora, pero la última etapa terminó hace un minuto.
    expect(
      ingestionLifecycle({
        status: "PROCESSING",
        attempts: 1,
        enqueuedAt: minutesAgo(60),
        updatedAt: minutesAgo(60),
        heartbeatAt: minutesAgo(1),
      }),
    ).toBe("PROCESSING");
  });

  it("recién encolado no es un fallo de entrega", () => {
    expect(
      ingestionLifecycle({ status: "PROCESSING", attempts: 0, enqueuedAt: minutesAgo(0) }),
    ).toBe("QUEUED");
  });
});

describe("una sola definición de «reintentable»", () => {
  it("ofrece reintento exactamente donde tiene sentido", () => {
    for (const state of ["ERROR", "UPLOAD_FAILED", "DELIVERY_FAILED", "PROCESSING_STALLED"] as const) {
      expect(canRetryIngestion(state)).toBe(true);
    }
  });

  it("no lo ofrece sobre trabajo en curso ni terminado bien", () => {
    for (const state of ["UPLOADING", "QUEUED", "PROCESSING", "INDEXED", "NOT_INDEXABLE"] as const) {
      expect(canRetryIngestion(state)).toBe(false);
    }
  });

  it("el estado que el abogado veía como reintentable ahora lo es de verdad", () => {
    // Con la evidencia real del documento: PROCESSING crudo, 0 intentos, encolado hace
    // mucho. Antes la pantalla ofrecía el botón y el servidor devolvía 409.
    const state = ingestionLifecycle({
      status: "PROCESSING",
      attempts: 0,
      enqueuedAt: "2026-09-02T03:58:10.091Z",
      updatedAt: "2026-09-02T03:58:10.552Z",
    });
    expect(state).toBe("DELIVERY_FAILED");
    expect(canRetryIngestion(state)).toBe(true);
  });
});

describe("cuándo seguir mirando", () => {
  it("sigue consultando mientras algo avanza, incluido lo que espera turno", () => {
    for (const state of ["UPLOADING", "QUEUED", "PROCESSING"] as const) {
      expect(isIngestionInFlight(state)).toBe(true);
    }
  });

  it("deja de consultar en cuanto nada puede cambiar solo", () => {
    for (const state of [
      "INDEXED",
      "NOT_INDEXABLE",
      "ERROR",
      "UPLOAD_FAILED",
      "DELIVERY_FAILED",
      "PROCESSING_STALLED",
    ] as const) {
      expect(isIngestionInFlight(state)).toBe(false);
    }
  });
});

describe("la cabecera cuenta lo mismo que las filas", () => {
  const many = (spec: Record<string, number>): string[] =>
    Object.entries(spec).flatMap(([s, n]) => Array.from({ length: n }, () => s));

  it("cinco en cola no son cinco procesando ni cinco detenidos", () => {
    const p = batchProgress(many({ QUEUED: 5 }));
    expect(p.total).toBe(5);
    expect(p.stalled).toBe(0);
    expect(batchProgressLabel(p)).not.toContain("detenido");
  });

  it("distingue en cola, procesando, detenido e indexado en el mismo lote", () => {
    const p = batchProgress(many({ INDEXED: 2, PROCESSING: 1, QUEUED: 1, PROCESSING_STALLED: 1 }));
    expect(p.indexed).toBe(2);
    expect(p.stalled).toBe(1);
    const label = batchProgressLabel(p);
    expect(label).toContain("5 archivos cargados");
    expect(label).toContain("2 indexados por IUSIA");
    expect(label).toContain("1 con procesamiento detenido");
  });

  it("un fallo de entrega se cuenta como fallo, no como proceso en curso", () => {
    const p = batchProgress(many({ DELIVERY_FAILED: 5 }));
    expect(p.processing).toBe(0);
    expect(batchProgressLabel(p)).toContain("5 con error");
  });
});

describe("el copy no menciona la maquinaria", () => {
  it("ningún término habla de colas, mensajes ni consumidores", () => {
    for (const term of Object.values(INGESTION_LIFECYCLE_TERMS)) {
      const text = `${term.label} ${term.hint}`.toLowerCase();
      for (const jerga of ["cola", "queue", "mensaje", "consumidor", "worker", "r2", "drive", "oauth"]) {
        expect(text).not.toContain(jerga);
      }
    }
  });

  it("«cargado» dice que el archivo ya es de IUSIA aunque no se haya procesado", () => {
    expect(INGESTION_LIFECYCLE_TERMS.QUEUED.label).toContain("Cargado");
    expect(INGESTION_LIFECYCLE_TERMS.QUEUED.hint).toContain("ya está guardado en IUSIA");
  });
});
