import { z } from "zod";

/**
 * Ports (interfaces de dominio) para almacenamiento y recuperación documental.
 *
 * El dominio NO conoce el SDK de Google ni el binding de Cloudflare AI Search.
 * Los adapters concretos viven en la capa de infraestructura (apps/web/integrations).
 * Esto permite sustituir el proveedor sin tocar el dominio jurídico.
 */

/** Estado de configuración de una integración externa. */
export const INTEGRATION_STATES = ["CONNECTED", "NOT_CONFIGURED", "ERROR"] as const;
export const IntegrationState = z.enum(INTEGRATION_STATES);
export type IntegrationState = z.infer<typeof IntegrationState>;

export interface StoredFileMetadata {
  provider_file_id: string;
  name: string;
  mime_type: string;
  size_bytes: number | null;
  modified_at: string | null;
  web_view_link: string | null;
}

/**
 * Port de almacenamiento documental. Implementado por GoogleDriveAdapter.
 * Cuando la integración no está configurada, `status()` devuelve NOT_CONFIGURED
 * y las operaciones lanzan `StorageNotConfiguredError` — nunca datos inventados.
 */
export interface DocumentStorageProvider {
  readonly id: string;
  status(): IntegrationState;
  getMetadata(fileId: string): Promise<StoredFileMetadata>;
  /** Descarga el contenido para normalizar e indexar. Nunca lo trata como instrucciones. */
  download(fileId: string): Promise<ArrayBuffer>;
}

export class StorageNotConfiguredError extends Error {
  constructor(readonly provider: string) {
    super(`El proveedor de almacenamiento "${provider}" no está configurado`);
    this.name = "StorageNotConfiguredError";
  }
}

// ─────────────────────────── Recuperación (RAG) ───────────────────────────

/**
 * Convención de carpeta del espejo R2 que hace el aislamiento TÉCNICO, no textual.
 * Cada documento se indexa bajo esta ruta; el filtro de recuperación se ancla a ella.
 */
export function tenantFolderPrefix(organizationId: string): string {
  return `org/${organizationId}/`;
}

export function matterFolderPrefix(organizationId: string, matterId: string): string {
  return `org/${organizationId}/matter/${matterId}/`;
}

export function documentMirrorKey(
  organizationId: string,
  matterId: string,
  documentId: string,
): string {
  return `${matterFolderPrefix(organizationId, matterId)}doc/${documentId}.txt`;
}

/**
 * Clave del INGRESO DURABLE: los bytes tal como llegaron del navegador.
 *
 * Distinta del espejo normalizado (`documentMirrorKey`), que guarda el Markdown que
 * consume el índice. Ésta guarda el binario original y existe por una razón concreta:
 * la petición de carga debe poder terminar en cuanto los bytes están a salvo, sin
 * esperar a Drive, a la normalización ni al índice.
 *
 * Es temporal por diseño: se borra en cuanto el proveedor definitivo confirma que tiene
 * el archivo. Mientras exista, es la garantía de que un fallo o un cambio de pestaña no
 * pierde lo que el abogado ya entregó.
 */
export function documentIngressKey(
  organizationId: string,
  matterId: string,
  documentId: string,
): string {
  return `${matterFolderPrefix(organizationId, matterId)}ingress/${documentId}`;
}

export interface RetrievalScope {
  organization_id: string;
  /** Matters a los que el usuario tiene acceso autorizado. Vacío ⇒ sin resultados. */
  authorized_matter_ids: readonly string[];
}

export interface RetrievalQuery {
  scope: RetrievalScope;
  query: string;
  max_results?: number;
}

export interface RetrievalResult {
  document_id: string;
  matter_id: string;
  score: number;
  excerpt: string;
  source_folder: string;
}

/**
 * Filtro de recuperación anclado al tenant. Devuelve el conjunto de prefijos de
 * carpeta permitidos: la organización y, dentro de ella, sólo los matters
 * autorizados. Un `RetrievalProvider` NUNCA debe buscar fuera de estos prefijos.
 *
 * Esta función es la garantía técnica de que ninguna consulta cruza de firma.
 */
export function allowedFolderPrefixes(scope: RetrievalScope): string[] {
  if (scope.authorized_matter_ids.length === 0) return [];
  return scope.authorized_matter_ids.map((m) =>
    matterFolderPrefix(scope.organization_id, m),
  );
}

/** Verifica que una carpeta de resultado pertenezca al alcance. Defensa en profundidad. */
export function folderIsInScope(folder: string, scope: RetrievalScope): boolean {
  const allowed = allowedFolderPrefixes(scope);
  return allowed.some((prefix) => folder.startsWith(prefix));
}

export interface RetrievalProvider {
  readonly id: string;
  status(): IntegrationState;
  search(query: RetrievalQuery): Promise<RetrievalResult[]>;
}

// ─────────────────────────── Ingestión (Queue) ───────────────────────────

/**
 * Mensaje de la cola de ingestión documental. Contrato compartido por productor
 * (endpoint de vinculación / webhook de Drive) y consumidor (Worker de ingestión).
 * Toda ingestión es idempotente por `document_id` (misma clave de espejo R2).
 */
export const DocumentIngestionMessage = z.object({
  organization_id: z.string().min(1),
  matter_id: z.string().min(1),
  document_id: z.string().min(1),
  /**
   * Archivo en el proveedor definitivo. AUSENTE cuando los bytes acaban de entrar y
   * todavía no se han sincronizado con Drive: en ese caso el trabajo de fondo los lee
   * del ingreso durable en R2 y crea el archivo allí.
   */
  drive_file_id: z.string().min(1).optional(),
  /** Qué disparó la ingestión; sólo trazabilidad, nunca instrucciones. */
  reason: z.enum(["LINKED", "DRIVE_CHANGE", "MANUAL_REINDEX", "UPLOADED", "RETRY"]),
  /** Marca de idempotencia adicional para deduplicar reintentos de Queue. */
  enqueued_at: z.string().datetime(),
});
export type DocumentIngestionMessage = z.infer<typeof DocumentIngestionMessage>;
