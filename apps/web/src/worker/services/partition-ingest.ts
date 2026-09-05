import {
  PARTITION_MAX_BYTES,
  partitionKey,
  partitionText,
  type DocumentIngestionMessage,
} from "@iusia/domain";
import { DocumentRepository, PartitionRepository, createDb } from "@iusia/db";
import type { Env } from "../env.js";
import { AiSearchRetrievalProvider } from "../integrations/ai-search.js";
import {
  INDEX_CONFIRM_MAX_ATTEMPTS,
  INDEX_CONFIRM_SLOW_DELAY_S,
  INDEX_CONFIRM_SLOW_MAX_ATTEMPTS,
  indexConfirmDelaySeconds,
  indexMetadata,
  uploadToAiSearch,
} from "./ingestion.js";

/**
 * Documentos que no caben en un item del índice.
 *
 * TODO LO PESADO SE REUTILIZA. La subida al índice, la metadata de aislamiento, la
 * recuperación exacta y la contrapresión son las mismas que usa un documento normal;
 * aquí sólo está lo que cambia: repartir el texto, encolar cada parte por la MISMA cola
 * con `reason` discriminado, y llevar la cuenta de cuántas están listas.
 *
 * No hay orquestador de particiones, ni cola nueva, ni Durable Object. Un documento de
 * cien páginas produce N mensajes en la cola que ya existe, y esa cola ya sabe
 * repartirlos con un techo de invocaciones concurrentes, reintentarlos con espera y
 * mandarlos a la cola de descarte si se agotan — cuatro mecanismos que habría que
 * duplicar y mantener sincronizados si abriéramos otra.
 */

/**
 * Mensajes de partición que se encolan de una vez.
 *
 * Un documento de diez mil páginas no puede convertirse en diez mil `send()` dentro de
 * una invocación: se acaba el tiempo y el presupuesto de subpeticiones mucho antes.
 * `sendBatch` admite hasta cien, y se reparte en tandas de este tamaño con el resto
 * pendiente registrado en D1, de modo que reencolarlo es reanudar, no empezar.
 */
export const PARTITION_ENQUEUE_BATCH = 50;

/**
 * Cuánto texto de la parte se usa como sonda de recuperación.
 *
 * Suficiente para que la parte sea su propio mejor resultado, y corto para no convertir
 * cada comprobación en una consulta cara.
 */
const RETRIEVAL_PROBE_CHARS = 400;

/**
 * Reparte un texto grande en partes, las deja en R2 y encola su trabajo.
 *
 * Devuelve cuántas partes tiene el documento. El documento NO se marca indexado aquí:
 * lo estará cuando sus partes lo estén, y estará disponible en cuanto lo esté la
 * primera.
 */
export async function planPartitions(
  env: Env,
  message: DocumentIngestionMessage,
  doc: { currentVersion: number },
  text: string,
): Promise<number> {
  const db = createDb(env.DB);
  const partitions = new PartitionRepository(db);

  const parts = partitionText(text, PARTITION_MAX_BYTES);

  /*
    Los bytes van a R2 ANTES de encolar nada. Si se encolara primero, un mensaje podría
    llegar a un consumidor antes de que exista el objeto que debe subir, y ese consumidor
    no tendría forma de distinguir «todavía no está» de «no existe».
  */
  for (const part of parts) {
    const key = partitionKey(
      message.organization_id,
      message.matter_id,
      message.document_id,
      part.ordinal,
    );
    await env.ARTIFACTS.put(key, part.text, {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
      customMetadata: {
        organization_id: message.organization_id,
        matter_id: message.matter_id,
        document_id: message.document_id,
        document_version: String(doc.currentVersion),
        partition_ordinal: String(part.ordinal),
      },
    });
  }

  await partitions.createPlan({
    organizationId: message.organization_id,
    matterId: message.matter_id,
    documentId: message.document_id,
    documentVersion: doc.currentVersion,
    partitions: parts.map((p) => ({
      ordinal: p.ordinal,
      sourceKey: partitionKey(
        message.organization_id,
        message.matter_id,
        message.document_id,
        p.ordinal,
      ),
      bytes: p.bytes,
    })),
  });

  await enqueuePartitions(env, message, doc.currentVersion, parts.map((p) => p.ordinal));
  return parts.length;
}

/**
 * Encola trabajo de partición en tandas acotadas.
 *
 * Nunca `Promise.all` sobre el arreglo entero: diez mil promesas simultáneas son diez
 * mil promesas simultáneas, y el aislamiento se muere igual que se murió con los PDF
 * del lote de 19.
 */
