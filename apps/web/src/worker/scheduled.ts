import { DocumentRepository, createDb } from "@iusia/db";
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
