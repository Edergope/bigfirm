import {
  StorageNotConfiguredError,
  documentMirrorKey,
  type DocumentIngestionMessage,
} from "@iusia/domain";
import { DocumentRepository, createDb } from "@iusia/db";
import type { Env } from "../env.js";
import { DriveConnectionError, DriveCredentialResolver } from "./drive-credentials.js";

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
}

export class IngestionService {
  constructor(
    private readonly env: Env,
    /** Resuelve credenciales de Drive del usuario que vinculó el documento. */
    private readonly driveCredentials: DriveCredentialResolver,
  ) {}

  static forEnv(env: Env): IngestionService {
    return new IngestionService(env, DriveCredentialResolver.forEnv(env));
  }

  async ingest(message: DocumentIngestionMessage): Promise<IngestionOutcome> {
    const db = createDb(this.env.DB);
    const documents = new DocumentRepository(db);

    const doc = await documents.findById(message.organization_id, message.document_id);
    if (!doc) return { status: "SKIPPED", detail: "documento no encontrado en el registro" };
    // Una cola retrasada de v1 nunca puede sobrescribir el espejo RAG de v2.
    if (doc.driveFileId !== message.drive_file_id) {
      return { status: "SKIPPED", detail: "versión no vigente" };
    }

    // Las credenciales de Drive pertenecen al usuario que vinculó el archivo (tiene
    // acceso de lectura sobre él). Sin conexión válida, el documento queda PENDIENTE
    // y el mensaje se ACK-ea: ningún reintento resolverá una reconexión OAuth pendiente.
    let storage;
    try {
      storage = await this.driveCredentials.resolveAdapter(doc.linkedBy);
    } catch (error) {
      if (error instanceof DriveConnectionError) {
        await documents.setStatus(message.organization_id, message.document_id, "PENDIENTE");
        return { status: "STORAGE_NOT_CONFIGURED", detail: error.code };
      }
      throw error;
    }

    try {
      const bytes = await storage.download(message.drive_file_id);
      const text = await normalizeToText(bytes, doc.mimeType, doc.name, this.env.AI);

      const key = documentMirrorKey(
        message.organization_id,
        message.matter_id,
        message.document_id,
      );
      // Metadata de R2 → la usa AI Search como folder/tenant para el filtrado.
      await this.env.ARTIFACTS.put(key, text, {
        httpMetadata: { contentType: "text/markdown; charset=utf-8" },
        customMetadata: {
          organization_id: message.organization_id,
          matter_id: message.matter_id,
          document_id: message.document_id,
          document_version: String(doc.currentVersion),
          is_current: "true",
          source_mime_type: doc.mimeType,
        },
      });

      await documents.markIndexed(
        message.organization_id,
        message.document_id,
        key,
        await sha256Hex(text),
      );
      return { status: "INDEXED", detail: key };
    } catch (error) {
      if (error instanceof StorageNotConfiguredError) {
        return { status: "STORAGE_NOT_CONFIGURED" };
      }
      return {
        status: "ERROR",
        detail: error instanceof Error ? error.message : "error desconocido",
      };
    }
  }
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