export async function enqueuePartitions(
  env: Env,
  message: Pick<DocumentIngestionMessage, "organization_id" | "matter_id" | "document_id">,
  documentVersion: number,
  ordinals: readonly number[],
): Promise<void> {
  for (let i = 0; i < ordinals.length; i += PARTITION_ENQUEUE_BATCH) {
    const tanda = ordinals.slice(i, i + PARTITION_ENQUEUE_BATCH);
    await env.DOCUMENT_INGESTION.sendBatch(
      tanda.map((ordinal) => ({
        body: {
          organization_id: message.organization_id,
          matter_id: message.matter_id,
          document_id: message.document_id,
          document_version: documentVersion,
          partition_ordinal: ordinal,
          reason: "PARTITION" as const,
          enqueued_at: new Date().toISOString(),
        },
      })),
    );
  }
}

export type PartitionOutcome =
  | { status: "INDEXING" }
  | { status: "READY" }
  | { status: "PENDING"; nextDelaySeconds: number }
  | { status: "FAILED"; code: string }
  | { status: "SKIPPED"; reason: string };

/**
 * Sube UNA parte al índice.
 *
 * El aislamiento se revalida contra D1 con las cuatro claves más el ordinal: lo que el
 * mensaje afirma no autoriza nada. Un mensaje forjado desde otra organización no
 * encuentra fila y se descarta sin tocar nada.
 */
export async function ingestPartition(
  env: Env,
  message: DocumentIngestionMessage,
): Promise<PartitionOutcome> {
  const ordinal = message.partition_ordinal;
  const documentVersion = message.document_version;
  if (!ordinal || !documentVersion) return { status: "SKIPPED", reason: "mensaje incompleto" };

  const db = createDb(env.DB);
  const partitions = new PartitionRepository(db);
  const row = await partitions.findForJob({
    organizationId: message.organization_id,
    matterId: message.matter_id,
    documentId: message.document_id,
    documentVersion,
    ordinal,
  });
  if (!row) return { status: "SKIPPED", reason: "partición inexistente o fuera de alcance" };
  if (row.state === "READY") return { status: "SKIPPED", reason: "ya disponible" };

  /*
    IDEMPOTENCIA. Una reentrega no vuelve a subir: si la parte ya tiene identidad de
    item, se reutiliza. Con entrega «al menos una vez» eso es la diferencia entre un
    item y dos, y dos items de la misma parte cuentan doble en la recuperación.
  */
  if (row.aiSearchItemId) {
    return { status: "INDEXING" };
  }

  const object = await env.ARTIFACTS.get(row.sourceKey);
  if (!object) {
    await partitions.markFailed(row.id, "PARTITION_SOURCE_MISSING", "El contenido de esta parte no está disponible.");
    return { status: "FAILED", code: "PARTITION_SOURCE_MISSING" };
  }
  const text = await object.text();

  const item = await uploadToAiSearch(
    env.AI_SEARCH ?? null,
    row.sourceKey,
    text,
    indexMetadata({
      organizationId: message.organization_id,
      matterId: message.matter_id,
      documentId: message.document_id,
      documentVersion,
    }),
  );
  /*
    Sin identidad de item no hay nada que confirmar después, y marcarla como subida
    dejaría una parte que nadie puede comprobar y de la que nadie volverá a saber. Se
    declara fallida, que es reintentable, en vez de fingir que avanzó.
  */
  if (!item.id) {
    await partitions.markFailed(
      row.id,
      "PARTITION_ITEM_MISSING",
      "El índice aceptó la parte pero no devolvió su identificador.",
    );
    return { status: "FAILED", code: "PARTITION_ITEM_MISSING" };
  }
  await partitions.markIndexing(row.id, item.id);
  return { status: "INDEXING" };
}

/**
 * Comprueba si una parte ya se recupera de verdad.
 *
 * Mismo contrato que un documento entero: el proveedor terminó, produjo fragmentos, y
 * una recuperación exacta los encuentra. Lo que cambia es que se acota además al
 * ordinal, leído de la clave que devuelve el índice.
 */
