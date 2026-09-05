import { DocumentRepository, IngestionAttemptRepository, createDb } from "@iusia/db";
import type { Env } from "../env.js";
import { AiSearchRetrievalProvider } from "../integrations/ai-search.js";
import {
  INDEX_CONFIRM_MAX_ATTEMPTS,
  INDEX_CONFIRM_SLOW_DELAY_S,
  INDEX_CONFIRM_SLOW_MAX_ATTEMPTS,
  indexConfirmDelaySeconds,
  type AiSearchUploadInfo,
} from "./ingestion.js";

/**
 * Confirmación de que un documento está REALMENTE disponible para el análisis.
 *
 * POR QUÉ EXISTE. En el lote de cinco de IUS-2026-016 el índice tardó entre 77 y 112 s
 * y fue el 98,8 %-99,4 % del tiempo total: el consumidor se pasaba casi dos minutos por
 * documento esperando de brazos cruzados. La referencia oficial confirma que
 * `items.upload()` encola y retorna, y que `items.get(id).info()` devuelve `status` y
 * `chunks_count`. Así que subir y preguntar después no es un atajo: es como está
 * diseñada la API.
 *
 * QUÉ SIGNIFICA INDEXADO. Cinco condiciones, todas necesarias:
 *   1. el proveedor dice `completed`;
 *   2. `chunks_count > 0`;
 *   3. una búsqueda FILTRADA POR ESE DOCUMENTO devuelve al menos un fragmento suyo;
 *   4. el documento no está retirado;
 *   5. su versión es la vigente.
 *
 * La tercera no es redundante. Un filtro de metadata mal puesto dejó la recuperación en
 * cero durante días mientras todos los estados decían que estaba indexado: que el
 * proveedor termine no prueba que el RAG lo encuentre.
 */
export type ConfirmOutcome =
  | { status: "CONFIRMED"; chunks: number }
  | { status: "PENDING"; providerStatus: string; nextDelaySeconds: number }
  | { status: "FAILED"; code: string; detail?: string }
  | { status: "SKIPPED"; reason: string }
  | { status: "DELAYED"; attempts: number };

type ItemsBinding = {
  items?: { get?: (id: string) => { info: () => Promise<AiSearchUploadInfo> } };
};

