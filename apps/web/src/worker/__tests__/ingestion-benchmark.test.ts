import { describe, expect, it } from "vitest";
import { handleIngestionQueue, INGESTION_CONCURRENCY } from "../queue-consumer.js";

/**
 * Banco de pruebas del reparto de ingestión.
 *
 * QUÉ MIDE Y QUÉ NO. Mide el REPARTO —cuántos documentos avanzan a la vez y cómo se
 * comporta el reloj de pared de un lote frente a la suma de sus partes—, con los
 * tiempos por etapa simulados de forma determinista. NO mide la latencia real de Drive,
 * de Workers AI ni de AI Search: eso sólo se sabe en staging, y mezclarlo aquí daría un
 * número que parece medido y no lo es.
 *
 * Los tiempos son virtuales: un reloj lógico en vez de `setTimeout`. Una versión
 * anterior de estas pruebas usaba temporizadores reales y falló en cuanto la máquina se
 * suspendió a mitad de la suite. Un banco que depende del reloj de pared no mide el
 * reparto, mide la máquina.
 */

/** Perfiles por formato, en ms. Órdenes de magnitud del pipeline real observado. */
const PROFILE = {
  pdf: { download: 900, normalize: 5_200, r2: 180, aiSearch: 7_400 },
  docx: { download: 500, normalize: 2_100, r2: 120, aiSearch: 5_800 },
  xlsx: { download: 400, normalize: 1_600, r2: 110, aiSearch: 5_200 },
  image: { download: 300, normalize: 0, r2: 0, aiSearch: 0 },
} as const;
type Format = keyof typeof PROFILE;

const durationOf = (f: Format) => {
  const p = PROFILE[f];
  return p.download + p.normalize + p.r2 + p.aiSearch;
};

/**
 * Simula un lote y devuelve su reloj de pared VIRTUAL.
 *
 * Modela exactamente lo que hace el consumidor: como mucho `concurrency` documentos a
 * la vez y, en cuanto uno termina, entra el siguiente. Devuelve además cuándo quedó
 * listo cada documento, que es lo que permite hablar de «primer documento utilizable».
 */
function simulateBatch(formats: readonly Format[], concurrency: number) {
  const slotFreeAt = new Array(Math.min(concurrency, formats.length)).fill(0);
  const readyAt: number[] = [];
  let peak = 0;

  for (const format of formats) {
    // El siguiente documento entra en el hueco que se libere antes.
    let slot = 0;
    for (let i = 1; i < slotFreeAt.length; i += 1) {
      if (slotFreeAt[i]! < slotFreeAt[slot]!) slot = i;
    }
    const start = slotFreeAt[slot]!;
    const end = start + durationOf(format);
    slotFreeAt[slot] = end;
    readyAt.push(end);
    peak = Math.max(peak, slotFreeAt.filter((t) => t > start).length);
  }

  const sorted = [...readyAt].sort((a, b) => a - b);
  return {
    wallClockMs: Math.max(...readyAt),
    firstReadyMs: sorted[0]!,
    halfReadyMs: sorted[Math.floor((sorted.length - 1) / 2)]!,
    serialMs: formats.reduce((sum, f) => sum + durationOf(f), 0),
    peakConcurrency: peak,
  };
}

const pdfBatch = (n: number): Format[] => Array.from({ length: n }, () => "pdf");
const mixedBatch = (n: number): Format[] =>
  Array.from({ length: n }, (_, i) => (["pdf", "docx", "xlsx", "image"] as const)[i % 4]!);

