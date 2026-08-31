import { z } from "zod";

/**
 * Modelo del workspace documental sobre Google Drive.
 *
 * Google Drive es el repositorio primario; IUSIA es la capa jurídica. Este módulo
 * fija la ESTRUCTURA y las CONVENCIONES de forma determinista y sin dependencias
 * de red, para que la lógica sea unit-testable con independencia del OAuth real:
 *
 *   IUSIA / [Firma] / Expedientes / [Referencia] - [Asunto]
 *       ├── 01 Documentos aportados
 *       └── 02 Documentos generados por IUSIA
 *   IUSIA / [Firma] / Plantillas
 */

export const DRIVE_FOLDER_NAMES = {
  root: "IUSIA",
  matters: "Expedientes",
  templates: "Plantillas",
  uploaded: "01 Documentos aportados",
  generated: "02 Documentos generados por IUSIA",
  retired: "99 Documentos retirados",
} as const;

/** Rol de una carpeta gestionada por IUSIA. Su combinación identifica la carpeta. */
export const DRIVE_FOLDER_KINDS = [
  "ROOT", // IUSIA
  "FIRM", // IUSIA / [Firma]
  "MATTERS", // .../ Expedientes
  "TEMPLATES", // IUSIA / [Firma] / Plantillas
  "MATTER", // .../ [Referencia] - [Asunto]
  "UPLOADED", // .../ 01 Documentos aportados
  "GENERATED", // .../ 02 Documentos generados por IUSIA
  "RETIRED", // .../ 99 Documentos retirados
] as const;
export const DriveFolderKind = z.enum(DRIVE_FOLDER_KINDS);
export type DriveFolderKind = z.infer<typeof DriveFolderKind>;

/**
 * Nombre de la carpeta de un expediente: "[Referencia] - [Asunto]".
 *
 * El nombre es estable y legible; no lleva ids. Los caracteres que Drive no admite
 * en nombres se normalizan para que la carpeta se pueda localizar sin ambigüedad.
 */
export function matterFolderName(reference: string, title: string): string {
  const ref = sanitizeName(reference) || "SIN-REF";
  const asunto = sanitizeName(title) || "Expediente";
  return `${ref} - ${truncate(asunto, 80)}`;
}

/**
 * Nombre determinista de un documento generado:
 *   [REFERENCIA]_[TIPO]_[YYYY-MM-DD]_v[N].[ext]
 *
 * Nunca lleva execution ids, hashes ni ids aleatorios visibles: esos viven en la
 * metadata, no en el nombre que ve el abogado.
 */
export function generatedFileName(input: {
  reference: string;
  documentType: string;
  date: Date;
  version: number;
  extension: "docx" | "pdf";
}): string {
  const ref = sanitizeName(input.reference) || "SIN-REF";
  const type = humanDocumentTypeLabel(input.documentType);
  const day = input.date.toISOString().slice(0, 10);
  const v = Math.max(1, Math.floor(input.version));
  return `${ref} - ${type} - ${day} - v${v}.${input.extension}`;
}

/** Etiqueta visible de tipo documental. Los enums internos nunca nombran archivos. */
export function humanDocumentTypeLabel(documentType: string): string {
  const normalized = sanitizeToken(documentType);
  if (normalized === "OPINION" || normalized === "OPINION-LEGAL") return "Concepto jurídico";
  return sanitizeName(documentType) || "Documento";
}

/** MIME de exportación de un Google Doc nativo. */
export const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
export const EXPORT_MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
} as const;

/**
 * Errores del módulo documental, con su traducción a lenguaje de despacho. El
 * abogado nunca ve el enum; ve la frase y, cuando aplica, qué hacer.
 */
export const DOCUMENT_ERROR_CODES = [
  "DRIVE_NOT_CONNECTED",
  "DRIVE_PERMISSION_REQUIRED",
  "UPLOAD_FAILED",
  "INGESTION_FAILED",
  "INDEXING_FAILED",
  "TEMPLATE_NOT_FOUND",
  "TEMPLATE_AMBIGUOUS",
  "TEMPLATE_NOT_RENDERABLE",
  "TEMPLATE_VALIDATION_FAILED",
  "DOCUMENT_GENERATION_FAILED",
  "DRIVE_PERSIST_FAILED",
] as const;
export type DocumentErrorCode = (typeof DOCUMENT_ERROR_CODES)[number];

export const DOCUMENT_ERROR_MESSAGES: Record<DocumentErrorCode, string> = {
  DRIVE_NOT_CONNECTED: "No fue posible acceder al almacenamiento documental. Intenta nuevamente o contacta a Dirección.",
  DRIVE_PERMISSION_REQUIRED:
    "No fue posible acceder al almacenamiento documental. Intenta nuevamente o contacta a Dirección.",
  UPLOAD_FAILED: "No fue posible subir el documento. Inténtalo de nuevo.",
  INGESTION_FAILED: "El documento se subió pero no pudo procesarse. Lo reintentaremos.",
  INDEXING_FAILED: "El documento se procesó pero aún no está disponible para análisis.",
  TEMPLATE_NOT_FOUND: "No hay una plantilla oficial para este tipo de documento.",
  TEMPLATE_AMBIGUOUS:
    "Hay más de una plantilla oficial activa para este tipo de documento. Elige cuál debe usarse.",
  TEMPLATE_NOT_RENDERABLE: "La plantilla oficial no tiene campos renderizables y no puede publicarse.",
  TEMPLATE_VALIDATION_FAILED: "Faltan datos necesarios para completar la plantilla.",
  DOCUMENT_GENERATION_FAILED: "No fue posible generar el documento. Inténtalo de nuevo.",
  DRIVE_PERSIST_FAILED: "El documento se generó pero no pudo guardarse en Drive.",
};

export function documentErrorMessage(code: string): string {
  return (
    DOCUMENT_ERROR_MESSAGES[code as DocumentErrorCode] ??
    "Ocurrió un problema con el documento. Inténtalo de nuevo."
  );
}

// ─────────────────────────── Utilidades de nombre ───────────────────────────

/** Nombre de carpeta/archivo legible: sin caracteres inválidos de Drive. */
function sanitizeName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Token para nombre de archivo: sin espacios ni separadores, ASCII seguro. */
function sanitizeToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase();
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max).trim();
}
