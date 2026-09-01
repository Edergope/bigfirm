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
 *
 * PARALELISMO. Los documentos de un lote son INDEPENDIENTES: cada uno se descarga,
 * normaliza, escribe en R2 e indexa por su cuenta, sin leer nada de los demás. Aun así
 * se procesaban en serie —`for (…) { await ingest(…) }`—, de modo que un lote de cuatro
 * tardaba la suma de sus cuatro tiempos en vez del más lento de ellos. Con expedientes
 * reales de 10 o 15 archivos eso convierte la espera en minutos que no hacían falta.
 *
 * El reparto es acotado: la concurrencia tiene techo para no abrir a la vez tantas
 * descargas y llamadas al índice como mensajes traiga el lote. Un fallo individual no
 * arrastra a los demás: cada mensaje decide su propio ack o retry.
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
      message.ack(); // mensaje malformado: no se reintenta
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
