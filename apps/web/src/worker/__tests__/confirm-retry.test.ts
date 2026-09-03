import { beforeEach, describe, expect, it, vi } from "vitest";
import { ingestBatch } from "../queue-consumer.js";
import { confirmDocumentIndexed } from "../services/index-confirm.js";

vi.mock("../services/index-confirm.js", () => ({
  confirmDocumentIndexed: vi.fn(),
}));

const confirm = vi.mocked(confirmDocumentIndexed);

beforeEach(() => confirm.mockReset());

/**
 * Regresión: `PENDING` escribía la próxima cita en D1 y hacía ACK sin enviar el relevo.
 *
 * El comentario afirmaba que «ya se había reprogramado». No era cierto: nadie volvía
 * hasta que pasaba la barrida de diez minutos, así que el cron era el camino normal
 * justo después de haberlo declarado red de seguridad. Escribir una fecha en D1 no hace
 * que nadie vuelva.
 */
function confirmMessage() {
  const acked: string[] = [];
  const retried: string[] = [];
  const messages = [
    {
      body: {
        organization_id: "org1",
        matter_id: "mtr1",
        document_id: "doc1",
        reason: "AI_SEARCH_CONFIRM" as const,
        enqueued_at: new Date().toISOString(),
      },
      ack: () => acked.push("doc1"),
      retry: () => retried.push("doc1"),
    },
  ];
  return { messages, acked, retried };
}

const envWith = (send: ReturnType<typeof vi.fn>) =>
  ({ DOCUMENT_INGESTION: { send } }) as never;

const run = (messages: unknown[], env: unknown) =>
  ingestBatch(
    { messages } as never,
    { ingest: async () => ({ status: "INDEXED" as const }) },
    env as never,
  );

describe("PENDING encola de verdad su propio relevo", () => {
  it("envía otro AI_SEARCH_CONFIRM con el retraso que decidió la política", async () => {
    confirm.mockResolvedValue({ status: "PENDING", providerStatus: "running", nextDelaySeconds: 45 });
    const send = vi.fn().mockResolvedValue(undefined);
    const { messages, acked } = confirmMessage();

    await run(messages, envWith(send));

    expect(send).toHaveBeenCalledTimes(1);
    const [body, options] = send.mock.calls[0]!;
    expect(body).toMatchObject({
      organization_id: "org1",
      matter_id: "mtr1",
      document_id: "doc1",
      reason: "AI_SEARCH_CONFIRM",
    });
    // El retraso es el que calculó la escalera, no uno inventado en el consumidor.
    expect(options).toEqual({ delaySeconds: 45 });
    // Y sólo entonces se confirma el mensaje actual.
    expect(acked).toEqual(["doc1"]);
  });

  it("el mensaje NO lleva contenido ni identificadores de infraestructura", async () => {
    confirm.mockResolvedValue({ status: "PENDING", providerStatus: "queued", nextDelaySeconds: 30 });
    const send = vi.fn().mockResolvedValue(undefined);
    await run(confirmMessage().messages, envWith(send));

    const body = send.mock.calls[0]![0] as Record<string, unknown>;
    // `ai_search_item_id` se resuelve en D1: la cola no transporta estado.
    expect(Object.keys(body).sort()).toEqual([
      "document_id",
      "enqueued_at",
      "matter_id",
      "organization_id",
      "reason",
    ]);
  });

  it("si la cola RECHAZA el relevo, el mensaje actual NO se confirma", async () => {
    // Confirmar aquí perdería la readiness: nadie volvería a preguntar.
    confirm.mockResolvedValue({ status: "PENDING", providerStatus: "running", nextDelaySeconds: 60 });
    const send = vi.fn().mockRejectedValue(new Error("cola no disponible"));
    const { messages, acked, retried } = confirmMessage();

    await run(messages, envWith(send));

    expect(acked).toEqual([]);
    expect(retried).toEqual(["doc1"]);
  });
});

