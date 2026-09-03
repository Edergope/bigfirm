import {
  isReadableMimeType,
  StorageNotConfiguredError,
  documentIngressKey,
  documentMirrorKey,
  type DocumentIngestionMessage,
} from "@iusia/domain";
import { DocumentRepository, IngestionAttemptRepository, MatterRepository, createDb } from "@iusia/db";
import type { Env } from "../env.js";
import { DriveConnectionError, OrganizationStorageResolver } from "./drive-credentials.js";
import { DriveWorkspaceService } from "./drive-workspace.js";

/**
 * Servicio de ingestión documental.
 *
 * Flujo (Blueprint §07): documento vinculado / cambio de Drive → Queue → aquí.
 * Descarga el contenido vía el port de almacenamiento, escribe un espejo
 * normalizado en R2 bajo la carpeta del tenant/matter y marca `indexed_at`.
 *
 * Idempotente: la clave de espejo depende sólo de document_id, así que un
 * reintento de Queue reescribe el mismo objeto sin duplicar.
 */
export interface IngestionOutcome {
  status: "INDEXED" | "STORAGE_NOT_CONFIGURED" | "SKIPPED" | "ERROR";
  detail?: string;
  /** Duraciones por etapa, en ms. Presentes sólo cuando la ingestión completó. */
  timings?: StageTimings;
}

/**
 * Cotas de las dependencias externas del pipeline.
 *
 * Ninguna espera puede ser ilimitada: una llamada a AI Search sin cota dejó 213,5 s
 * muertos en una orquestación real. La descarga y la conversión tenían el mismo agujero
 * —un PDF grande o un proveedor lento colgaban al consumidor sin techo—, con el
 * agravante de que ocupan un hueco de concurrencia mientras tanto y frenan al lote
 * entero.
 *
 * Un vencimiento NO se convierte en éxito vacío: se clasifica como fallo y el mensaje
 * se reintenta. Marcar indexado un documento que no se pudo leer es peor que fallar.
 */
export const DOWNLOAD_DEADLINE_MS = 60_000;
export const NORMALIZE_DEADLINE_MS = 120_000;

/**
 * Cotas de las dos dependencias que quedaban sin techo.
 *
 * `PROVIDER_SYNC` cubre `ensureMatterFolders` —ocho llamadas encadenadas a Drive— más
 * la subida del archivo. Era el único tramo del pipeline sin límite, y es donde se
 * detuvo `CC JFRR.pdf`. `AI_SEARCH` tiene su propio sondeo interno de 120 s; esta cota
 * es el techo duro por si ese sondeo tampoco vuelve.
 */
export const PROVIDER_SYNC_DEADLINE_MS = 45_000;

/**
 * Reintentos de la sincronización con el proveedor.
 *
 * Contador PROPIO y espera creciente, porque una caída de Drive puede durar horas y los
 * tres reintentos que Cloudflare da al mensaje se agotarían en segundos. Tras el último
 * intento el documento queda en estado terminal para soporte — nunca en un bucle.
 */
export const PROVIDER_SYNC_MAX_ATTEMPTS = 8;

/**
 * Propiedad con la que IUSIA marca sus archivos en el proveedor.
 *
 * Es la identidad determinista que permite reconocer un archivo ya subido cuando un
 * reintento no sabe que lo estaba: cierra la ventana entre la subida y la escritura en
 * D1, que de otro modo crearía duplicados.
 */
export const PROVIDER_DOCUMENT_PROPERTY = "iusia_document_id";

/** Espera antes del intento N: 1 min, 2, 4, 8… con techo de una hora. */
export function providerSyncBackoffMs(attempt: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempt - 1), 3_600_000);
}

/** Lo que Cloudflare afirma del mensaje entregado. */
export interface QueueDelivery {
  messageId?: string;
  attempt?: number;
  timestamp?: string;
}
export const AI_SEARCH_DEADLINE_MS = 150_000;

/**
 * Cuánto se espera a que el índice confirme, DENTRO del trabajo de ingestión.
 *
 * MEDIDO en los cinco documentos de IUS-2026-016: el índice tardó entre 77 y 112
 * segundos, y ocupó el 98,8 %–99,4 % del tiempo total. La normalización fueron 94-261 ms
 * y la descarga menos de 550: no había nada que optimizar ahí.
 *
 * El sondeo estaba fijado en 120 s, es decir, 7,9 segundos por encima del peor caso
 * observado. `Cedula extrangeria Maria.pdf` cruzó ese margen en su primer intento y el
 * abogado vio «Error de procesamiento» en un documento que estaba perfectamente bien:
 * la reentrega lo indexó a los 112 s.
 *
 * Subir el techo sólo movería el precipicio. Lo que se corrige es la premisa: cuando el
 * sondeo vence, el item YA SE SUBIÓ —`uploadAndPoll` sube primero y luego consulta—, así
 * que declarar un fallo es falso y volver a subirlo en el reintento, desperdicio. El
 * documento queda INDEXANDO y la confirmación pasa a la barrida, que la hace con una
 * recuperación real. Nadie bloquea un consumidor durante dos minutos.
 */
