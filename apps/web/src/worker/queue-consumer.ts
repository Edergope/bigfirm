import { DocumentIngestionMessage } from "@iusia/domain";
import { DocumentRepository, createDb } from "@iusia/db";
import type { Env } from "./env.js";
import { IngestionService } from "./services/ingestion.js";

/**
 * Consumidor de la cola de ingestión documental.
 *
 * Idempotente: reprocesar un mensaje reescribe el mismo espejo R2. Los mensajes
 * que fallan por causa transitoria se reintentan (retry); los que fallan por
 * configuración externa (Drive sin OAuth) se ACK-ean para no llenar la DLQ con un
 * fallo que ningún reintento resolverá — el documento queda PENDIENTE de indexar.
 *
 * PARALELISMO. Los documentos de un lote son INDEPENDIENTES: cada uno se descarga,
 * normaliza, escribe en R2 e indexa por su cuenta, sin leer nada de los demás. El
 * reparto es acotado para no abrir a la vez tantas descargas y llamadas al índice como
 * mensajes traiga el lote, y un fallo individual no arrastra a los demás: cada mensaje
 * decide su propio ack o retry.
 *
 * RASTRO DE ENTREGA. Todo mensaje que llega aquí deja constancia en la fila del
 * documento ANTES de tocar ninguna dependencia externa. Los cinco documentos de
 * IUS-2026-016 quedaron con `ingestion_attempts = 0` y no hubo forma de saber si el
 * consumidor los había tomado y muerto o si nunca los recibió; esa pregunta no puede
 * volver a quedar sin respuesta.
 */
export async function handleIngestionQueue(
  batch: MessageBatch<unknown>,
  env: Env,
  /**
   * Costura para medir el reparto con dependencias controladas. En producción se
   * resuelve del entorno; ningún llamador real la pasa.
   */
  service: Pick<IngestionService, "ingest"> = IngestionService.forEnv(env),
): Promise<void> {
  await mapWithConcurrency(batch.messages, INGESTION_CONCURRENCY, async (message) => {
    const parsed = DocumentIngestionMessage.safeParse(message.body);
    if (!parsed.success) {
      // Un mensaje que no cumple el contrato NO desaparece en silencio. Se ACK-ea
      // —reintentarlo daría el mismo resultado— pero se deja constancia en el documento
      // que nombra, si es que nombra alguno, para que quede visible y reintentable.
      await recordUndeliverable(env, message.body, parsed.error.issues.length);
      message.ack();
      return;
    }
    try {
      const outcome = await service.ingest(parsed.data);
      if (outcome.status === "ERROR") {
        message.retry(); // fallo transitorio: reintentar (o a la DLQ tras max_retries)
      } else {
        message.ack();
      }
    } catch {
      // Que un documento reviente NO puede tumbar a sus compañeros de lote: se
      // reintenta sólo él. Sin este catch, una excepción escapaba del map y los
      // mensajes ya resueltos quedaban sin ack.
      message.retry();
    }
  });
}

/**
 * Deja rastro de un mensaje que no se pudo interpretar.
 *
 * Se hace con el mínimo de suposiciones: si el cuerpo trae algo que parece una
 * organización y un documento, se marca esa fila; si no, no hay nada que marcar y el
 * mensaje se descarta sin más. Nunca lanza: el rastro no puede convertirse en la causa
 * de que el lote falle.
 */
async function recordUndeliverable(
  env: Env,
  body: unknown,
  issueCount: number,
): Promise<void> {
  const shape = body as { organization_id?: unknown; document_id?: unknown } | null;
  if (
    shape === null ||
    typeof shape !== "object" ||
    typeof shape.organization_id !== "string" ||
    typeof shape.document_id !== "string"
  ) {
    return;
  }
  try {
    const documents = new DocumentRepository(createDb(env.DB));
    await documents.markIngestionFailedAt(
      shape.organization_id,
      shape.document_id,
      "INGRESS",
      "MESSAGE_SCHEMA_INVALID",
      `El mensaje de ingestión no cumple el contrato (${issueCount} campos inválidos).`,
    );
  } catch {
    // Sin base de datos no hay rastro que dejar; el mensaje se descarta igualmente.
  }
}

/**
 * Documentos que se procesan a la vez dentro de un lote.
 *
 * Cada ingestión abre una descarga desde el proveedor de almacenamiento, una escritura
 * en R2 y una subida al índice. El techo evita que un lote grande dispare todas esas
 * conexiones a la vez y acabe estrangulándose a sí mismo; queda por encima del
 * `max_batch_size` de staging (4), así que hoy el lote entero avanza en paralelo.
 */
export const INGESTION_CONCURRENCY = 6;

/**
 * Recorre los elementos con un número acotado de tareas simultáneas.
 *
 * No usa `Promise.all` sobre todo el arreglo —eso es concurrencia ilimitada— ni un
 * bucle secuencial. Cada worker toma el siguiente índice pendiente, de modo que un
 * elemento lento no bloquea a los que vienen detrás.
 */
export async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      await fn(items[index]!);
    }
  });
  await Promise.all(workers);
}