export async function confirmDocumentIndexed(
  env: Env,
  input: { organizationId: string; matterId: string; documentId: string },
): Promise<ConfirmOutcome> {
  const documents = new DocumentRepository(createDb(env.DB));
  const doc = await documents.findById(input.organizationId, input.documentId);

  // D1 es la autoridad: retirado o de otro expediente no se confirma, diga lo que diga
  // el índice.
  if (!doc) return { status: "SKIPPED", reason: "documento inexistente" };
  if (doc.matterId !== input.matterId) return { status: "SKIPPED", reason: "matter no coincide" };
  if (doc.retiredAt) return { status: "SKIPPED", reason: "documento retirado" };
  if (doc.ingestionStatus === "AI_INDEXED") return { status: "SKIPPED", reason: "ya confirmado" };
  if (doc.ingestionStatus !== "INDEXING") {
    return { status: "SKIPPED", reason: `estado ${doc.ingestionStatus}` };
  }

  const attempt = (doc.indexConfirmAttempts ?? 0) + 1;

  /*
    CONSTANCIA DE LA COMPROBACIÓN.

    Veintitrés confirmaciones por documento en el lote de 19 y NI UNA dejó rastro: ni en
    el libro de intentos, ni en la auditoría. Cuando cinco documentos acabaron en
    `INDEX_CONFIRM_ABANDONED` no había forma de decir qué respondía el proveedor —si
    seguía trabajando, si nunca produjo fragmentos, o si la recuperación exacta no los
    encontraba—. El producto no podía explicar su propio veredicto.

    Se reutiliza el libro que ya existe. No hay tabla nueva, ni sistema de eventos, ni
    consulta manual al índice desde fuera: la evidencia la produce el propio camino que
    promueve el documento a `AI_INDEXED`.
  */
  const attempts = new IngestionAttemptRepository(createDb(env.DB));
  const ledgerId = await attempts
    .open({
      organizationId: input.organizationId,
      matterId: input.matterId,
      documentId: input.documentId,
      attempt,
      reason: "AI_SEARCH_CONFIRM",
    })
    .catch(() => null);
  /** Cierra el intento sin poder tumbar la confirmación: es rastro, no lógica. */
  const record = async (outcome: {
    finalState: string;
    stage?: string | null;
    failureCode?: string | null;
    failureMessage?: string | null;
    timings?: Record<string, number> | null;
  }): Promise<void> => {
    if (!ledgerId) return;
    await attempts.close(ledgerId, outcome).catch(() => undefined);
  };

  // 1-2. Estado del item EXACTO que subimos, no de uno parecido.
  const info = await itemInfo(env, doc.aiSearchItemId);
  if (info?.status === "error") {
    await documents.markIngestionFailedAt(
      input.organizationId,
      input.documentId,
      "AI_SEARCH",
      "AI_SEARCH_ITEM_ERROR",
      info.error ?? "el índice rechazó el documento",
    );
    await record({
      finalState: "FAILED",
      stage: "AI_SEARCH_ITEM_ERROR",
      failureCode: "AI_SEARCH_ITEM_ERROR",
      failureMessage: info.error ?? "el índice rechazó el documento",
    });
    return { status: "FAILED", code: "AI_SEARCH_ITEM_ERROR", detail: info.error };
  }

  const providerDone = info?.status === "completed";
  const hasChunks = (info?.chunks_count ?? 0) > 0;
  /** Lo que el proveedor afirma en ESTA comprobación. Es la evidencia, no una etiqueta. */
  const providerStage = `provider=${info?.status ?? "unknown"} chunks=${info?.chunks_count ?? 0}`;

  if (providerDone && hasChunks) {
    // 3. Recuperación REAL, filtrando por el documento antes de buscar.
    const retrieval = new AiSearchRetrievalProvider(env.AI_SEARCH ?? null);
    const chunks = await retrieval.search({
      scope: {
        organization_id: input.organizationId,
        authorized_matter_ids: [input.matterId],
      },
      query: doc.name,
      document_id: input.documentId,
      max_results: 3,
    });
    if (chunks.length > 0) {
      await documents.markIndexed(
        input.organizationId,
        input.documentId,
        doc.r2MirrorKey ?? "",
        doc.contentHash ?? "",
      );
      /*
        Éste es el ÚNICO camino que promueve un documento a `AI_INDEXED`, y ahora deja
        escrito por qué: el proveedor terminó, produjo fragmentos, y una recuperación
        exacta por `document_id` los encontró. «Indexado» deja de ser una afirmación
        del sistema y pasa a ser un hecho comprobable desde el propio expediente.
      */
      await record({
        finalState: "RETRIEVAL_SMOKE_PASSED",
        stage: providerStage,
        timings: { chunks_retrieved: chunks.length, chunks_indexed: info?.chunks_count ?? 0 },
      });
      return { status: "CONFIRMED", chunks: chunks.length };
    }
  }

  // Todavía no. «No ha terminado» NO es «ha fallado»: el proveedor puede ir lento sin
  // estar roto, y declarar error ahí es exactamente lo que produjo un falso fallo en un
  // documento sano.
  /*
    LA CADENA RÁPIDA SE AGOTA; LA VIGILANCIA NO.

    Antes esto era el final del camino: se marcaba la etapa `INDEXING_DELAYED`, se
    dejaba `index_confirm_next_at` en nulo y no volvía nadie. El documento quedaba
    entero en el proveedor, con su identidad de item, y la pantalla decía «Procesando»
    hasta que el latido envejecía y pasaba a «Procesamiento detenido» con un botón que
    sólo servía para volver a subirlo todo.

    Ahora se baja el ritmo en vez de abandonar. Se sigue preguntando cada media hora,
    con el MISMO item —no se re-normaliza, no se re-sube, no se duplica nada— hasta seis
    horas. Sólo entonces se declara que hace falta intervención.
  */
  if (attempt >= INDEX_CONFIRM_MAX_ATTEMPTS) {
    const slowAttempt = attempt - INDEX_CONFIRM_MAX_ATTEMPTS + 1;
    if (slowAttempt > INDEX_CONFIRM_SLOW_MAX_ATTEMPTS) {
      // Seis horas de vigilancia lenta sin respuesta. Ya no es lentitud.
      await documents.markIngestionFailedAt(
        input.organizationId,
        input.documentId,
        "AI_SEARCH",
        "INDEX_CONFIRM_ABANDONED",
        "El proveedor de índice no confirmó el documento tras varias horas de comprobaciones.",
      );
      await record({
        finalState: "FAILED",
        stage: providerStage,
        failureCode: "INDEX_CONFIRM_ABANDONED",
        // Lo último que dijo el proveedor queda escrito: sin esto, «abandonado» no
        // distingue «seguía trabajando» de «nunca produjo un fragmento».
        failureMessage: `Última respuesta del índice: ${providerStage}.`,
      });
      return {
        status: "FAILED",
        code: "INDEX_CONFIRM_ABANDONED",
        detail: `${attempt} comprobaciones sin confirmación del proveedor.`,
      };
    }
    await documents.scheduleIndexConfirm(
      input.organizationId,
      input.documentId,
      attempt,
      new Date(Date.now() + INDEX_CONFIRM_SLOW_DELAY_S * 1000).toISOString(),
      "INDEXING_DELAYED",
    );
    await record({ finalState: "PENDING_SLOW", stage: providerStage });
    return {
      status: "PENDING",
      providerStatus: info?.status ?? (providerDone ? "completed" : "unknown"),
      nextDelaySeconds: INDEX_CONFIRM_SLOW_DELAY_S,
    };
  }

  const nextDelaySeconds = indexConfirmDelaySeconds(attempt);
  await documents.scheduleIndexConfirm(
    input.organizationId,
    input.documentId,
    attempt,
    new Date(Date.now() + nextDelaySeconds * 1000).toISOString(),
  );
  await record({ finalState: "PENDING", stage: providerStage });
  return {
    status: "PENDING",
    providerStatus: info?.status ?? (providerDone ? "completed" : "unknown"),
    nextDelaySeconds,
  };
}

/** Estado del item por su identidad. Sin identidad no hay nada que preguntar. */
async function itemInfo(env: Env, itemId: string | null): Promise<AiSearchUploadInfo | null> {
  if (!itemId) return null;
  const binding = env.AI_SEARCH as unknown as ItemsBinding | null;
  const handle = binding?.items?.get?.(itemId);
  if (!handle) return null;
  try {
    return await handle.info();
  } catch {
    // El índice no responde ahora: se vuelve a preguntar, no se degrada el documento.
    return null;
  }
}
