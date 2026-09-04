import { DocumentIngestionMessage } from "@iusia/domain";
import { DocumentRepository, createDb } from "@iusia/db";
import type { Env } from "./env.js";
import { IngestionService } from "./services/ingestion.js";
import { confirmDocumentIndexed } from "./services/index-confirm.js";

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
   * Tercer argumento del runtime: `ExecutionContext`. No se usa, pero DEBE figurar en
   * la firma.
   *
   * Aquí estuvo el fallo que dejó cinco documentos sin procesar durante días. La firma
   * era `(batch, env, service = IngestionService.forEnv(env))`, con el servicio como
   * costura de pruebas en la tercera posición. Cloudflare invoca
   * `queue(batch, env, ctx)`, así que ese valor por defecto NUNCA se aplicaba:
   * `service` era el `ExecutionContext`, `service.ingest` no existía, cada mensaje
   * lanzaba un TypeError, el catch lo mandaba a reintentar y tras agotar los tres
   * intentos acababa en la cola de descarte. Sin una sola escritura en D1, que es por
   * lo que `ingestion_attempts` se quedó en 0 y no había ni etapa ni código de fallo.
   *
   * Las pruebas pasaban porque llamaban a la función con el servicio en esa posición
   * —exactamente la forma que producción no usa nunca—. La costura ahora es
   * `ingestBatch`, que no puede colisionar con la convención del runtime.
   */
  _ctx?: unknown,
): Promise<void> {
  return ingestBatch(batch, IngestionService.forEnv(env), env);
}

/**
 * Procesa un lote con un servicio de ingestión dado.
 *
 * Es el cuerpo real y la costura de pruebas. Separarlo del handler es deliberado: el
 * handler tiene la firma que el runtime impone y nada más, de modo que ningún parámetro
 * de conveniencia pueda volver a ocupar una posición que Cloudflare ya usa.
 */
export async function ingestBatch(
  batch: MessageBatch<unknown>,
  service: Pick<IngestionService, "ingest">,
  env: Env,
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
      // Lo que Cloudflare afirma del mensaje viaja al servicio para persistirse. Sin
      // esto, `ingestion_attempts` era el único dato y había que leer el código para
      // saber qué significaba.
      const delivery = {
        messageId: (message as { id?: string }).id,
        attempt: (message as { attempts?: number }).attempts,
        timestamp: (message as { timestamp?: Date }).timestamp?.toISOString?.(),
      };
      /*
        MENSAJE DISCRIMINADO. `AI_SEARCH_CONFIRM` no es una ingestión: sólo pregunta al
        índice si el item que ya subimos terminó y si el documento se recupera. Tratarlo
        como una ingestión más volvería a subir el contenido y a ocupar un consumidor.
      */
      if (parsed.data.reason === "AI_SEARCH_CONFIRM") {
        const outcome = await confirmDocumentIndexed(env, {
          organizationId: parsed.data.organization_id,
          matterId: parsed.data.matter_id,
          documentId: parsed.data.document_id,
        });

        /*
          REPROGRAMACIÓN REAL.

          `confirmDocumentIndexed` decide y persiste `index_confirm_next_at`, pero
          escribir una fecha en D1 no hace que nadie vuelva. Aquí se hacía `ack()` sin
          más, con un comentario que afirmaba que el trabajo «ya se había reprogramado»:
          no era cierto, y el único que rescataba la confirmación era la barrida de diez
          minutos. Es decir, el cron era el camino normal justo después de haber
          declarado que sería sólo una red de seguridad.

          El mensaje siguiente se envía AQUÍ, que es donde está la cola, y el actual sólo
          se confirma cuando ese envío ha resuelto.
        */
        if (outcome.status === "PENDING") {
          try {
            await env.DOCUMENT_INGESTION.send(
              {
                organization_id: parsed.data.organization_id,
                matter_id: parsed.data.matter_id,
                document_id: parsed.data.document_id,
                reason: "AI_SEARCH_CONFIRM",
                enqueued_at: new Date().toISOString(),
              },
              { delaySeconds: outcome.nextDelaySeconds },
            );
          } catch {
            // La cola no aceptó el relevo: NO se confirma este mensaje. Reintentarlo es
            // preferible a perder la confirmación, y la barrida sigue como respaldo.
            retryLater(message);
            return;
          }
        }

        // CONFIRMED, FAILED, SKIPPED y DELAYED son desenlaces: no encadenan otro
        // mensaje. PENDING sólo llega aquí con su relevo ya aceptado por la cola.
        message.ack();
        return;
      }

      const outcome = await service.ingest(parsed.data, delivery);
      if (outcome.status === "ERROR") {
        retryLater(message); // fallo transitorio: reintentar (o a la DLQ tras max_retries)
      } else {
        message.ack();
      }
    } catch {
      // Que un documento reviente NO puede tumbar a sus compañeros de lote: se
      // reintenta sólo él. Sin este catch, una excepción escapaba del map y los
      // mensajes ya resueltos quedaban sin ack.
      retryLater(message);
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
 * Reintenta un mensaje ESPERANDO antes de volver.
 *
 * `message.retry()` sin más devuelve el mensaje casi al instante. En el lote de 19 eso
 * fue letal: siete documentos consumieron sus cuatro entregas —una inicial y los tres
 * reintentos— en CUATRO SEGUNDOS, entre las 16:23:36 y las 16:23:43. Los tres reintentos
 * se gastaron dentro de la misma congestión que había causado el fallo, y sin haber
 * cambiado nada. Después, a la cola de descarte, que no tiene consumidor.
 *
 * Un reintento sólo sirve si el mundo ha tenido ocasión de cambiar. La espera crece con
 * el número de entregas que Cloudflare declara, así que el último intento llega más de
 * un minuto después del primero en vez de un segundo después.
 */
export function retryLater(message: Message<unknown>): void {
  const attempt = (message as { attempts?: number }).attempts ?? 1;
  message.retry({ delaySeconds: retryDelaySeconds(attempt) });
}

/** 10 s, 30 s, 90 s… con techo. Suficiente para que una congestión pase. */
export function retryDelaySeconds(attempt: number): number {
  return Math.min(10 * 3 ** Math.max(0, attempt - 1), 300);
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
 * Bytes de documento que pueden estar en vuelo a la vez DENTRO de una invocación.
 *
 * Ésta es la cota que faltaba, y su ausencia es la causa raíz del lote de 19.
 *
 * Lo que muestra el libro de intentos: siete documentos abrieron cuatro entregas cada
 * uno —veintiocho en total— y NINGUNA se cerró. Ni un `completed_at`, ni una etapa
 * final, ni un código de fallo. Eso no es trabajo que falla: el `try/catch` de cada
 * mensaje habría dejado rastro. Es el aislamiento entero muriéndose con todos sus
 * mensajes dentro, que es lo único que ningún `catch` puede sobrevivir.
 *
 * Y encaja con los tamaños. Los dos lotes que murieron arrancaron a las 16:23:36 y
 * 16:23:37, solapándose con un tercero que seguía procesando 17 MB, 7,8 MB y 5,4 MB.
 * Sumando lo que había abierto a la vez —cada PDF se lee entero a memoria, y luego se
 * copia otra vez a un Blob para convertirlo— se pasa de sobra el presupuesto de un
 * aislamiento.
 *
 * Contar documentos no sirve: cuatro PDF de 100 KB y cuatro de 13 MB son el mismo
 * número y no el mismo problema. Se cuenta lo que de verdad se consume.
 */
export const INGESTION_INFLIGHT_BYTES = 24 * 1024 * 1024;

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
