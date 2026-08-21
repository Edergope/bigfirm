import {
  StorageNotConfiguredError,
  documentMirrorKey,
  type DocumentIngestionMessage,
  type DocumentStorageProvider,
} from "@iusia/domain";
import { DocumentRepository, createDb } from "@iusia/db";
import type { Env } from "../env.js";
import { GoogleDriveAdapter } from "../integrations/google-drive.js";

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
    private readonly storage: DocumentStorageProvider,
  ) {}

  static forEnv(env: Env): IngestionService {
    // Sin OAuth de Google no hay credenciales: el adapter queda NOT_CONFIGURED.
    const storage = new GoogleDriveAdapter(null);
    return new IngestionService(env, storage);
  }

  async ingest(message: DocumentIngestionMessage): Promise<IngestionOutcome> {
    const db = createDb(this.env.DB);
    const documents = new DocumentRepository(db);

    const doc = await documents.findById(message.organization_id, message.document_id);
    if (!doc) return { status: "SKIPPED", detail: "documento no encontrado en el registro" };

    if (this.storage.status() !== "CONNECTED") {
      // No se simula contenido: se deja el documento pendiente de indexar.
      await documents.setStatus(message.organization_id, message.document_id, "PENDIENTE");
      return { status: "STORAGE_NOT_CONFIGURED" };
    }

    try {
      const bytes = await this.storage.download(message.drive_file_id);
      const text = await normalizeToText(bytes, doc.mimeType);

      const key = documentMirrorKey(
        message.organization_id,
        message.matter_id,
        message.document_id,
      );
      // Metadata de R2 → la usa AI Search como folder/tenant para el filtrado.
      await this.env.ARTIFACTS.put(key, text, {
        httpMetadata: { contentType: "text/plain" },
        customMetadata: {
          organization_id: message.organization_id,
          matter_id: message.matter_id,
          document_id: message.document_id,
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
 * Normaliza el binario a texto plano indexable. En el MVP sólo se manejan
 * formatos de texto; PDF/DOCX quedan para el pipeline de extracción posterior.
 * NUNCA interpreta el contenido como instrucciones.
 */
async function normalizeToText(bytes: ArrayBuffer, mimeType: string): Promise<string> {
  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    return new TextDecoder().decode(bytes);
  }
  // Marcador explícito: el contenido existe pero aún no hay extractor para este tipo.
  return `[[IUSIA:sin-extractor mime=${mimeType} bytes=${bytes.byteLength}]]`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