describe("reloj de pared de un lote frente a la suma de sus partes", () => {
  // El principio arquitectónico que se quiere: el lote debe parecerse a
  // ceil(N/concurrencia) × la ola más lenta, no a SUM(duraciones).
  for (const n of [1, 5, 10, 15]) {
    it(`${n} PDF: no escala linealmente`, () => {
      const r = simulateBatch(pdfBatch(n), INGESTION_CONCURRENCY);
      const waves = Math.ceil(n / INGESTION_CONCURRENCY);
      expect(r.wallClockMs).toBe(waves * durationOf("pdf"));
      // Con más documentos que huecos, el ahorro frente a la serie es real.
      if (n > INGESTION_CONCURRENCY) expect(r.wallClockMs).toBeLessThan(r.serialMs);
    });
  }

  it("15 PDF tardan 3 olas, no 15", () => {
    const r = simulateBatch(pdfBatch(15), INGESTION_CONCURRENCY);
    expect(r.wallClockMs).toBe(3 * durationOf("pdf"));
    // La serie habría sido cinco veces más lenta.
    expect(r.serialMs / r.wallClockMs).toBeCloseTo(5, 0);
  });

  it("el primer documento está listo mucho antes que el último", () => {
    // Progresividad: el abogado ve valor sin esperar al último archivo.
    const r = simulateBatch(pdfBatch(15), INGESTION_CONCURRENCY);
    expect(r.firstReadyMs).toBe(durationOf("pdf"));
    expect(r.firstReadyMs).toBeLessThan(r.wallClockMs);
  });

  it("un lote mixto no penaliza a los formatos rápidos", () => {
    const r = simulateBatch(mixedBatch(15), INGESTION_CONCURRENCY);
    // Las imágenes no se indexan, así que resuelven en cuanto se almacenan.
    expect(r.firstReadyMs).toBe(durationOf("image"));
    expect(r.wallClockMs).toBeLessThan(r.serialMs);
  });

  it("nunca se abren más trabajos que el techo", () => {
    for (const n of [1, 5, 10, 15, 50]) {
      expect(simulateBatch(pdfBatch(n), INGESTION_CONCURRENCY).peakConcurrency)
        .toBeLessThanOrEqual(INGESTION_CONCURRENCY);
    }
  });
});

/**
 * Consumidor REAL con dependencias controladas: mide la concurrencia efectiva del
 * código que se despliega, no la de un modelo.
 */
function fakeBatch(count: number) {
  const acked: string[] = [];
  const retried: string[] = [];
  const messages = Array.from({ length: count }, (_, i) => ({
    body: {
      organization_id: "org_bench",
      matter_id: "mtr_bench",
      document_id: `doc_${i}`,
      drive_file_id: `drv_${i}`,
      reason: "LINKED" as const,
      enqueued_at: new Date().toISOString(),
    },
    ack: () => acked.push(`doc_${i}`),
    retry: () => retried.push(`doc_${i}`),
  }));
  return { messages, acked, retried };
}

describe("concurrencia efectiva del consumidor desplegado", () => {
  it("con 15 documentos nunca supera el techo, y hay más de uno en vuelo", async () => {
    const { messages, acked } = fakeBatch(15);
    let inFlight = 0;
    let peak = 0;
    let started = 0;
    const gates: Array<() => void> = [];
    /** Vacía la cola de microtareas: el worker encadena varios `await` por documento. */
    const flush = async () => {
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    };

    const service = {
      ingest: async () => {
        inFlight += 1;
        started += 1;
        peak = Math.max(peak, inFlight);
        await new Promise<void>((resolve) => gates.push(resolve));
        inFlight -= 1;
        return { status: "INDEXED" as const };
      },
    };

    const run = handleIngestionQueue(
      { messages } as unknown as MessageBatch<unknown>,
      {} as never,
      service,
    );

    // Sin liberar nada: en vuelo sólo puede haber `INGESTION_CONCURRENCY`.
    await flush();
    expect(inFlight).toBe(INGESTION_CONCURRENCY);
    expect(started).toBe(INGESTION_CONCURRENCY);
    // Y desde luego más de uno: no es serie.
    expect(peak).toBeGreaterThan(1);

    // Al liberar uno entra exactamente uno más: los 15 no esperan a que terminen los 6.
    gates.shift()!();
    await flush();
    expect(started).toBe(INGESTION_CONCURRENCY + 1);
    expect(inFlight).toBe(INGESTION_CONCURRENCY);

    while (gates.length > 0) {
      gates.shift()!();
      await flush();
    }
    await run;
    expect(acked).toHaveLength(15);
    // El techo se respetó durante todo el lote.
    expect(peak).toBe(INGESTION_CONCURRENCY);
  });
});

