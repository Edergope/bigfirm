import { DocumentIngestionMessage } from "@iusia/domain";
import type { Env } from "./env.js";
import { IngestionService } from "./services/ingestion.js";

/**
 * Consumidor de la cola de ingestión documental.
 *
 * Idempotente: reprocesar un mensaje reescribe el mismo espejo R2. Los mensajes
 * que fallan por causa transitoria se reintentan (retry); los que fallan por
 * configuración externa (Drive sin OAuth) se ACK-ean para no llenar la DLQ con un
 * fallo que ningún reintento resolverá — el documento queda PENDIENTE de indexar.
 */
export async function handleIngestionQueue(
  batch: MessageBatch<unknown>,
  env: Env,
): Promise<void> {
  const service = IngestionService.forEnv(env);
  for (const message of batch.messages) {
    const parsed = DocumentIngestionMessage.safeParse(message.body);
    if (!parsed.success) {
      message.ack(); // mensaje malformado: no se reintenta
      continue;
    }
    const outcome = await service.ingest(parsed.data);
    if (outcome.status === "ERROR") {
      message.retry(); // fallo transitorio: reintentar (o a la DLQ tras max_retries)
    } else {
      message.ack();
    }
  }
}