export const AI_SEARCH_POLL_MS = 25_000;

/**
 * Espera antes de la primera confirmación, y política de reintento.
 *
 * MEDIDO: el índice tardó entre 77 y 112 s en los cinco documentos reales. Preguntar
 * antes de los 30 s sería preguntar en vano; los intervalos siguientes crecen hasta un
 * techo de dos minutos y cubren con holgura el peor caso observado, con margen para un
 * upstream más lento sin convertir la lentitud en un fallo.
 *
 * Cloudflare admite `delaySeconds` de hasta 24 h, así que estos valores caben de sobra.
 */
export const INDEX_CONFIRM_FIRST_DELAY_S = 30;
export const INDEX_CONFIRM_MAX_ATTEMPTS = 12;

/** Espera antes del intento N: 30, 45, 60, 90, 120… con techo de 120 s. */
export function indexConfirmDelaySeconds(attempt: number): number {
  const ladder = [30, 45, 60, 90, 120];
  return ladder[Math.min(Math.max(attempt - 1, 0), ladder.length - 1)]!;
}

export type StageTimings = Record<string, number>;

/**
 * El artefacto normalizado excede el máximo del proveedor.
 *
 * No es un fallo transitorio ni algo que un reintento arregle: hace falta partir el
 * documento, que es el trabajo pendiente de SPRINT_01B. Se clasifica aparte para que no
 * se confunda con una caída del índice.
 */
export class PartitionRequiredError extends Error {
  readonly code = "PARTITION_REQUIRED";
  constructor(readonly bytes: number) {
    super(`El documento normalizado (${bytes} bytes) supera el máximo del índice`);
    this.name = "PartitionRequiredError";
  }
}