export async function confirmPartition(
  env: Env,
  message: DocumentIngestionMessage,
): Promise<PartitionOutcome> {
  const ordinal = message.partition_ordinal;
  const documentVersion = message.document_version;
  if (!ordinal || !documentVersion) return { status: "SKIPPED", reason: "mensaje incompleto" };

  const db = createDb(env.DB);
  const partitions = new PartitionRepository(db);
  const documents = new DocumentRepository(db);
  const row = await partitions.findForJob({
    organizationId: message.organization_id,
    matterId: message.matter_id,
    documentId: message.document_id,
    documentVersion,
    ordinal,
  });
  if (!row) return { status: "SKIPPED", reason: "partición inexistente o fuera de alcance" };
  if (row.state === "READY") return { status: "SKIPPED", reason: "ya disponible" };
  if (!row.aiSearchItemId) return { status: "SKIPPED", reason: "aún no subida" };

  /*
    SE PREGUNTA CON EL TEXTO DE LA PROPIA PARTE.

    Una consulta genérica acotada al documento devuelve las partes que mejor responden a
    ESA consulta, y en un documento de cien páginas eso casi nunca es la parte 73. Es el
    mismo error que ya cometí una vez con documentos enteros: pedir el expediente y
    esperar que el documento apareciera entre los cinco primeros.
        Preguntando con el principio de la parte, la parte es por construcción su propio
    mejor resultado. Si aun así no aparece, es que todavía no está indexada — que es
    exactamente lo que queríamos averiguar.
  */
  const object = await env.ARTIFACTS.get(row.sourceKey);
  const sonda = (await object?.text())?.slice(0, RETRIEVAL_PROBE_CHARS) ?? "";
  const retrieval = new AiSearchRetrievalProvider(env.AI_SEARCH ?? null);
  const chunks = await retrieval.search({
    scope: {
      organization_id: message.organization_id,
      authorized_matter_ids: [message.matter_id],
    },
    query: sonda.length > 0 ? sonda : `parte ${ordinal}`,
    document_id: message.document_id,
    max_results: 5,
  });
  /*
    Se exige ver ESTA parte, no cualquiera del documento.

    Un documento de cien páginas responde a casi cualquier consulta con alguna de sus
    partes. Dar por confirmada la parte 73 porque el índice devolvió la 4 marcaría como
    disponible contenido que todavía no lo está — y el abogado lo descubriría al citar
    una página que IUSIA nunca leyó. El ordinal lo trae el adaptador, leído de la clave
    del item.
  */
  const attempt = row.indexConfirmAttempts + 1;
  if (chunks.some((c) => c.partition_ordinal === ordinal)) {
    await partitions.markReady(row.id);
    await promoteDocumentIfComplete(env, message, documentVersion, documents, partitions);
    return { status: "READY" };
  }

  /*
    LA VIGILANCIA TIENE TECHO.

    Escribí esto sin límite y me lo encontré en la auditoría: una parte cuyo proveedor
    nunca termina se habría reconfirmado cada dos minutos indefinidamente, gastando cola
    e invocaciones que otros expedientes necesitan. Es el defecto simétrico del que ya
    corregí en documentos enteros —allí el problema era que nadie volvía; aquí, que
    nadie paraba—.

    Misma política que un documento entero, con las mismas constantes: escalera rápida,
    luego vigilancia lenta con el MISMO item, y sólo después se declara que hace falta
    intervención.
  */
  if (attempt > INDEX_CONFIRM_MAX_ATTEMPTS + INDEX_CONFIRM_SLOW_MAX_ATTEMPTS) {
    await partitions.markFailed(
      row.id,
      "PARTITION_CONFIRM_ABANDONED",
      "El proveedor de índice no confirmó esta parte tras varias horas de comprobaciones.",
    );
    return { status: "FAILED", code: "PARTITION_CONFIRM_ABANDONED" };
  }
  const nextDelaySeconds = attempt > INDEX_CONFIRM_MAX_ATTEMPTS
    ? INDEX_CONFIRM_SLOW_DELAY_S
    : indexConfirmDelaySeconds(attempt);
  await partitions.scheduleConfirm(
    row.id,
    attempt,
    new Date(Date.now() + nextDelaySeconds * 1000).toISOString(),
  );
  return { status: "PENDING", nextDelaySeconds };
}

/**
 * Marca el documento como indexado cuando TODAS sus partes lo están.
 *
 * Antes de eso el documento ya es utilizable —basta con que una parte esté lista— pero
 * no se declara completo, porque decir «indexado» de un documento al que le faltan
 * treinta páginas es prometerle al abogado una evidencia que no tiene.
 */
async function promoteDocumentIfComplete(
  env: Env,
  message: DocumentIngestionMessage,
  documentVersion: number,
  documents: DocumentRepository,
  partitions: PartitionRepository,
): Promise<void> {
  const doc = await documents.findById(message.organization_id, message.document_id);
  if (!doc || doc.partitionCount === 0) return;
  const ready = await partitions.readyOrdinals(
    message.organization_id,
    message.document_id,
    documentVersion,
  );
  if (ready.length < doc.partitionCount) return;
  await documents.markIndexed(
    message.organization_id,
    message.document_id,
    doc.r2MirrorKey ?? "",
    doc.contentHash ?? "",
  );
}
