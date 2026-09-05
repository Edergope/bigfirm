import { DocumentRepository, PartitionRepository, createDb } from "@iusia/db";
import type { Env } from "./env.js";


/**
 * Barrida de reconciliación de la sincronización con el proveedor.
 *
 * POR QUÉ EXISTE. `provider_sync_state = DEFERRED` no lo leía nadie: no había cron, ni
 * mensaje de cola, ni reconciliación. Un documento con Drive aplazado se quedaba así
 * para siempre y sus bytes originales nunca salían del ingreso durable. El código
 * afirmaba en un comentario que «se reintenta sola»; no era cierto.
 *
 * El reintento normal lo encola el propio trabajo de ingestión al aplazar. Esta barrida
 * es la RED DE SEGURIDAD para lo que ese camino no cubre: un mensaje que se pierde, un
 * despliegue que cambia mientras había trabajo en vuelo, una DLQ que nadie toca. Sin
 * ella, cualquiera de esas tres cosas deja deuda permanente y silenciosa.
 *
 * Es deliberadamente pequeña: consulta lo vencido, lo reencola con tope y termina. No
 * procesa documentos ni habla con el proveedor — de eso ya se encarga el consumidor.
 */
/**
 * RED DE SEGURIDAD de la confirmación de indexación.
 *
 * NO es el camino normal. El camino normal lo abre el propio trabajo de ingestión, que
 * encola un `AI_SEARCH_CONFIRM` con 30 s de retraso y se reprograma solo mientras el
 * índice siga trabajando. Esta barrida sólo recoge lo VENCIDO: un mensaje que se perdió,
 * un despliegue a mitad, una DLQ que nadie tocó.
 *
 * Antes era el camino primario, y eso significaba que un documento podía esperar hasta
 * diez minutos por haber caído justo después de una barrida. Esa latencia no existía en
 * ningún sitio salvo en nuestra propia arquitectura.
 */
export async function confirmIndexReadiness(env: Env): Promise<{ requeued: number }> {
  const documents = new DocumentRepository(createDb(env.DB));
  const due = await documents.listAwaitingIndexConfirmation(
    new Date().toISOString(),
    SWEEP_BATCH_LIMIT,
    // Un documento varado —sin próxima comprobación programada— se recoge sólo cuando
    // lleva un rato callado, para no pisar a una confirmación que esté en vuelo.
    new Date(Date.now() - ABANDONED_STALE_MINUTES * 60_000).toISOString(),
  );

  let requeued = 0;
  for (const doc of due) {
    try {
      await env.DOCUMENT_INGESTION.send({
        organization_id: doc.organizationId,
        matter_id: doc.matterId,
        document_id: doc.id,
        reason: "AI_SEARCH_CONFIRM",
        enqueued_at: new Date().toISOString(),
      });
      requeued += 1;
    } catch {
      // La cola no aceptó el mensaje: la próxima barrida lo reintenta.
    }
  }
  return { requeued };
}

export async function handleProviderSyncSweep(env: Env): Promise<{ requeued: number }> {
  const documents = new DocumentRepository(createDb(env.DB));
  const due = await documents.listProviderSyncDue(new Date().toISOString(), SWEEP_BATCH_LIMIT);

  let requeued = 0;
  for (const doc of due) {
    try {
      await env.DOCUMENT_INGESTION.send({
        organization_id: doc.organizationId,
        matter_id: doc.matterId,
        document_id: doc.id,
        reason: "PROVIDER_SYNC",
        enqueued_at: new Date().toISOString(),
      });
      requeued += 1;
    } catch {
      // La cola no aceptó el mensaje: se intentará en la próxima barrida. Un fallo aquí
      // no puede tumbar el resto del lote ni dejar la barrida a medias.
    }
  }
  return { requeued };
}

/**
 * Tope por barrida.
 *
 * Un expediente grande con el proveedor caído podría tener cientos de documentos
 * pendientes; reencolarlos todos de golpe convertiría la recuperación en una segunda
 * avalancha contra el mismo proveedor que ya estaba fallando. Se van drenando por
 * tandas, y la espera creciente de cada documento hace el resto.
 */
export const SWEEP_BATCH_LIMIT = 25;


/**
 * Cuánto silencio basta para dar por abandonado un trabajo que nadie cerró.
 *
 * Más largo que el umbral de «detenido» que ve el abogado: primero se le dice la
 * verdad —esto no avanza—, y poco después el sistema intenta arreglarlo solo.
 */
export const ABANDONED_STALE_MINUTES = 15;