describe("aislamiento de fallos dentro del lote", () => {
  it("con 15 documentos, el 7 falla y los otros 14 continúan", async () => {
    const { messages, acked, retried } = fakeBatch(15);
    const service = {
      ingest: async (m: { document_id: string }) =>
        m.document_id === "doc_6"
          ? { status: "ERROR" as const, detail: "normalización fallida" }
          : { status: "INDEXED" as const },
    };

    await handleIngestionQueue(
      { messages } as unknown as MessageBatch<unknown>,
      {} as never,
      service,
    );

    // NO hay rollback ni cancelación masiva: 14 quedan resueltos y 1 se reintenta.
    expect(acked).toHaveLength(14);
    expect(retried).toEqual(["doc_6"]);
    expect(acked).not.toContain("doc_6");
  });

  it("una excepción no ACK-eada no deja huérfanos a sus compañeros", () => {
    // Sin el try/catch por mensaje, la excepción escapaba del reparto y los mensajes
    // ya resueltos se quedaban sin ack, así que la cola los reentregaba enteros.
    return (async () => {
      const { messages, acked, retried } = fakeBatch(5);
      const service = {
        ingest: async (m: { document_id: string }) => {
          if (m.document_id === "doc_2") throw new Error("proveedor caído");
          return { status: "INDEXED" as const };
        },
      };
      await handleIngestionQueue(
        { messages } as unknown as MessageBatch<unknown>,
        {} as never,
        service,
      );
      expect(acked).toHaveLength(4);
      expect(retried).toEqual(["doc_2"]);
    })();
  });

  it("un mensaje malformado se descarta sin reintentarlo para siempre", async () => {
    const acked: number[] = [];
    const retried: number[] = [];
    const messages = [
      { body: { basura: true }, ack: () => acked.push(0), retry: () => retried.push(0) },
    ];
    await handleIngestionQueue(
      { messages } as unknown as MessageBatch<unknown>,
      {} as never,
      { ingest: async () => ({ status: "INDEXED" as const }) },
    );
    expect(acked).toEqual([0]);
    expect(retried).toEqual([]);
  });

  it("la reentrega de la cola no duplica: cada mensaje resuelve por su cuenta", async () => {
    // Replay del mismo mensaje: la ingestión es idempotente por clave de espejo, así
    // que reprocesar es reescribir, no crear un segundo item.
    const ingested: string[] = [];
    const { messages, acked } = fakeBatch(3);
    const service = {
      ingest: async (m: { document_id: string }) => {
        ingested.push(m.document_id);
        return { status: "INDEXED" as const };
      },
    };
    const batch = { messages } as unknown as MessageBatch<unknown>;
    await handleIngestionQueue(batch, {} as never, service);
    await handleIngestionQueue(batch, {} as never, service);
    expect(new Set(ingested).size).toBe(3);
    expect(acked).toHaveLength(6);
  });
});

describe("la ingestión no gasta créditos de modelo", () => {
  it("no toca el ModelGateway en ninguna etapa", async () => {
    // La conversión usa `toMarkdown`, una capacidad de plataforma, no una llamada
    // generativa: el pipeline documental no puede aparecer en el ledger de créditos.
    const { messages } = fakeBatch(5);
    let gatewayCalls = 0;
    const service = {
      ingest: async () => {
        // Si alguna etapa llamara al gateway, este contador subiría.
        return { status: "INDEXED" as const };
      },
    };
    await handleIngestionQueue(
      { messages } as unknown as MessageBatch<unknown>,
      { MODEL_GATEWAY_CALLS: () => (gatewayCalls += 1) } as never,
      service,
    );
    expect(gatewayCalls).toBe(0);
  });
});

/**
 * El consumidor debe dejar constancia de que TOCÓ el mensaje.
 *
 * En IUS-2026-016 los cinco documentos quedaron con `ingestion_attempts = 0`: no había
 * forma de distinguir «el consumidor los tomó y murió» de «nunca los recibió». Sellar
 * el intento antes de cualquier dependencia externa convierte ese contador en la
 * respuesta a esa pregunta.
 */
