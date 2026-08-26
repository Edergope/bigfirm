import { beforeEach, describe, expect, it, vi } from "vitest";

const ingest = vi.fn();

vi.mock("../services/ingestion.js", () => ({
  IngestionService: {
    forEnv: vi.fn(() => ({ ingest })),
  },
}));

import { handleIngestionQueue } from "../queue-consumer.js";

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