/**
 * Techo de rescates automáticos antes de pedir intervención.
 *
 * Reintentar sin fin un documento que siempre muere es la otra forma de no arreglar
 * nada: consume la cola que necesitan los expedientes sanos y nunca lo dice.
 */
export const ABANDONED_MAX_ATTEMPTS = 12;

/**
 * Rescata los documentos que la cola abandonó antes de llegar al índice.
 *
 * En el lote de 19, siete PDF gastaron sus cuatro entregas en cuatro segundos —los tres
 * reintentos cayeron dentro de la misma congestión que los había matado— y acabaron en
 * la cola de descarte, que no tiene consumidor. La única salida era que el abogado
 * pulsara «Reintentar» sobre cada uno. Reparar la infraestructura no es su trabajo.
 *
 * Esta barrida los devuelve a la cola. Con el reintento ya espaciado y el presupuesto de
 * bytes acotado, vuelven a un sistema distinto del que los mató.
 */
export async function recoverAbandonedIngestion(env: Env): Promise<{ requeued: number; abandoned: number }> {
  const documents = new DocumentRepository(createDb(env.DB));
  const staleBefore = new Date(Date.now() - ABANDONED_STALE_MINUTES * 60_000).toISOString();
  const stuck = await documents.listAbandonedIngestion(staleBefore, SWEEP_BATCH_LIMIT);

  let requeued = 0;
  let abandoned = 0;
  for (const doc of stuck) {
    if ((doc.attempts ?? 0) >= ABANDONED_MAX_ATTEMPTS) {
      // Ya no es congestión pasajera. Se dice, con código, y queda reintentable a mano.
      await documents
        .markIngestionFailedAt(
          doc.organizationId,
          doc.id,
          "INGRESS",
          "INGESTION_ABANDONED",
          "La preparación no llegó a completarse tras varios intentos automáticos.",
        )
        .catch(() => undefined);
      abandoned += 1;
      continue;
    }
    try {
      await env.DOCUMENT_INGESTION.send({
        organization_id: doc.organizationId,
        matter_id: doc.matterId,
        document_id: doc.id,
        reason: "UPLOADED",
        enqueued_at: new Date().toISOString(),
      });
      requeued += 1;
    } catch {
      // La cola no lo aceptó: la próxima barrida lo reintenta.
    }
  }
  return { requeued, abandoned };
}


/**
 * Red de seguridad de las particiones.
 *
 * El camino normal es el mismo que el de un documento entero: la parte se sube, se
 * encola su confirmación con retraso, y ésta se reprograma sola mientras el índice
 * siga trabajando. Esta barrida sólo recoge lo que ese camino no cubrió —un mensaje
 * perdido, un despliegue a mitad— y lo VARADO, que es una parte en `INDEXING` sin
 * próxima comprobación programada.
 *
 * Lo varado está aquí desde el primer día precisamente porque en documentos enteros
 * llegó tarde: la barrida buscaba sólo por fecha vencida, y una fecha nula nunca es
 * menor que ahora, así que cuatro documentos se quedaron esperando a nadie.
 */
export async function confirmPartitionReadiness(env: Env): Promise<{ requeued: number }> {
  const partitions = new PartitionRepository(createDb(env.DB));
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - ABANDONED_STALE_MINUTES * 60_000).toISOString();
  const due = await partitions.listAwaitingConfirmation(now, staleBefore, SWEEP_BATCH_LIMIT);
  /*
    Y las que se quedaron sin subir.

    Una parte cuyo trabajo murió —el aislamiento se cayó, la cola agotó sus entregas—
    queda en `PENDING` sin item y sin nadie que vuelva. Es el mismo agujero que dejó
    siete PDF muertos en el lote de 19, y no vale la pena volver a descubrirlo: el
    documento se quedaría incompleto para siempre con las demás partes disponibles,
    que es la peor forma de fallar porque parece que funciona.
  */
  const varadas = await partitions.listStalledUploads(staleBefore, SWEEP_BATCH_LIMIT);

  let requeued = 0;
  for (const [p, reason] of [
    ...due.map((x) => [x, "PARTITION_CONFIRM"] as const),
    ...varadas.map((x) => [x, "PARTITION"] as const),
  ]) {
    try {
      await env.DOCUMENT_INGESTION.send({
        organization_id: p.organizationId,
        matter_id: p.matterId,
        document_id: p.documentId,
        document_version: p.documentVersion,
        partition_ordinal: p.ordinal,
        reason,
        enqueued_at: new Date().toISOString(),
      });
      requeued += 1;
    } catch {
      // La cola no lo aceptó: la próxima barrida lo reintenta.
    }
  }
  return { requeued };
}
