import {
  StorageNotConfiguredError,
  documentMirrorKey,
  type DocumentIngestionMessage,
} from "@iusia/domain";
import { DocumentRepository, createDb } from "@iusia/db";
import type { Env } from "../env.js";
import { DriveConnectionError, OrganizationStorageResolver } from "./drive-credentials.js";

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

export type StageTimings = Record<string, number>;

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

  async ingest(message: DocumentIngestionMessage): Promise<IngestionOutcome> {
    const db = createDb(this.env.DB);
    const documents = new DocumentRepository(db);

    const doc = await documents.findById(message.organization_id, message.document_id);
    if (!doc) return { status: "SKIPPED", detail: "documento no encontrado en el registro" };
    if (doc.retiredAt) return { status: "SKIPPED", detail: "documento retirado" };
    // Una cola retrasada de v1 nunca puede sobrescribir el espejo RAG de v2.
    if (doc.driveFileId !== message.drive_file_id) {
      return { status: "SKIPPED", detail: "versión no vigente" };
    }

    // Las credenciales son las del ALMACENAMIENTO DE LA ORGANIZACIÓN, no las del
    // abogado que vinculó el archivo: una ingestión en background no puede depender
    // del OAuth personal de nadie. Sin conexión válida el documento queda PENDIENTE y
    // el mensaje se ACK-ea: ningún reintento resolverá una reconexión OAuth pendiente.
    let storage;
    try {
      storage = await this.storage.resolveAdapter(message.organization_id);
    } catch (error) {
      if (error instanceof DriveConnectionError) {
        await documents.setStatus(message.organization_id, message.document_id, "PENDIENTE");
        return { status: "STORAGE_NOT_CONFIGURED", detail: error.code };
      }
      throw error;
    }

    let stage: IngestionStage = "DRIVE_DOWNLOAD";
    // Reloj por etapa. Sin esto, la única evidencia era `indexed_at` —cuándo terminó—,
    // así que no se podía saber si los segundos se iban en la descarga, en la
    // conversión o en el índice. «Optimizar la ingestión» era adivinar.
    const clock = new StageClock();
    await documents.markIngestionStarted(message.organization_id, message.document_id);
    try {
      const bytes = await withDeadline(
        storage.download(message.drive_file_id),
        DOWNLOAD_DEADLINE_MS,
        "DRIVE_DOWNLOAD",
      );
      clock.mark("download_ms");
      stage = "NORMALIZE";
      const text = await withDeadline(
        normalizeToText(bytes, doc.mimeType, doc.name, this.env.AI),
        NORMALIZE_DEADLINE_MS,
        "NORMALIZE",
      );
      clock.mark("normalize_ms");

      const key = documentMirrorKey(
        message.organization_id,
        message.matter_id,
        message.document_id,
      );
      // Metadata de R2 → la usa AI Search como folder/tenant para el filtrado.
      stage = "R2_PUT";
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
      await uploadToAiSearch(this.env.AI_SEARCH ?? null, key, text, {
        organization_id: message.organization_id,
        matter_id: message.matter_id,
        document_id: message.document_id,
        document_version: String(doc.currentVersion),
        is_current: "true",
        is_active: "true",
      });
      clock.mark("ai_search_ms");

      stage = "D1_MARK_INDEXED";
      await documents.markIndexed(
        message.organization_id,
        message.document_id,
        key,
        await sha256Hex(text),
        clock.finish(),
      );
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
      await documents.markIngestionFailed(message.organization_id, message.document_id);
      return {
        status: "ERROR",
        detail: error instanceof Error ? error.message : "error desconocido",
      };
    }
  }
}

export type IngestionStage =
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

type AiSearchIngestionBinding = {
  items?: {
    uploadAndPoll?: (
      name: string,
      content: string,
      options?: {
        metadata?: Record<string, string>;
        pollIntervalMs?: number;
        timeoutMs?: number;
      },
    ) => Promise<AiSearchUploadInfo>;
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
  if (!aiSearch?.items?.uploadAndPoll) {
    throw new Error("AI Search uploadAndPoll no está configurado");
  }
  const item = await aiSearch.items.uploadAndPoll(key, text, {
    metadata,
    pollIntervalMs: 1000,
    timeoutMs: 120000,
  });
  if (item.status !== "completed") {
    throw new Error(
      `AI Search uploadAndPoll finalizó con status=${item.status ?? "unknown"}${item.error ? `: ${item.error}` : ""}`,
    );
  }
  return item;
}

/**
 * MIME que el pipeline puede convertir en contenido indexable sin parsers propios.
 * Texto/JSON/XML conservan el decoder estable existente. Los formatos ricos usan
 * la capacidad nativa de Workers AI; audio, vídeo e imágenes siguen fuera del RAG.
 */
const WORKERS_AI_MARKDOWN_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

export function isIndexableMimeType(mimeType: string): boolean {
  return mimeType.startsWith("text/")
    || mimeType === "application/json"
    || mimeType === "application/xml"
    || WORKERS_AI_MARKDOWN_MIME.has(mimeType);
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

  if (!WORKERS_AI_MARKDOWN_MIME.has(mimeType)) {
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