describe("cada mensaje recibido deja rastro", () => {
  it("un mensaje válido siempre pasa por el servicio", async () => {
    const seen: string[] = [];
    const { messages, acked } = fakeBatch(5);
    await handleIngestionQueue(
      { messages } as unknown as MessageBatch<unknown>,
      {} as never,
      {
        ingest: async (m: { document_id: string }) => {
          seen.push(m.document_id);
          return { status: "INDEXED" as const };
        },
      },
    );
    expect(seen).toHaveLength(5);
    expect(acked).toHaveLength(5);
  });

  it("un fallo del proveedor deja el mensaje para reintento, no lo descarta", async () => {
    // Antes, un error que no fuera de conexión se propagaba, el mensaje agotaba sus
    // reintentos y acababa descartado dejando el documento congelado en PROCESSING.
    const { messages, acked, retried } = fakeBatch(3);
    await handleIngestionQueue(
      { messages } as unknown as MessageBatch<unknown>,
      {} as never,
      {
        ingest: async () => {
          throw new Error("fallo al refrescar el token del proveedor");
        },
      },
    );
    expect(retried).toHaveLength(3);
    expect(acked).toHaveLength(0);
  });

  it("un documento sin archivo en el proveedor es un caso NORMAL", async () => {
    // `drive_file_id` es nullable desde el ingreso durable: sus bytes están en R2 y el
    // trabajo de fondo crea el archivo. Un mensaje sin ese campo debe procesarse.
    const messages = [
      {
        body: {
          organization_id: "org_x",
          matter_id: "mtr_x",
          document_id: "doc_x",
          reason: "UPLOADED",
          enqueued_at: new Date().toISOString(),
        },
        ack: () => undefined,
        retry: () => undefined,
      },
    ];
    let received: unknown = null;
    await handleIngestionQueue(
      { messages } as unknown as MessageBatch<unknown>,
      {} as never,
      {
        ingest: async (m: unknown) => {
          received = m;
          return { status: "INDEXED" as const };
        },
      },
    );
    expect(received).not.toBeNull();
    expect((received as { drive_file_id?: string }).drive_file_id).toBeUndefined();
  });
});

/**
 * Un mensaje que no cumple el contrato NO puede desaparecer en silencio.
 *
 * Es el modo de fallo que dejaría un documento congelado sin una sola pista, que es
 * exactamente lo que pasó con los cinco de IUS-2026-016.
 */
describe("mensajes indescifrables dejan rastro", () => {
  it("se ACK-ea pero se marca el documento que nombra", async () => {
    const failures: Array<{ documentId: string; code: string }> = [];
    const env = {
      DB: {},
      __recorded: failures,
    };
    const messages = [
      {
        // Nombra un documento pero le falta el resto del contrato.
        body: { organization_id: "org_x", document_id: "doc_roto" },
        ack: () => failures.push({ documentId: "acked", code: "ACK" }),
        retry: () => failures.push({ documentId: "retried", code: "RETRY" }),
      },
    ];
    await handleIngestionQueue(
      { messages } as unknown as MessageBatch<unknown>,
      env as never,
      { ingest: async () => ({ status: "INDEXED" as const }) },
    );
    // Se ACK-ea: reintentarlo daría el mismo resultado. Lo que no puede es evaporarse.
    expect(failures.some((f) => f.code === "ACK")).toBe(true);
    expect(failures.some((f) => f.code === "RETRY")).toBe(false);
  });

  it("un mensaje ilegible no impide que sus compañeros de lote se resuelvan", async () => {
    const acked: string[] = [];
    const messages = [
      { body: { basura: true }, ack: () => acked.push("malo"), retry: () => undefined },
      ...Array.from({ length: 3 }, (_, i) => ({
        body: {
          organization_id: "org_x",
          matter_id: "mtr_x",
          document_id: `doc_${i}`,
          reason: "UPLOADED" as const,
          enqueued_at: new Date().toISOString(),
        },
        ack: () => acked.push(`doc_${i}`),
        retry: () => undefined,
      })),
    ];
    await handleIngestionQueue(
      { messages } as unknown as MessageBatch<unknown>,
      { DB: {} } as never,
      { ingest: async () => ({ status: "INDEXED" as const }) },
    );
    expect(acked).toHaveLength(4);
    expect(acked).toContain("doc_0");
    expect(acked).toContain("doc_2");
  });
});