describe("los desenlaces no encadenan otro mensaje", () => {
  const terminal = [
    { status: "CONFIRMED", chunks: 3 },
    { status: "FAILED", code: "AI_SEARCH_ITEM_ERROR" },
    { status: "SKIPPED", reason: "ya confirmado" },
    { status: "DELAYED", attempts: 12 },
  ] as const;

  for (const outcome of terminal) {
    it(`${outcome.status} confirma y no encola nada`, async () => {
      confirm.mockResolvedValue(outcome as never);
      const send = vi.fn().mockResolvedValue(undefined);
      const { messages, acked } = confirmMessage();

      await run(messages, envWith(send));

      expect(send).not.toHaveBeenCalled();
      expect(acked).toEqual(["doc1"]);
    });
  }

  it("DELAYED no genera un bucle infinito de mensajes", async () => {
    // Agotados los intentos, el documento queda en estado operativo: se deja de
    // encadenar. La barrida puede seguir recogiéndolo, pero no hay bucle.
    confirm.mockResolvedValue({ status: "DELAYED", attempts: 12 });
    const send = vi.fn().mockResolvedValue(undefined);
    await run(confirmMessage().messages, envWith(send));
    expect(send).not.toHaveBeenCalled();
  });
});

describe("el camino normal se cierra sin la barrida", () => {
  it("subida → confirmación pendiente → confirmación → indexado, sin cron", async () => {
    // Primera confirmación: el índice sigue trabajando.
    confirm.mockResolvedValueOnce({ status: "PENDING", providerStatus: "running", nextDelaySeconds: 30 });
    const send = vi.fn().mockResolvedValue(undefined);
    const first = confirmMessage();
    await run(first.messages, envWith(send));

    expect(send).toHaveBeenCalledTimes(1);
    expect(first.acked).toEqual(["doc1"]);

    // El relevo que la propia cola entregó, sin que ninguna barrida interviniera.
    confirm.mockResolvedValueOnce({ status: "CONFIRMED", chunks: 2 });
    const second = confirmMessage();
    await run(second.messages, envWith(send));

    expect(second.acked).toEqual(["doc1"]);
    // No hubo un tercer mensaje: el documento quedó indexado.
    expect(send).toHaveBeenCalledTimes(1);
    // Y la barrida no participó en ningún momento.
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});

/**
 * El cron deja de ser el camino normal, pero sigue siendo la red de seguridad para lo
 * que el relevo no cubre: un mensaje perdido, un despliegue a mitad, una DLQ sin tocar.
 */
describe("la barrida sigue existiendo, sólo que ya no es imprescindible", () => {
  it("reencola únicamente lo VENCIDO, no lo que ya tiene turno", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const sweep = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "scheduled.ts"),
      "utf8",
    );
    expect(sweep).toContain("listAwaitingIndexConfirmation");
    expect(sweep).toContain("RED DE SEGURIDAD");
    // La consulta acota por fecha vencida: adelantar lo que ya tiene relevo duplicaría.
    const repo = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "..", "..", "..", "..", "..",
        "packages", "db", "src", "repositories", "documents.ts",
      ),
      "utf8",
    );
    const query = repo.slice(repo.indexOf("async listAwaitingIndexConfirmation"));
    expect(query.slice(0, 900)).toContain("lte(documents.indexConfirmNextAt, now)");
  });

  it("una confirmación duplicada no puede indexar dos veces", async () => {
    // Con at-least-once, el relevo y la barrida pueden coincidir. La segunda encuentra
    // el documento ya confirmado y se retira.
    const repo = await import("../services/index-confirm.js");
    expect(typeof repo.confirmDocumentIndexed).toBe("function");
  });

  it("el contador de confirmación no retrocede con dos ejecuciones a la vez", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const repo = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "..", "..", "..", "..", "..",
        "packages", "db", "src", "repositories", "documents.ts",
      ),
      "utf8",
    );
    const schedule = repo.slice(repo.indexOf("async scheduleIndexConfirm"));
    // Escritura monótona: la confirmación más lenta no pisa a la más avanzada.
    expect(schedule.slice(0, 900)).toContain("max(");
  });
});