export class IngestionTimeoutError extends Error {
  constructor(readonly stage: string, readonly timeoutMs: number) {
    super(`La etapa ${stage} superó ${timeoutMs} ms`);
    this.name = "IngestionTimeoutError";
  }
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, stage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_r, reject) => {
        timer = setTimeout(() => reject(new IngestionTimeoutError(stage, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Cronómetro por etapa: cada `mark` cierra el tramo abierto desde el anterior. */
export class StageClock {
  readonly timings: StageTimings = {};
  private readonly startedAt = Date.now();
  private last = Date.now();

  mark(stage: string): void {
    const now = Date.now();
    this.timings[stage] = now - this.last;
    this.last = now;
  }

  finish(): StageTimings {
    this.timings.finalize_ms = Date.now() - this.last;
    this.timings.total_ms = Date.now() - this.startedAt;
    return this.timings;
  }
}

export class IngestionService {
  constructor(
    private readonly env: Env,
    /** Resuelve el almacenamiento documental DE LA ORGANIZACIÓN (nunca el del actor). */
    private readonly storage: OrganizationStorageResolver,
  ) {}

  static forEnv(env: Env): IngestionService {
    return new IngestionService(env, OrganizationStorageResolver.forEnv(env));
  }

  async ingest(
    message: DocumentIngestionMessage,
    /** Lo que Cloudflare afirma del mensaje. Se persiste para no tener que inferirlo. */
    delivery?: QueueDelivery,
  ): Promise<IngestionOutcome> {
    const db = createDb(this.env.DB);
    const documents = new DocumentRepository(db);

    /*
      EL INTENTO SE REGISTRA PRIMERO.

      En IUS-2026-016 los cinco documentos quedaron con `ingestion_attempts = 0` e
      `ingestion_started_at = NULL`: no había forma de saber si el consumidor los había
      tomado y muerto, o si nunca los recibió. Sellar el intento antes de tocar D1, el
      proveedor o el índice convierte ese contador en la respuesta a esa pregunta.
    */
    await documents
      .markIngestionStarted(message.organization_id, message.document_id, delivery)
      .catch(() => undefined);

    // Historial: una fila POR INTENTO. La fila del documento se sobrescribe —es el
    // estado actual, que es lo que la pantalla necesita—, pero la evidencia de lo que
    // pasó antes no puede depender de ella.
    const attempts = new IngestionAttemptRepository(db);
    const attemptId = await attempts
      .open({
        organizationId: message.organization_id,
        matterId: message.matter_id,
        documentId: message.document_id,
        attempt: (await documents.findById(message.organization_id, message.document_id))
          ?.ingestionAttempts ?? 1,
        reason: message.reason,
        cfQueueMessageId: delivery?.messageId ?? null,
        cfQueueAttempt: delivery?.attempt ?? null,
      })
      .catch(() => null);
    const closeAttempt = (outcome: {
      finalState: string;
      stage?: string | null;
      failureCode?: string | null;
      failureMessage?: string | null;
      timings?: Record<string, number> | null;
    }) => (attemptId ? attempts.close(attemptId, outcome).catch(() => undefined) : Promise.resolve());

    const doc = await documents.findById(message.organization_id, message.document_id);
    if (!doc) return { status: "SKIPPED", detail: "documento no encontrado en el registro" };
    if (doc.retiredAt) return { status: "SKIPPED", detail: "documento retirado" };
    // Una cola retrasada de v1 nunca puede sobrescribir el espejo RAG de v2. La
    // comprobación sólo aplica cuando el mensaje declara un archivo del proveedor:
    // los mensajes de carga (`UPLOADED`) llegan antes de que ese archivo exista.
    if (message.drive_file_id !== undefined && doc.driveFileId !== message.drive_file_id) {
      return { status: "SKIPPED", detail: "versión no vigente" };
    }

    /*
      EL PROVEEDOR SE RESUELVE TARDE, Y SÓLO SI HACE FALTA.

      Antes se resolvía al principio, para todos los mensajes. Eso ataba CADA ingestión
      a la salud del OAuth de Drive en ese instante: un fallo que no fuera
      `DriveConnectionError` —un error de red al refrescar el token, por ejemplo— se
      propagaba, el mensaje se reintentaba tres veces y acababa en la cola de descarte,
      dejando el documento congelado en PROCESSING sin una sola pista.

      Con el ingreso durable, los bytes ya están en R2: Drive sólo se necesita para la
      sincronización final. Si esa parte falla, el documento queda en ERROR con su etapa
      registrada y es reintentable, en vez de desaparecer del mundo.
    */
    /*
      ORDEN DEL PIPELINE — la corrección arquitectónica de este sprint.

      Antes: bytes → SINCRONIZAR CON DRIVE → normalizar → indexar. La sincronización con
      el proveedor era prerrequisito SERIAL de todo lo demás y, además, no tenía cota:
      `ensureMatterFolders` encadena ocho llamadas a Drive sin techo. `CC JFRR.pdf` —dos
      páginas— se quedó exactamente ahí: `ingestion_stage = FINAL_STORAGE`, último latido
      387 ms después de empezar, `drive_file_id` nulo, y dos entregas de cola agotadas
      esperando algo que nunca respondió.

      Ahora: bytes → normalizar → indexar → (aparte) sincronizar con Drive.

      El original ya está a salvo en el ingreso durable, así que Drive no aporta NADA a
      la comprensión del documento: es procedencia y respaldo, no una dependencia del
      análisis. Que el proveedor esté lento o caído ya no impide que IUSIA entienda el
      expediente; deja pendiente una sincronización con su propio contador, su propia
      espera creciente y una barrida de reconciliación que la recupera (ver
      `deferProviderSync` y `scheduled.ts`).
    */
    let stage: IngestionStage = "NORMALIZE";
    const clock = new StageClock();
    // NO se vuelve a sellar aquí. Había una segunda llamada a `markIngestionStarted` en
    // este punto, así que cada entrega de Cloudflare sumaba dos al contador y
    // `ingestion_attempts` dejaba de significar «entregas que empezaron a procesarse».
    // A partir de aquí las etapas sólo actualizan latido y progreso.
    const heartbeat = (at: string) =>
      documents.markIngestionProgress(message.organization_id, message.document_id, at);

    try {
      const ingressKey = documentIngressKey(
        message.organization_id,
        message.matter_id,
        message.document_id,
      );

      // 1. BYTES. Del ingreso durable si están; del proveedor sólo si el documento ya
      //    se sincronizó y el ingreso se limpió.
      await heartbeat("INGRESS");
      let bytes: ArrayBuffer;
      const ingress = await this.env.ARTIFACTS.get(ingressKey);
      if (ingress) {
        bytes = await ingress.arrayBuffer();
      } else if (doc.driveFileId) {
        stage = "DRIVE_DOWNLOAD";
        const storage = await this.resolveStorage(documents, message);
        if (!storage) return { status: "STORAGE_NOT_CONFIGURED" };
        bytes = await withDeadline(
          storage.download(doc.driveFileId),
          DOWNLOAD_DEADLINE_MS,
          "DRIVE_DOWNLOAD",
        );
      } else {
        // Sin bytes no hay nada que ingerir, y fingir lo contrario dejaría un documento
        // «procesando» eternamente.
        await documents.markIngestionFailedAt(
          message.organization_id,
          message.document_id,
          "INGRESS",
          "SOURCE_BYTES_MISSING",
          "No se conserva el contenido del archivo.",
        );
        return { status: "ERROR", detail: "los bytes del documento no están disponibles" };
      }
      clock.mark("download_ms");

      // 2. INTELIGENCIA. Sin tocar el proveedor. Si el espejo y el índice ya existen de
      //    un intento anterior, no se rehace: el reintento reanuda, no reempieza.
      const key = documentMirrorKey(
        message.organization_id,
        message.matter_id,
        message.document_id,
      );
      /*
        LA INTELIGENCIA YA ESTÁ HECHA si el espejo existe Y el documento llegó al índice.
        Basta con tener identidad de item: `INDEXING` significa subido y pendiente de
        confirmar, no pendiente de subir.

        La condición exigía `indexedAt !== null`, que sólo es cierto DESPUÉS de confirmar.
        Así, cada reintento de sincronización con el proveedor volvía a normalizar y a
        subir un documento que ya estaba en el índice, reiniciaba su contador de
        confirmación y encolaba otra cadena — dejando `outdated` a la subida anterior.
        `ENSAYO ESPECIALIZACION xxx.docx` acumuló 19 confirmaciones así y nunca convergió:
        cada vuelta invalidaba el trabajo de la anterior.
      */
      const mirrorReady = doc.r2MirrorKey === key;
      const alreadyIndexed = mirrorReady && (doc.indexedAt !== null || doc.aiSearchItemId !== null);
      if (!alreadyIndexed && isIndexableMimeType(doc.mimeType)) {
        stage = "NORMALIZE";
        await heartbeat("NORMALIZATION");
        const text = await withDeadline(
          normalizeToText(bytes, doc.mimeType, doc.name, this.env.AI),
          NORMALIZE_DEADLINE_MS,
          "NORMALIZE",
        );
        clock.mark("normalize_ms");

        stage = "R2_PUT";
        // Metadata de R2 → la usa AI Search como folder/tenant para el filtrado.
        await this.env.ARTIFACTS.put(key, text, {
          httpMetadata: { contentType: "text/markdown; charset=utf-8" },
          customMetadata: {
            organization_id: message.organization_id,
            matter_id: message.matter_id,
            document_id: message.document_id,
            document_version: String(doc.currentVersion),
            is_current: "true",
            is_active: "true",
            source_mime_type: doc.mimeType,
          },
        });
        clock.mark("r2_ms");

        stage = "AI_SEARCH_UPLOAD";
        await heartbeat("AI_SEARCH");

        /*
          IDEMPOTENCIA. Una reentrega no vuelve a subir el mismo item: si ya hay
          identidad persistida y el índice no lo dio por fallido, se reutiliza. Con
          at-least-once eso no es una optimización, es la diferencia entre un item y dos.
        */
        let item: AiSearchUploadInfo | null = null;
        if (doc.aiSearchItemId) {
          item = { id: doc.aiSearchItemId, key: doc.aiSearchItemKey ?? key, status: "queued" };
        } else {
          item = await withDeadline(
            uploadToAiSearch(this.env.AI_SEARCH ?? null, key, text, indexMetadata({
              organizationId: message.organization_id,
              matterId: message.matter_id,
              documentId: message.document_id,
              documentVersion: doc.currentVersion,
            })),
            AI_SEARCH_DEADLINE_MS,
            "AI_SEARCH_UPLOAD",
          );
        }
        clock.mark("ai_search_ms");

        stage = "D1_MARK_INDEXED";
        const hash = await sha256Hex(text);
        // El item está ENVIADO. Confirmar que se recupera es otro trabajo: esperarlo
        // aquí ocupaba el 99 % del tiempo del consumidor sin hacer nada.
        await documents.markIndexing(
          message.organization_id,
          message.document_id,
          key,
          hash,
          clock.finish(),
          { itemId: item?.id ?? null, itemKey: item?.key ?? key },
        );
        await this.enqueueIndexConfirm(message, INDEX_CONFIRM_FIRST_DELAY_S);
      }

      /*
        3. PROCEDENCIA. La sincronización con el proveedor ocurre AL FINAL, acotada, y
           su fallo NO deshace nada: el documento ya es utilizable. Queda pendiente y se
           reintenta; los bytes originales permanecen en el ingreso hasta que aterrice.
      */
      if (!doc.driveFileId) {
        stage = "PROVIDER_SYNC";
        await heartbeat("FINAL_STORAGE");
        try {
          const storage = await this.resolveStorage(documents, message);
          if (!storage) {
            // Sin credenciales del proveedor no hay nada que sincronizar AHORA, pero
            // dejarlo en silencio creaba deuda invisible: los cinco documentos de
            // IUS-2026-016 quedaron indexados con `provider_sync_state` nulo, así que la
            // barrida nunca los vería y su original jamás saldría del ingreso.
            await this.deferProviderSync(
              documents,
              doc,
              message,
              new Error("DRIVE_NOT_AVAILABLE"),
            );
          } else {
            const providerFileId = await withDeadline(
              this.syncToProvider(storage, doc, message, bytes),
              PROVIDER_SYNC_DEADLINE_MS,
              "PROVIDER_SYNC",
            );
            if (providerFileId) {
              await documents.attachProviderFile(
                message.organization_id,
                message.document_id,
                providerFileId,
              );
              // El ingreso ya cumplió su función: el original está en el proveedor y su
              // espejo normalizado en el índice. Conservarlo sería pagar dos veces.
              await this.env.ARTIFACTS.delete(ingressKey).catch(() => undefined);
            }
          }
        } catch (error) {
          // Se registra y se sigue: un proveedor lento no puede volver a dejar un
          // documento sin analizar, que es exactamente lo que pasó con CC JFRR.pdf.
          console.warn("provider_sync_deferred", {
            document_id: message.document_id,
            ...safeIngestionError(error),
          });
          await this.deferProviderSync(documents, doc, message, error);
        }
      }

      await closeAttempt({ finalState: "INDEXED", stage, timings: clock.timings });
      return { status: "INDEXED", detail: key, timings: clock.timings };
    } catch (error) {
      if (error instanceof StorageNotConfiguredError) {
        return { status: "STORAGE_NOT_CONFIGURED" };
      }
      console.error("ingestion_stage_failed", {
        organization_id: message.organization_id,
        matter_id: message.matter_id,
        document_id: message.document_id,
        stage,
        ...safeIngestionError(error),
      });
      const failureStage = FAILURE_STAGE[stage] ?? "UNKNOWN";
      const failureCode = error instanceof PartitionRequiredError
        ? error.code
        : error instanceof Error
          ? error.name
          : "UNKNOWN";
      const failureMessage = error instanceof Error ? error.message : "error desconocido";
      await documents.markIngestionFailedAt(
        message.organization_id,
        message.document_id,
        failureStage,
        failureCode,
        failureMessage,
      );
      await closeAttempt({ finalState: "ERROR", stage: failureStage, failureCode, failureMessage });
      return {
        status: "ERROR",
        detail: error instanceof Error ? error.message : "error desconocido",
      };
    }
  }

  /**
   * Encola la confirmación de indexación con retraso.
   *
   * Es el camino NORMAL de readiness. El cron queda sólo como red de seguridad: dejar
   * que un documento espere hasta diez minutos porque cayó justo después de una barrida
   * sería aceptar latencia que no existe.
   */
  private async enqueueIndexConfirm(
    message: DocumentIngestionMessage,
    delaySeconds: number,
  ): Promise<void> {
    await this.env.DOCUMENT_INGESTION.send(
      {
        organization_id: message.organization_id,
        matter_id: message.matter_id,
        document_id: message.document_id,
        reason: "AI_SEARCH_CONFIRM",
        enqueued_at: new Date().toISOString(),
      },
      { delaySeconds },
    ).catch(() => undefined);
  }

  /**
   * Aplaza la sincronización con el proveedor y PROGRAMA un reintento real.
   *
   * Antes esto sólo escribía `DEFERRED` y el comentario afirmaba que «se reintenta
   * sola». No era cierto: nadie leía ese estado. Un documento con Drive aplazado se
   * quedaba así para siempre y sus bytes originales nunca salían del ingreso.
   *
   * Ahora encola un trabajo PROPIO —con su contador y su espera creciente— y, si agota
   * los intentos, queda en estado terminal visible para soporte. En ningún caso cambia
   * lo que el abogado ve: el documento ya es analizable.
   */
  private async deferProviderSync(
    documents: DocumentRepository,
    doc: { providerSyncAttempts: number },
    message: DocumentIngestionMessage,
    error: unknown,
  ): Promise<void> {
    const attempt = (doc.providerSyncAttempts ?? 0) + 1;
    const code = error instanceof Error ? error.name : "UNKNOWN";

    if (attempt >= PROVIDER_SYNC_MAX_ATTEMPTS) {
      await documents.markProviderSyncTerminal(
        message.organization_id,
        message.document_id,
        code,
      );
      return;
    }

    const nextAt = new Date(Date.now() + providerSyncBackoffMs(attempt)).toISOString();
    await documents.deferProviderSync(
      message.organization_id,
      message.document_id,
      code,
      nextAt,
    );
    /*
      El reintento se encola como trabajo independiente Y CON EL RETRASO CALCULADO.

      Salía sin `delaySeconds`. La espera creciente se escribía en `provider_sync_next_at`
      y el mensaje se enviaba de inmediato, así que los ocho intentos de un documento se
      consumieron en 47 segundos —20:10:08 a 20:10:39 en el lote de IUS-2026-018— en vez
      de repartirse entre un minuto y una hora. Escribir una fecha en D1 no retrasa nada:
      es la tercera vez que este subsistema comete exactamente ese error.
    */
    await this.env.DOCUMENT_INGESTION.send(
      {
        organization_id: message.organization_id,
        matter_id: message.matter_id,
        document_id: message.document_id,
        reason: "PROVIDER_SYNC",
        enqueued_at: new Date().toISOString(),
      },
      { delaySeconds: Math.round(providerSyncBackoffMs(attempt) / 1000) },
    ).catch(() => undefined);
  }

  /**
   * Resuelve el almacenamiento de la ORGANIZACIÓN. Nunca el OAuth personal de nadie:
   * una ingestión de fondo no puede depender de quién subió el archivo.
   */
  private async resolveStorage(
    documents: DocumentRepository,
    message: DocumentIngestionMessage,
  ) {
    try {
      return await this.storage.resolveAdapter(message.organization_id);
    } catch (error) {
      if (error instanceof DriveConnectionError) {
        await documents.setStatus(message.organization_id, message.document_id, "PENDIENTE");
        return null;
      }
      throw error;
    }
  }

  /**
   * Sube los bytes al proveedor definitivo y devuelve su identificador.
   *
   * Aquí es donde ocurre la parte lenta que ANTES bloqueaba al navegador: asegurar las
   * carpetas del expediente en Drive y transferir el archivo. En segundo plano nadie
   * espera, y si falla el documento queda en error reintentable con sus bytes intactos
   * en el ingreso — nunca perdido.
   *
   * Drive sigue siendo invisible para el abogado: esto es infraestructura.
   */
  private async syncToProvider(
    storage: {
      uploadFile: (input: {
        name: string;
        parentId: string;
        mimeType: string;
        content: ArrayBuffer;
        appProperties?: Record<string, string>;
      }) => Promise<{ provider_file_id: string }>;
      findFileByAppProperty?: (
        key: string,
        value: string,
        parentId: string,
      ) => Promise<string | null>;
    },
    doc: { name: string; mimeType: string },
    message: DocumentIngestionMessage,
    bytes: ArrayBuffer,
  ): Promise<string | null> {
    const folders = await this.folders(message);
    if (!folders) return null;

    /*
      VENTANA DE CRASH. Si el Worker muere DESPUÉS de subir el archivo pero ANTES de
      guardar su id en D1, el reintento vería `drive_file_id` nulo y subiría un segundo
      archivo. `if (!doc.driveFileId)` no basta para eso.

      Se consulta primero por una identidad que escribimos nosotros: si el archivo ya
      está allí, se adopta. El proveedor es la fuente de verdad de su propio contenido.
    */
    const existing = await storage.findFileByAppProperty?.(
      PROVIDER_DOCUMENT_PROPERTY,
      message.document_id,
      folders,
    );
    if (existing) return existing;

    const meta = await storage.uploadFile({
      name: doc.name,
      parentId: folders,
      mimeType: doc.mimeType,
      content: bytes,
      appProperties: { [PROVIDER_DOCUMENT_PROPERTY]: message.document_id },
    });
    return meta.provider_file_id;
  }

  /**
   * Carpeta de aportados del expediente en el proveedor, creándola si hace falta.
   *
   * Son varias llamadas secuenciales al proveedor. Ejecutarlas DENTRO de la petición de
   * carga era la causa del cuelgue de más de cinco minutos: aquí, en segundo plano, esa
   * lentitud no la sufre nadie.
   */
  private async folders(message: DocumentIngestionMessage): Promise<string | null> {
    const db = createDb(this.env.DB);
    const matters = new MatterRepository(db);
    const matter = await matters.findById(message.organization_id, message.matter_id);
    if (!matter) return null;
    const workspace = DriveWorkspaceService.forEnv(this.env);
    // El proveedor se resuelve por ORGANIZACIÓN, no por usuario: una ingestión de fondo
    // no puede depender del OAuth personal de nadie. El parámetro se conserva por firma.
    const folders = await workspace.ensureMatterFolders("", message.organization_id, {
      id: matter.id,
      reference: matter.reference,
      title: matter.title,
    });
    return folders.uploaded;
  }
}

/** Etapa técnica → clasificación estable que se persiste para soporte. */
const FAILURE_STAGE: Record<string, string> = {
  PROVIDER_SYNC: "FINAL_STORAGE",
  DRIVE_DOWNLOAD: "DOWNLOAD",
  NORMALIZE: "NORMALIZATION",
  R2_PUT: "INGRESS",
  AI_SEARCH_UPLOAD: "AI_SEARCH",
  D1_MARK_INDEXED: "FINALIZATION",
};

export type IngestionStage =
  | "PROVIDER_SYNC"
  | "DRIVE_DOWNLOAD"
  | "NORMALIZE"
  | "R2_PUT"
  | "AI_SEARCH_UPLOAD"
  | "D1_MARK_INDEXED";

function safeIngestionError(error: unknown) {
  return {
    error_name: error instanceof Error ? error.name : typeof error,
    safe_message: error instanceof Error ? error.message.slice(0, 300) : "unknown",
  };
}

export type AiSearchUploadStatus =
  | "completed"
  | "error"
  | "skipped"
  | "queued"
  | "running"
  | "outdated";

export type AiSearchUploadInfo = {
  id?: string;
  key?: string;
  status?: AiSearchUploadStatus;
  error?: string;
  chunks_count?: number | null;
  file_size?: number | null;
};

/**
 * Tamaño máximo de un item, según la referencia oficial del binding de Items: 4 MB.
 *
 * No es una estimación: está documentado. Un artefacto normalizado que lo supere no se
 * envía —fallar opacamente contra el proveedor no dice nada— y se clasifica como
 * `PARTITION_REQUIRED`, que es el trabajo de SPRINT_01B.
 */
export const AI_SEARCH_MAX_ITEM_BYTES = 4 * 1024 * 1024;

/**
 * Campos de metadata que viajan al índice.
 *
 * La referencia oficial fija un máximo de 5 por instancia y estábamos enviando SEIS:
 * `organization_id`, `matter_id`, `document_id`, `document_version`, `is_current` e
 * `is_active`. Este último dejó de filtrarse cuando su cláusula dejó la recuperación en
 * cero durante días, así que ya no lo usa nadie: se retira y quedamos exactamente en el
 * límite documentado, conservando lo que sí se filtra.
 */
export function indexMetadata(args: {
  organizationId: string;
  matterId: string;
  documentId: string;
  documentVersion: number | string;
}): Record<string, string> {
  return {
    organization_id: args.organizationId,
    matter_id: args.matterId,
    document_id: args.documentId,
    document_version: String(args.documentVersion),
    is_current: "true",
  };
}

type AiSearchIngestionBinding = {
  items?: {
    /**
     * Encola el item y RETORNA. La indexación ocurre en segundo plano.
     * Documentado en la referencia oficial del binding de Items.
     */
    upload?: (
      name: string,
      content: string,
      options?: { metadata?: Record<string, string> },
    ) => Promise<AiSearchUploadInfo>;
    uploadAndPoll?: (
      name: string,
      content: string,
      options?: {
        metadata?: Record<string, string>;
        pollIntervalMs?: number;
        timeoutMs?: number;
      },
    ) => Promise<AiSearchUploadInfo>;
    /** Estado del item ya subido: `status`, `chunks_count`, `file_size`, … */
    get?: (itemId: string) => { info: () => Promise<AiSearchUploadInfo> };
  };
};

/**
 * Ingesta inmediata en Cloudflare AI Search.
 *
 * R2 sigue siendo el mirror trazable del Markdown normalizado, pero `AI_INDEXED`
 * sólo se marca después de usar la capacidad nativa `items.uploadAndPoll`. Esto
 * evita que la orquestación arranque sobre un documento recién escrito en R2 que
 * todavía no ha entrado al índice por sync diferido.
 */
/**
 * Marca el espejo indexado de un documento como INACTIVO (o lo reactiva).
 *
 * El filtro de recuperación exige `is_active = "true"`, pero ese valor se escribía en
 * la ingestión y no volvía a tocarse nunca: un documento retirado seguía en el índice
 * como activo, y una versión antigua seguía siendo recuperable hasta que la cola
 * reescribía la clave. Esta función cierra las dos brechas reescribiendo la metadata
 * en R2 y reenviando el item a AI Search con la misma clave (operación idempotente).
 *
 * Nunca borra el espejo: el retiro documental es lógico y auditable, no destructivo.
 * Devuelve `false` si no había nada que desactivar o si el índice no está configurado
 * — el estado autoritativo sigue siendo D1, que ya excluye el documento.
 */
export async function setMirrorIndexActive(
  env: Pick<Env, "ARTIFACTS" | "AI_SEARCH">,
  mirrorKey: string | null | undefined,
  active: boolean,
): Promise<boolean> {
  if (!mirrorKey) return false;
  const object = await env.ARTIFACTS.get(mirrorKey);
  if (!object) return false;
  const text = await object.text();
  const metadata = {
    ...(object.customMetadata ?? {}),
    is_active: active ? "true" : "false",
  };
  await env.ARTIFACTS.put(mirrorKey, text, {
    httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    customMetadata: metadata,
  });
  if (!env.AI_SEARCH?.items?.uploadAndPoll) return false;
  try {
    await uploadToAiSearch(env.AI_SEARCH, mirrorKey, text, metadata);
    return true;
  } catch (error) {
    // El índice puede rechazar o tardar; D1 ya excluye el documento y toda ruta de
    // recuperación revalida contra los documentos vigentes. Se registra y se sigue.
    console.warn("mirror_deactivation_failed", {
      mirror_key: mirrorKey,
      active,
      safe_message: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
    return false;
  }
}

export async function uploadToAiSearch(
  aiSearch: AiSearchIngestionBinding | null,
  key: string,
  text: string,
  metadata: Record<string, string>,
): Promise<AiSearchUploadInfo> {
  if (!aiSearch?.items?.upload) {
    throw new Error("AI Search items.upload no está configurado");
  }
  // Guardrail de tamaño con fuente: 4 MB documentados. Enviar por encima sería fallar
  // contra el proveedor sin saber por qué.
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > AI_SEARCH_MAX_ITEM_BYTES) {
    throw new PartitionRequiredError(bytes);
  }
  const item = await aiSearch.items.upload(key, text, { metadata });
  if (item.status === "error") {
    // El proveedor rechazó el contenido: eso sí es un fallo real.
    throw new Error(`AI Search rechazó el item${item.error ? `: ${item.error}` : ""}`);
  }
  return item;
}

/**
 * MIME que el pipeline puede convertir en contenido indexable.
 *
 * La lista ya NO vive aquí. Vivía aquí y a la vez, distinta, en la ruta de carga: ésta
 * no tenía `.doc` ni imágenes y aquélla los aceptaba, así que dos documentos del lote
 * de 17 subieron, esperaron turno, se procesaron y sólo entonces se declararon no
 * indexables. La única definición está en `document-formats.ts`, y la usan la pantalla
 * —para avisar al elegir el archivo—, la ruta de carga y esta ingestión.
 */
export function isIndexableMimeType(mimeType: string): boolean {
  return isReadableMimeType(mimeType);
}

/**
 * Normaliza a Markdown para AI Search. NUNCA interpreta el contenido convertido
 * como instrucciones. Las imágenes embebidas se omiten para no activar modelos de
 * visión ni introducir costo variable en el pipeline documental de texto.
 */
export async function normalizeToText(
  bytes: ArrayBuffer,
  mimeType: string,
  filename = "documento",
  ai?: Ai,
): Promise<string> {
  if (
    mimeType.startsWith("text/")
    || mimeType === "application/json"
    || mimeType === "application/xml"
  ) {
    return new TextDecoder().decode(bytes);
  }

  if (!isReadableMimeType(mimeType)) {
    throw new Error(`Formato no indexable: ${mimeType}`);
  }
  if (!ai) throw new Error("Workers AI toMarkdown no está configurado");

  const result = await ai.toMarkdown(
    {
      name: filename,
      blob: new Blob([bytes], { type: mimeType }),
    },
    {
      conversionOptions: {
        docx: { images: { convert: false } },
        pdf: { images: { convert: false }, metadata: false },
      },
    },
  );
  if (result.format === "error") {
    throw new Error(`Workers AI toMarkdown: ${result.error}`);
  }
  return result.data;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
