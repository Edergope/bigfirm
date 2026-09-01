import { beforeEach, describe, expect, it, vi } from "vitest";

const ingest = vi.fn();

vi.mock("../services/ingestion.js", () => ({
  IngestionService: {
    forEnv: vi.fn(() => ({ ingest })),
  },
}));

import { handleIngestionQueue,
  mapWithConcurrency,
} from "../queue-consumer.js";

function message(body: unknown) {
  return {
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

const validMessage = {
  organization_id: "org_1",
  matter_id: "mtr_1",
  document_id: "doc_1",
  drive_file_id: "drive_1",
  reason: "LINKED",
  enqueued_at: "2026-08-26T18:00:00.000Z",
};

describe("document ingestion queue consumer", () => {
  beforeEach(() => {
    ingest.mockReset();
  });

  it("ackea mensajes exitosos o no reintentables y reintenta errores transitorios", async () => {
    const malformed = message({ document_id: "sin-campos-requeridos" });
    const indexed = message(validMessage);
    const storageNotConfigured = message({ ...validMessage, document_id: "doc_2" });
    const failed = message({ ...validMessage, document_id: "doc_3" });

    ingest
      .mockResolvedValueOnce({ status: "INDEXED", detail: "r2-key" })
      .mockResolvedValueOnce({ status: "STORAGE_NOT_CONFIGURED" })
      .mockResolvedValueOnce({ status: "ERROR", detail: "AI Search timeout" });

    await handleIngestionQueue(
      { messages: [malformed, indexed, storageNotConfigured, failed] } as unknown as MessageBatch<unknown>,
      {} as never,
    );

    expect(ingest).toHaveBeenCalledTimes(3);
    expect(ingest).toHaveBeenNthCalledWith(1, indexed.body);
    expect(ingest).toHaveBeenNthCalledWith(2, storageNotConfigured.body);
    expect(ingest).toHaveBeenNthCalledWith(3, failed.body);

    expect(malformed.ack).toHaveBeenCalledTimes(1);
    expect(malformed.retry).not.toHaveBeenCalled();

    expect(indexed.ack).toHaveBeenCalledTimes(1);
    expect(indexed.retry).not.toHaveBeenCalled();

    expect(storageNotConfigured.ack).toHaveBeenCalledTimes(1);
    expect(storageNotConfigured.retry).not.toHaveBeenCalled();

    expect(failed.retry).toHaveBeenCalledTimes(1);
    expect(failed.ack).not.toHaveBeenCalled();
  });

  it("un error individual no marca éxito ni duplica decisiones de ack/retry", async () => {
    const failed = message(validMessage);
    ingest.mockResolvedValueOnce({ status: "ERROR", detail: "normalize failed" });

    await handleIngestionQueue(
      { messages: [failed] } as unknown as MessageBatch<unknown>,
      {} as never,
    );

    expect(failed.retry).toHaveBeenCalledTimes(1);
    expect(failed.ack).not.toHaveBeenCalled();
    expect(ingest).toHaveBeenCalledTimes(1);
  });
});

/**
 * Paralelismo del lote de ingestión.
 *
 * Los documentos de un lote son independientes y se procesaban en serie, así que un
 * lote de N tardaba la SUMA de sus tiempos. Con expedientes reales de 10–15 archivos
 * eso son minutos de espera que no hacen falta.
 */
describe("un lote de documentos no se procesa en serie", () => {
  /**
   * Control manual de cada tarea en vez de `setTimeout`.
   *
   * La primera versión de estas pruebas medía concurrencia con temporizadores reales y
   * falló en cuanto el equipo se suspendió a mitad de la suite: una prueba que depende
   * del reloj de pared no prueba el reparto, prueba la máquina.
   */
  function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it("arranca varias tareas a la vez, sin pasar del techo", async () => {
    const gates = Array.from({ length: 10 }, deferred);
    const started: number[] = [];

    const run = mapWithConcurrency([...gates.keys()], 3, async (i) => {
      started.push(i);
      await gates[i]!.promise;
    });

    // Sin resolver nada: sólo pueden estar en vuelo las tres primeras.
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);

    // Al liberar una, entra exactamente una más: el techo se respeta en todo momento.
    gates[0]!.resolve();
    await gates[0]!.promise;
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2, 3]);

    for (const g of gates) g.resolve();
    await run;
    expect(started).toHaveLength(10);
  });

  it("un elemento lento no bloquea a los que vienen detrás", async () => {
    const slow = deferred();
    const finished: number[] = [];

    const run = mapWithConcurrency([0, 1, 2], 3, async (i) => {
      if (i === 0) await slow.promise;
      finished.push(i);
    });

    await Promise.resolve();
    await Promise.resolve();
    // 1 y 2 ya terminaron mientras 0 sigue esperando.
    expect(finished).toEqual([1, 2]);

    slow.resolve();
    await run;
    expect(finished).toEqual([1, 2, 0]);
  });

  it("procesa un lote vacío sin trabajo", async () => {
    let calls = 0;
    await mapWithConcurrency([], 4, async () => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });

  it("no abre más tareas que elementos hay", async () => {
    const started: number[] = [];
    await mapWithConcurrency([1, 2], 8, async (i) => {
      started.push(i);
    });
    expect(started).toEqual([1, 2]);
  });

  it("el fallo de un documento no impide que los demás avancen", async () => {
    const done: number[] = [];
    // `mapWithConcurrency` propaga la excepción; el consumidor la captura por mensaje,
    // que es lo que garantiza que 1 fallo de 15 no tumbe el lote.
    await mapWithConcurrency([0, 1, 2, 3], 2, async (i) => {
      try {
        if (i === 1) throw new Error("documento corrupto");
        done.push(i);
      } catch {
        // el consumidor real hace message.retry() aquí
      }
    });
    expect(done).toEqual([0, 2, 3]);
  });
});
