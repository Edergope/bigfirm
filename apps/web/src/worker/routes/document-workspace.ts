import { Hono } from "hono";
import { z } from "zod";
import {
  documentTypeForIntent,
  producesDocument,
  statusAfterDraftGenerated,
} from "@iusia/domain";
import { IusiaError, documentErrorMessage } from "@iusia/domain";
import { TemplateRepository, createDb } from "@iusia/db";
import type { AppBindings } from "../context.js";
import { DriveConnectionError, OrganizationStorageResolver } from "../services/drive-credentials.js";
import { DriveWorkspaceService } from "../services/drive-workspace.js";
import {
  DocumentGenerationError,
  DocumentGenerationService,
} from "../services/document-generation.js";
import { DocumentDraftError, DocumentDraftService } from "../services/document-draft.js";
import { SEED_TEMPLATE_IDS, seedOpinionTemplate } from "../services/template-seed.js";
import { isIndexableMimeType, normalizeToText, setMirrorIndexActive } from "../services/ingestion.js";
import { discoverTemplateVariables } from "../services/template-placeholders.js";

export const documentWorkspaceRoutes = new Hono<AppBindings>();

/** MIME aceptados: sólo lo que la ingestión ya sabe normalizar de forma segura. */
const ACCEPTED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "text/plain",
  "text/markdown",
  "application/json",
  "application/xml",
  "text/xml",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
]);
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const OFFICIAL_TEMPLATE_PREFIX = "official-templates/pisoso-legal/";

/**
 * Acota las conversiones de Workers AI durante una importación masiva. La versión
 * serial agotaba la ventana de la petición aunque cada DOCX fuera válido; el límite
 * conserva el back-pressure sin introducir una cola, workflow o parser adicional.
 */
async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await map(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

async function withTimeout<T>(label: string, timeoutMs: number, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new IusiaError("CONFLICT", `${label} excedió el tiempo permitido`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
const OfficialTemplateManifest = z.object({
  templates: z.array(z.object({
    file: z.string().min(1),
    name: z.string().min(1),
    document_type: z.string().min(1),
    category: z.string().min(1),
    version: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })),
});

function initialIngestionStatus(mime: string): "NOT_INDEXABLE" | "PROCESSING" {
  return isIndexableMimeType(mime) ? "PROCESSING" : "NOT_INDEXABLE";
}

async function checksum(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeFilename(value: string): string {
  return value.replace(/[\r\n"]/g, "_");
}

/** Traduce un fallo de Drive a código de producto (nunca el enum crudo). */
function driveErrorToCode(error: unknown): string {
  if (error instanceof DriveConnectionError) {
    return error.code === "DRIVE_NOT_CONNECTED" ? "DRIVE_NOT_CONNECTED" : "DRIVE_PERMISSION_REQUIRED";
  }
  return "UPLOAD_FAILED";
}

/**
 * Sube documentos APORTADOS a la carpeta "01 Documentos aportados" del expediente
 * en Drive, los registra y dispara la ingestión (Queue→R2→AI Search→RAG).
 *
 * Reutiliza el pipeline existente: no crea otra cola ni otro índice.
 */
documentWorkspaceRoutes.post("/matters/:matterId/documents/upload", async (c) => {
  const { documents, matters, authz, audit } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const matterId = c.req.param("matterId");

  await authz.authorizeMatter(organizationId, userId, matterId, "document:link");
  const matter = await matters.findById(organizationId, matterId);
  if (!matter) throw new IusiaError("NOT_FOUND", "Expediente no encontrado");

  const form = await c.req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) throw new IusiaError("VALIDATION_FAILED", "No se adjuntaron archivos");

  const workspace = DriveWorkspaceService.forEnv(c.env);
  let uploadedFolder: string;
  try {
    const folders = await workspace.ensureMatterFolders(userId, organizationId, {
      id: matter.id,
      reference: matter.reference,
      title: matter.title,
    });
    uploadedFolder = folders.uploaded;
  } catch (error) {
    const code = driveErrorToCode(error);
    throw new IusiaError("CONFLICT", documentErrorMessage(code), { code });
  }

  const drive = await OrganizationStorageResolver.forEnv(c.env).resolveAdapter(organizationId, { requireWrite: true });

  const results: Array<{
    document_id: string;
    name: string;
    status: string;
    deduplicated?: boolean;
  }> = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      results.push({ document_id: "", name: file.name, status: "UPLOAD_FAILED" });
      continue;
    }
    const mime = file.type || "application/octet-stream";
    if (!ACCEPTED_MIME.has(mime)) {
      results.push({ document_id: "", name: file.name, status: "UNSUPPORTED" });
      continue;
    }
    try {
      const bytes = await file.arrayBuffer();
      const ingestionStatus = initialIngestionStatus(mime);

      // Un REINTENTO TÉCNICO no incorpora el documento dos veces. Se compara el
      // binario por checksum contra lo que el expediente ya tiene: si es el mismo
      // archivo, se devuelve el documento existente en vez de subirlo otra vez.
      // Volver a aportar el mismo archivo a propósito es una acción distinta —crear
      // una versión nueva— y tiene su propia ruta.
      const fileChecksum = await checksum(bytes);
      const alreadyThere = await documents.findByChecksum(organizationId, matterId, fileChecksum);
      if (alreadyThere) {
        results.push({
          document_id: alreadyThere.documentId,
          name: alreadyThere.filename,
          status: alreadyThere.ingestionStatus,
          deduplicated: true,
        });
        continue;
      }

      const meta = await drive.uploadFile({
        name: file.name,
        parentId: uploadedFolder,
        mimeType: mime,
        content: bytes,
      });
      const documentId = await documents.link({
        organizationId,
        matterId,
        driveFileId: meta.provider_file_id,
        name: meta.name,
        mimeType: mime,
        classification: "FUENTE",
        linkedBy: userId,
        sizeBytes: file.size,
        checksum: fileChecksum,
        ingestionStatus,
      });
      if (ingestionStatus === "PROCESSING") {
        await c.env.DOCUMENT_INGESTION.send({
          organization_id: organizationId,
          matter_id: matterId,
          document_id: documentId,
          drive_file_id: meta.provider_file_id,
          reason: "LINKED",
          enqueued_at: new Date().toISOString(),
        });
      }
      results.push({ document_id: documentId, name: meta.name, status: ingestionStatus });
    } catch {
      results.push({ document_id: "", name: file.name, status: "UPLOAD_FAILED" });
    }
  }

  await audit.record({
    organizationId,
    matterId,
    actorUserId: userId,
    action: "document.upload",
    resourceType: "document",
    outcome: results.some((r) => r.status === "PROCESSING") ? "SUCCESS" : "FAILURE",
    detail: { count: results.length, uploaded_folder: uploadedFolder },
  });

  return c.json({ uploaded: results }, 201);
});

/**
 * Workspace documental del expediente: aportados y generados, desde el read-model.
 * Incluye los ids de carpeta de Drive para "abrir en Drive".
 */
documentWorkspaceRoutes.get("/matters/:matterId/workspace", async (c) => {
  const { documents, matters, authz } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const matterId = c.req.param("matterId");

  await authz.authorizeMatter(organizationId, userId, matterId, "document:read");
  const matter = await matters.findById(organizationId, matterId);
  if (!matter) throw new IusiaError("NOT_FOUND", "Expediente no encontrado");

  const docs = await documents.listForMatter(organizationId, matterId);
  // El identificador del proveedor NO viaja al cliente: no le sirve para nada —toda
  // lectura se resuelve por `document_id` tras comprobar ACL— y exponerlo era la
  // materia prima de la vinculación cruzada entre expedientes.
  const shape = (d: (typeof docs)[number]) => ({
    id: d.id,
    name: d.name,
    mime_type: d.mimeType,
    status: d.status,
    classification: d.classification,
    current_version: d.currentVersion,
    size_bytes: d.sizeBytes,
    ingestion_status: d.ingestionStatus,
    updated_at: d.updatedAt,
    content_source: d.contentSource,
    // Provenance visible del entregable: de qué plantilla y con qué agente salió.
    generated_from_template_id: d.generatedFromTemplateId,
    generated_from_template_version: d.generatedFromTemplateVersion,
    generated_by_agent_id: d.generatedByAgentId,
  });

  return c.json({
    uploaded: docs.filter((d) => d.classification !== "ENTREGABLE").map(shape),
    generated: docs.filter((d) => d.classification === "ENTREGABLE").map(shape),
  });
});

/** Historial de versiones, siempre después de autorizar el Matter. */
documentWorkspaceRoutes.get("/matters/:matterId/documents/:documentId/versions", async (c) => {
  const { documents, authz } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const matterId = c.req.param("matterId");
  const documentId = c.req.param("documentId");
  await authz.authorizeMatter(organizationId, userId, matterId, "document:read");
  const document = await documents.findById(organizationId, documentId);
  if (!document || document.matterId !== matterId) {
    throw new IusiaError("NOT_FOUND", "Documento no encontrado");
  }
  const versions = await documents.listVersions(organizationId, documentId);
  return c.json({
    versions: versions.map((v) => ({
      id: v.id,
      version_number: v.versionNumber,
      filename: v.filename,
      mime_type: v.mimeType,
      size_bytes: v.sizeBytes,
      checksum: v.checksum,
      created_by: v.createdBy,
      created_at: v.createdAt,
      change_type: v.changeType,
      change_summary: v.changeSummary,
      ingestion_status: v.ingestionStatus,
      is_current: v.isCurrent,
    })),
  });
});

/**
 * Descarga/preview privado. El cliente nunca envía drive_file_id: lo resolvemos
 * desde document_id + versión después de comprobar ACL y tenant.
 */
documentWorkspaceRoutes.get("/matters/:matterId/documents/:documentId/content", async (c) => {
  const { documents, authz } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const matterId = c.req.param("matterId");
  const documentId = c.req.param("documentId");
  await authz.authorizeMatter(organizationId, userId, matterId, "document:read");
  const document = await documents.findById(organizationId, documentId);
  if (!document || document.matterId !== matterId || document.retiredAt) {
    throw new IusiaError("NOT_FOUND", "Documento no encontrado");
  }
  const rawVersion = c.req.query("version");
  const versionNumber = rawVersion ? Number.parseInt(rawVersion, 10) : undefined;
  if (rawVersion && (!Number.isInteger(versionNumber) || (versionNumber ?? 0) < 1)) {
    throw new IusiaError("VALIDATION_FAILED", "Versión inválida");
  }
  const version = await documents.findVersion(organizationId, documentId, versionNumber);
  if (!version || version.matterId !== matterId) {
    throw new IusiaError("NOT_FOUND", "Versión no encontrada");
  }
  // La ACL autoriza al solicitante; la firma provee el storage físico.
  const drive = await OrganizationStorageResolver.forEnv(c.env).resolveAdapter(organizationId);
  const bytes = await drive.download(version.driveFileId);
  const disposition = c.req.query("download") === "1" ? "attachment" : "inline";
  return new Response(bytes, {
    headers: {
      "Content-Type": version.mimeType,
      "Content-Disposition": `${disposition}; filename="${safeFilename(version.filename)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

const VERSION_CHANGE_TYPES = [
  "Corrección",
  "Revisión jurídica",
  "Comentarios del cliente",
  "Versión para firma",
  "Documento firmado",
  "Otro",
] as const;

/** Nueva versión: número server-side, versión anterior preservada y reingestión vigente. */
documentWorkspaceRoutes.post("/matters/:matterId/documents/:documentId/versions", async (c) => {
  const { documents, matters, authz, audit } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const matterId = c.req.param("matterId");
  const documentId = c.req.param("documentId");
  await authz.authorizeMatter(organizationId, userId, matterId, "document:link");
  const [document, matter] = await Promise.all([
    documents.findById(organizationId, documentId),
    matters.findById(organizationId, matterId),
  ]);
  if (!document || document.matterId !== matterId || document.retiredAt || !matter) {
    throw new IusiaError("NOT_FOUND", "Documento no encontrado");
  }

  const form = await c.req.formData();
  const file = form.get("file");
  const changeType = String(form.get("change_type") ?? "");
  const changeSummary = String(form.get("change_summary") ?? "").trim();
  if (!(file instanceof File) || !VERSION_CHANGE_TYPES.includes(changeType as never) || !changeSummary) {
    throw new IusiaError(
      "VALIDATION_FAILED",
      "Archivo, tipo de modificación y descripción de cambios son obligatorios",
    );
  }
  if (file.size > MAX_FILE_BYTES) throw new IusiaError("VALIDATION_FAILED", "El archivo supera 50 MB");
  const mime = file.type || "application/octet-stream";
  if (!ACCEPTED_MIME.has(mime)) throw new IusiaError("VALIDATION_FAILED", "Tipo de archivo no admitido");

  const workspace = DriveWorkspaceService.forEnv(c.env);
  const folders = await workspace.ensureMatterFolders(userId, organizationId, matter);
  const targetFolder = document.classification === "ENTREGABLE" ? folders.generated : folders.uploaded;
  const bytes = await file.arrayBuffer();
  const ingestionStatus = initialIngestionStatus(mime);
  const drive = await OrganizationStorageResolver.forEnv(c.env).resolveAdapter(organizationId, { requireWrite: true });
  const meta = await drive.uploadFile({
    name: file.name,
    parentId: targetFolder,
    mimeType: mime,
    content: bytes,
  });
  const added = await documents.addVersion({
    organizationId,
    matterId,
    documentId,
    driveFileId: meta.provider_file_id,
    filename: meta.name,
    mimeType: mime,
    sizeBytes: file.size,
    checksum: await checksum(bytes),
    createdBy: userId,
    changeType,
    changeSummary,
    ingestionStatus,
  });
  if (!added) throw new IusiaError("NOT_FOUND", "Documento no encontrado");
  // La versión anterior deja de ser recuperable EN EL ACTO. Antes, su espejo seguía
  // indexado como activo hasta que la cola reescribía la clave: durante esa ventana
  // el índice contenía v1 mientras el expediente ya afirmaba v2.
  await setMirrorIndexActive(c.env, document.r2MirrorKey, false);
  if (ingestionStatus === "PROCESSING") {
    await c.env.DOCUMENT_INGESTION.send({
      organization_id: organizationId,
      matter_id: matterId,
      document_id: documentId,
      drive_file_id: meta.provider_file_id,
      reason: "DRIVE_CHANGE",
      enqueued_at: new Date().toISOString(),
    });
  }
  await audit.record({
    organizationId,
    matterId,
    actorUserId: userId,
    action: "document.version.created",
    resourceType: "document",
    resourceId: documentId,
    outcome: "SUCCESS",
    detail: { version: added.versionNumber, change_type: changeType },
  });
  return c.json({ version_number: added.versionNumber, ingestion_status: ingestionStatus }, 201);
});

const RetireDocumentInput = z.object({ reason: z.string().max(500).optional() });

/** Retiro seguro: mueve todas las versiones a Drive, conserva R2/auditoría y oculta el lógico. */
documentWorkspaceRoutes.post("/matters/:matterId/documents/:documentId/retire", async (c) => {
  const { documents, matters, authz, audit } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const matterId = c.req.param("matterId");
  const documentId = c.req.param("documentId");
  await authz.authorizeMatter(organizationId, userId, matterId, "document:link");
  const [document, matter] = await Promise.all([documents.findById(organizationId, documentId), matters.findById(organizationId, matterId)]);
  if (!document || document.matterId !== matterId || document.retiredAt || !matter) throw new IusiaError("NOT_FOUND", "Documento no encontrado");
  const parsed = RetireDocumentInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new IusiaError("VALIDATION_FAILED", "Datos de retiro inválidos");
  const folders = await DriveWorkspaceService.forEnv(c.env).ensureMatterFolders(userId, organizationId, matter);
  const versions = await documents.listVersions(organizationId, documentId);
  const drive = await OrganizationStorageResolver.forEnv(c.env).resolveAdapter(organizationId, { requireWrite: true });
  for (const version of versions) await drive.moveFile(version.driveFileId, folders.retired);
  if (!await documents.retire({ organizationId, documentId, retiredBy: userId, reason: parsed.data.reason })) throw new IusiaError("CONFLICT", "El documento ya fue retirado");
  // El retiro llega HASTA EL ÍNDICE. Marcar `retired_at` en D1 y mover los binarios
  // dejaba el espejo publicado como activo: el documento retirado seguía siendo
  // recuperable. No se borra nada — el retiro es lógico, auditable y reversible.
  const deindexed = await setMirrorIndexActive(c.env, document.r2MirrorKey, false);
  await audit.record({ organizationId, matterId, actorUserId: userId, action: "document.retired", resourceType: "document", resourceId: documentId, outcome: "SUCCESS", detail: { reason: parsed.data.reason ?? null, versions: versions.length, deindexed } });
  return c.json({ ok: true, deindexed });
});

const GenerateInput = z.object({
  document_type: z.string().min(1),
  /** Familia editorial concreta. Obligatoria si hay más de una activa para el tipo. */
  family_id: z.string().min(1).optional(),
  // Redacción manual: valores explícitos del abogado. Si se omiten, IUSIA redacta.
  values: z.record(z.string(), z.string()).optional(),
  // Indicaciones opcionales del abogado para la redacción del agente.
  instructions: z.string().max(4000).optional(),
});

/** Genera un entregable oficial con plantilla → DOCX/PDF → Drive. */
documentWorkspaceRoutes.post("/matters/:matterId/generate", async (c) => {
  const ctx = c.get("ctx");
  const { matters, authz, audit } = ctx;
  const { organizationId, userId } = c.get("session");
  const matterId = c.req.param("matterId");

  await authz.authorizeMatter(organizationId, userId, matterId, "deliverable:publish");
  const matter = await matters.findById(organizationId, matterId);
  if (!matter) throw new IusiaError("NOT_FOUND", "Expediente no encontrado");

  const parsed = GenerateInput.safeParse(await c.req.json());
  if (!parsed.success) {
    throw new IusiaError("VALIDATION_FAILED", "Datos de generación inválidos", {
      issues: parsed.error.issues,
    });
  }

  const service = DocumentGenerationService.forEnv(c.env);
  const drafter = DocumentDraftService.forEnv(c.env);
  try {
    const result = await service.generate({
      userId,
      organizationId,
      matter: { id: matter.id, reference: matter.reference, title: matter.title },
      documentType: parsed.data.document_type,
      familyId: parsed.data.family_id,
      values: parsed.data.values,
      // Sin valores manuales → el agente 08 redacta el contenido desde el expediente.
      resolveValues: async (variables) => {
        const draft = await drafter.draft({
          ctx,
          organizationId,
          matterId,
          documentType: parsed.data.document_type,
          variables,
          instructions: parsed.data.instructions,
        });
        return {
          values: draft.values,
          provenance: {
            agent_id: draft.agent_id,
            provider: draft.provider,
            model: draft.model,
            prompt_sha256: draft.prompt_sha256,
          },
        };
      },
    });
    // Provenance: matter, plantilla+versión, ids de Drive y formatos. Un solo ledger.
    await audit.record({
      organizationId,
      matterId,
      actorUserId: userId,
      action: "document.generate",
      resourceType: "document",
      resourceId: result.docx.document_id,
      outcome: "SUCCESS",
      detail: {
        template_id: result.template_id,
        template_version: result.template_version,
        docx_drive_file_id: result.docx.drive_file_id,
        pdf_drive_file_id: result.pdf.drive_file_id,
        formats: "DOCX,PDF",
        // Provenance de la redacción: agente, modelo y hash del prompt canónico.
        content_source: result.draft ? "AGENT" : "MANUAL",
        ...(result.draft
          ? {
              draft_agent_id: result.draft.agent_id,
              draft_provider: result.draft.provider,
              draft_model: result.draft.model,
              draft_prompt_sha256: result.draft.prompt_sha256,
            }
          : {}),
      },
    });
    return c.json({
      docx: { name: result.docx.name, document_id: result.docx.document_id },
      pdf: { name: result.pdf.name, document_id: result.pdf.document_id },
      content_source: result.draft ? "AGENT" : "MANUAL",
      ...(result.draft ? { drafted_by: result.draft.agent_id } : {}),
    });
  } catch (error) {
    if (error instanceof DocumentGenerationError) {
      throw new IusiaError("CONFLICT", documentErrorMessage(error.code), { code: error.code });
    }
    if (error instanceof DocumentDraftError) {
      throw new IusiaError("CONFLICT", error.message, { code: error.code });
    }
    if (error instanceof DriveConnectionError) {
      const code = driveErrorToCode(error);
      throw new IusiaError("CONFLICT", documentErrorMessage(code), { code });
    }
    throw error;
  }
});

/**
 * SMOKE TEST del stack Google (drive.file + Docs API). Sólo superadmin.
 *
 * Ejercita la cadena completa de escritura contra Drive real, sin tocar datos de
 * cliente: crea una carpeta de prueba, sube y descarga un archivo pequeño, crea un
 * Google Doc, aplica batchUpdate, y exporta a DOCX y PDF. Devuelve el resultado de
 * cada paso para el checkpoint GOOGLE_DOCUMENT_STACK.
 */
documentWorkspaceRoutes.get("/drive/smoke", async (c) => {
  const { authz } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  await authz.requireSystemSuperadmin(userId, "drive.smoke", organizationId);

  const steps: Record<string, { ok: boolean; detail?: string }> = {};
  const mark = (k: string, ok: boolean, detail?: string) => {
    steps[k] = detail ? { ok, detail } : { ok };
  };

  try {
    const drive = await OrganizationStorageResolver.forEnv(c.env).resolveAdapter(organizationId, { requireWrite: true });

    const folderId = await drive.ensureFolder(`IUSIA Smoke ${new Date().toISOString().slice(0, 10)}`);
    mark("A_create_folder", true);

    const text = new TextEncoder().encode("IUSIA smoke test. SYNTHETIC — no cliente.");
    const uploaded = await drive.uploadFile({
      name: "smoke.txt",
      parentId: folderId,
      mimeType: "text/plain",
      content: text,
    });
    mark("B_upload", true, uploaded.name);

    const meta = await drive.getMetadata(uploaded.provider_file_id);
    mark("C_metadata", meta.provider_file_id === uploaded.provider_file_id);

    const bytes = await drive.download(uploaded.provider_file_id);
    mark("D_download", bytes.byteLength > 0, `${bytes.byteLength} bytes`);

    const docId = await drive.createDoc("smoke-doc", folderId);
    mark("E_create_doc", true);

    await drive.docsReplaceText(docId, { smoke: "ok" });
    mark("F_docs_batchupdate", true);

    const docx = await drive.exportFile(
      docId,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    mark("G_export_docx", docx.byteLength > 0, `${docx.byteLength} bytes`);

    const pdf = await drive.exportFile(docId, "application/pdf");
    mark("H_export_pdf", pdf.byteLength > 0, `${pdf.byteLength} bytes`);

    const pass = Object.values(steps).every((s) => s.ok);
    return c.json({ google_document_stack: pass ? "PASS" : "FAIL", steps });
  } catch (error) {
    const code =
      error instanceof DriveConnectionError ? driveErrorToCode(error) : "SMOKE_FAILED";
    return c.json(
      {
        google_document_stack: "FAIL",
        failed_at: Object.keys(steps).length,
        steps,
        error_code: code,
        error: error instanceof Error ? error.message : "error",
      },
      200,
    );
  }
});

/** Preserva la antigua fixture técnica de Opinión Legal como retirada. Sólo superadmin. */
documentWorkspaceRoutes.post("/templates/seed", async (c) => {
  const { authz } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  await authz.requireSystemSuperadmin(userId, "templates.seed", organizationId);
  try {
    const result = await seedOpinionTemplate(c.env, userId, organizationId);
    return c.json(result);
  } catch (error) {
    if (error instanceof DriveConnectionError) {
      const code = driveErrorToCode(error);
      throw new IusiaError("CONFLICT", documentErrorMessage(code), { code });
    }
    throw error;
  }
});

/** Catálogo de plantillas visibles para la firma (institucionales + propias). */
documentWorkspaceRoutes.get("/templates", async (c) => {
  const { organizationId } = c.get("session");
  const repo = new TemplateRepository(createDb(c.env.DB));
  const rows = await repo.listForOrganization(organizationId);
  return c.json({
    templates: rows.map((t) => ({
      id: t.id,
      name: t.name,
      document_type: t.documentType,
      version: t.version,
      status: t.status,
      scope: t.scope,
      family_id: t.familyId,
      category: t.category,
      description: t.description,
      mime_type: t.mimeType,
      original_filename: t.originalFilename,
      variables: t.variables ?? [],
    })),
  });
});

/** Preview privado de plantilla visible para la firma. */
documentWorkspaceRoutes.get("/templates/:templateId/content", async (c) => {
  const { organizationId } = c.get("session");
  const repo = new TemplateRepository(createDb(c.env.DB));
  const template = await repo.findVisibleById(organizationId, c.req.param("templateId"));
  if (!template || template.status === "RETIRED") {
    throw new IusiaError("NOT_FOUND", "Plantilla no encontrada");
  }
  const drive = await OrganizationStorageResolver.forEnv(c.env).resolvePlatformAdapter();
  const ref = template.originalSourceRef ?? template.sourceRef;
  if (!ref) throw new IusiaError("NOT_FOUND", "Archivo de plantilla no encontrado");
  const bytes = template.originalSourceRef
    ? await drive.download(ref)
    : await drive.exportFile(ref, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const filename = template.originalFilename ?? `${template.name}.docx`;
  const disposition = c.req.query("download") === "1" ? "attachment" : "inline";
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `${disposition}; filename="${safeFilename(filename)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

/** Historial completo del Template Bank. Exclusivo SYSTEM_SUPERADMIN. */
documentWorkspaceRoutes.get("/admin/templates", async (c) => {
  const { authz } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  await authz.requireSystemSuperadmin(userId, "templates.manage", organizationId);
  const rows = await new TemplateRepository(createDb(c.env.DB)).listSystemHistory();
  return c.json({
    templates: rows.map((t) => ({
      id: t.id,
      family_id: t.familyId,
      name: t.name,
      document_type: t.documentType,
      category: t.category,
      description: t.description,
      version: t.version,
      status: t.status,
      scope: t.scope,
      mime_type: t.mimeType,
      checksum: t.checksum,
      original_filename: t.originalFilename,
      variables: t.variables ?? [],
      created_by: t.createdBy,
      created_at: t.createdAt,
      updated_at: t.updatedAt,
    })),
  });
});

/** Alta o nueva versión de una plantilla oficial, sin código ni borrado destructivo. */
documentWorkspaceRoutes.post("/admin/templates", async (c) => {
  const { authz, audit } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  await authz.requireSystemSuperadmin(userId, "templates.manage", organizationId);
  const form = await c.req.formData();
  const file = form.get("file");
  const name = String(form.get("name") ?? "").trim();
  const documentType = String(form.get("document_type") ?? "").trim().toUpperCase();
  const category = String(form.get("category") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const familyId = String(form.get("family_id") ?? "").trim() || undefined;
  const activate = String(form.get("activate") ?? "true") !== "false";
  if (!(file instanceof File) || !name || !documentType || !category) {
    throw new IusiaError("VALIDATION_FAILED", "Archivo, nombre, tipo documental y categoría son obligatorios");
  }
  const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (file.type !== DOCX_MIME && !file.name.toLowerCase().endsWith(".docx")) {
    throw new IusiaError("VALIDATION_FAILED", "La plantilla oficial debe ser un archivo DOCX");
  }
  const variablesRaw = String(form.get("variables") ?? "[]");
  let variablesJson: unknown;
  try {
    variablesJson = JSON.parse(variablesRaw);
  } catch {
    throw new IusiaError("VALIDATION_FAILED", "Los campos requeridos de la plantilla no son válidos");
  }
  const variablesParsed = z.array(z.object({
    key: z.string().regex(/^[a-z][a-z0-9_]*$/),
    label: z.string().min(1),
    required: z.boolean(),
    placeholder: z.string().min(1).optional(),
  })).safeParse(variablesJson);
  if (!variablesParsed.success) {
    throw new IusiaError("VALIDATION_FAILED", "Los campos requeridos de la plantilla no son válidos");
  }
  const bytes = await file.arrayBuffer();
  const normalizedTemplate = await normalizeToText(bytes, DOCX_MIME, file.name, c.env.AI);
  const detectedVariables = discoverTemplateVariables(normalizedTemplate);
  const variables = detectedVariables.length > 0 ? detectedVariables : variablesParsed.data;
  if (variables.length === 0) throw new IusiaError("VALIDATION_FAILED", "La plantilla debe contener campos renderizables.");
  const workspace = DriveWorkspaceService.forEnv(c.env);
  const { templates: templatesFolder } = await workspace.ensureFirmStructure(userId, organizationId);
  const drive = await OrganizationStorageResolver.forEnv(c.env).resolvePlatformAdapter({ requireWrite: true });
  const original = await drive.uploadFile({
    name: file.name,
    parentId: templatesFolder,
    mimeType: DOCX_MIME,
    content: bytes,
  });
  const operationalRef = await drive.importDocxAsGoogleDoc({
    name: `${name} — fuente operativa`,
    parentId: templatesFolder,
    content: bytes,
  });
  const repo = new TemplateRepository(createDb(c.env.DB));
  const created = await repo.createSystemVersion({
    familyId,
    name,
    documentType,
    category,
    description: description || null,
    sourceRef: operationalRef,
    originalSourceRef: original.provider_file_id,
    mimeType: DOCX_MIME,
    checksum: await checksum(bytes),
    originalFilename: file.name,
    variables,
    createdBy: userId,
    activate,
  });
  await audit.record({
    organizationId,
    actorUserId: userId,
    action: familyId ? "template.version.created" : "template.created",
    resourceType: "template",
    resourceId: created.id,
    outcome: "SUCCESS",
    detail: { family_id: created.familyId, version: created.version, status: activate ? "ACTIVE" : "INACTIVE" },
  });
  return c.json(created, 201);
});

/** Importa plantillas oficiales previamente cargadas en el R2 existente. */
documentWorkspaceRoutes.post("/admin/templates/import-official", async (c) => {
  const { authz, audit } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  await authz.requireSystemSuperadmin(userId, "templates.manage", organizationId);

  const manifestObject = await c.env.ARTIFACTS.get(`${OFFICIAL_TEMPLATE_PREFIX}manifest.json`);
  if (!manifestObject) throw new IusiaError("NOT_FOUND", "Manifest de plantillas oficiales no encontrado en R2");
  const manifest = OfficialTemplateManifest.safeParse(JSON.parse(await manifestObject.text()));
  if (!manifest.success) throw new IusiaError("VALIDATION_FAILED", "Manifest de plantillas oficiales inválido");

  const repo = new TemplateRepository(createDb(c.env.DB));
  await repo.setSystemStatus(SEED_TEMPLATE_IDS.opinion, "RETIRED");
  const existing = await repo.listSystemHistory();
  const workspace = DriveWorkspaceService.forEnv(c.env);
  const { templates: templatesFolder } = await workspace.ensureFirmStructure(userId, organizationId);
  const drive = await OrganizationStorageResolver.forEnv(c.env).resolvePlatformAdapter({ requireWrite: true });
  const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  const imported: Array<{ id: string; name: string; version: number; checksum: string }> = [];
  const skipped: Array<{ name: string; checksum: string; reason: string }> = [];

  const prepared = await mapWithConcurrency(manifest.data.templates, 4, async (item) => {
    const documentType = item.document_type.toUpperCase();
    const matchingChecksum = existing.find((row) => row.checksum === item.sha256 && row.documentType === documentType);
    if (matchingChecksum) {
      skipped.push({ name: item.name, checksum: item.sha256, reason: "already_registered" });
      return null;
    }
    const object = await c.env.ARTIFACTS.get(`${OFFICIAL_TEMPLATE_PREFIX}${item.file}`);
    if (!object) throw new IusiaError("NOT_FOUND", `Plantilla oficial no encontrada: ${item.file}`);
    const bytes = await object.arrayBuffer();
    const actualChecksum = await checksum(bytes);
    if (actualChecksum !== item.sha256) {
      throw new IusiaError("VALIDATION_FAILED", `Checksum inválido para ${item.file}`);
    }
    const normalizedTemplate = await withTimeout(
      `Conversión de ${item.file}`,
      25_000,
      normalizeToText(bytes, DOCX_MIME, item.file, c.env.AI),
    );
    const familyMatch = existing.find((row) => row.name === item.name && row.documentType === documentType);
    return { item, bytes, actualChecksum, familyId: familyMatch?.familyId, variables: discoverTemplateVariables(normalizedTemplate) };
  });

  for (const preparedItem of prepared) {
    if (!preparedItem) continue;
    const { item, bytes, actualChecksum, familyId, variables } = preparedItem;
    if (variables.length === 0) {
      skipped.push({ name: item.name, checksum: item.sha256, reason: "not_renderable" });
      continue;
    }
    const filename = item.file.split("/").pop() ?? `${item.name}.docx`;
    const original = await drive.uploadFile({
      name: filename,
      parentId: templatesFolder,
      mimeType: DOCX_MIME,
      content: bytes,
    });
    const operationalRef = await drive.importDocxAsGoogleDoc({
      name: `${item.name} — fuente operativa`,
      parentId: templatesFolder,
      content: bytes,
    });
    const created = await repo.createSystemVersion({
      familyId,
      name: item.name,
      documentType: item.document_type.toUpperCase(),
      category: item.category,
      description: `Plantilla oficial Pisoso Legal preservada desde ${item.file}.`,
      sourceRef: operationalRef,
      originalSourceRef: original.provider_file_id,
      mimeType: DOCX_MIME,
      checksum: actualChecksum,
      originalFilename: filename,
      variables,
      createdBy: userId,
      activate: true,
    });
    imported.push({ id: created.id, name: item.name, version: created.version, checksum: actualChecksum });
  }

  await audit.record({
    organizationId,
    actorUserId: userId,
    action: "template.official_import",
    resourceType: "template",
    resourceId: "official:pisoso-legal",
    outcome: "SUCCESS",
    detail: { imported: imported.length, skipped: skipped.length },
  });
  return c.json({ imported, skipped });
});

const TemplateStatusInput = z.object({ status: z.enum(["ACTIVE", "INACTIVE", "RETIRED"]) });

documentWorkspaceRoutes.patch("/admin/templates/:templateId/status", async (c) => {
  const { authz, audit } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  await authz.requireSystemSuperadmin(userId, "templates.manage", organizationId);
  const parsed = TemplateStatusInput.safeParse(await c.req.json());
  if (!parsed.success) throw new IusiaError("VALIDATION_FAILED", "Estado de plantilla inválido");
  const repo = new TemplateRepository(createDb(c.env.DB));
  const updated = await repo.setSystemStatus(c.req.param("templateId"), parsed.data.status);
  if (!updated) throw new IusiaError("NOT_FOUND", "Plantilla no encontrada");
  await audit.record({
    organizationId,
    actorUserId: userId,
    action: "template.status.set",
    resourceType: "template",
    resourceId: updated.id,
    outcome: "SUCCESS",
    detail: { status: parsed.data.status },
  });
  return c.json({ ok: true, status: parsed.data.status });
});

/**
 * Genera el borrador de una TAREA del expediente.
 *
 * Mismo backend que la generación ad hoc: mismo Template Registry, mismo Document
 * Engine, mismo agente 08. Lo único que cambia es de dónde sale la intención — de la
 * tarea que el análisis propuso, no de un formulario— y que el resultado queda vinculado
 * a la tarea en ambos sentidos.
 *
 * El abogado no vuelve a escribir el encargo: IUSIA ya conoce el expediente, la
 * estrategia que produjo la tarea, los hechos y las autoridades validadas.
 */
documentWorkspaceRoutes.post("/matters/:matterId/tasks/:taskId/document", async (c) => {
  const ctx = c.get("ctx");
  const { matters, authz, audit, tasks } = ctx;
  const { organizationId, userId } = c.get("session");
  const matterId = c.req.param("matterId");
  const taskId = c.req.param("taskId");

  await authz.authorizeMatter(organizationId, userId, matterId, "deliverable:publish");
  const matter = await matters.findById(organizationId, matterId);
  if (!matter) throw new IusiaError("NOT_FOUND", "Expediente no encontrado");

  const task = await tasks.findById(organizationId, taskId);
  if (!task || task.matterId !== matterId) {
    throw new IusiaError("NOT_FOUND", "Tarea no encontrada en este expediente");
  }
  if (!producesDocument(task.actionType)) {
    throw new IusiaError(
      "VALIDATION_FAILED",
      "Esta tarea no consiste en producir un escrito, así que no genera borrador",
      { code: "TASK_NOT_DOCUMENT_DRAFT", action_type: task.actionType ?? "OTHER" },
    );
  }

  // La intención documental decide la plantilla. Sin correspondencia NO se adivina:
  // un borrador con la plantilla equivocada es peor que ningún borrador.
  const documentType = documentTypeForIntent(task.documentIntent);
  if (!documentType) {
    throw new IusiaError(
      "CONFLICT",
      "No hay una plantilla oficial para el tipo de escrito que pide esta tarea. Créala en plantillas o redáctalo manualmente.",
      { code: "TEMPLATE_NOT_FOUND" },
    );
  }

  const service = DocumentGenerationService.forEnv(c.env);
  const drafter = DocumentDraftService.forEnv(c.env);
  try {
    const result = await service.generate({
      userId,
      organizationId,
      matter: { id: matter.id, reference: matter.reference, title: matter.title },
      documentType,
      originTaskId: taskId,
      resolveValues: async (variables) => {
        const draft = await drafter.draft({
          ctx,
          organizationId,
          matterId,
          documentType,
          variables,
          // El encargo es la propia tarea: título y descripción tal como el equipo las
          // redactó. No se reenvía el expediente entero; el Case Brief y el análisis ya
          // aportan el contexto, y la tarea aporta la intención concreta.
          instructions: `${task.title}\n\n${task.description ?? ""}`.trim(),
          executionId: task.sourceExecutionId ?? undefined,
        });
        return {
          values: draft.values,
          provenance: {
            agent_id: draft.agent_id,
            provider: draft.provider,
            model: draft.model,
            prompt_sha256: draft.prompt_sha256,
          },
        };
      },
    });

    // Vínculo en ambos sentidos y avance del ciclo de la tarea. Generar NO la cierra:
    // revisar, enviar o firmar es una decisión del abogado.
    await tasks.attachGeneratedDocument(organizationId, taskId, {
      generatedDocumentId: result.docx.document_id,
      status: statusAfterDraftGenerated(),
    });

    await audit.record({
      organizationId,
      matterId,
      actorUserId: userId,
      action: "document.generate",
      resourceType: "document",
      resourceId: result.docx.document_id,
      outcome: "SUCCESS",
      detail: {
        origin: "TASK",
        origin_task_id: taskId,
        source_execution_id: task.sourceExecutionId ?? "",
        template_id: result.template_id,
        template_version: result.template_version,
        content_source: result.draft ? "AGENT" : "MANUAL",
        ...(result.draft
          ? {
              draft_agent_id: result.draft.agent_id,
              draft_model: result.draft.model,
              draft_prompt_sha256: result.draft.prompt_sha256,
            }
          : {}),
      },
    });

    return c.json({
      docx: { name: result.docx.name, document_id: result.docx.document_id },
      pdf: { name: result.pdf.name, document_id: result.pdf.document_id },
      // La tarea NO queda completada: queda con borrador listo.
      task_status: statusAfterDraftGenerated(),
      content_source: result.draft ? "AGENT" : "MANUAL",
    });
  } catch (error) {
    if (error instanceof DocumentGenerationError) {
      throw new IusiaError("CONFLICT", documentErrorMessage(error.code), { code: error.code });
    }
    if (error instanceof DocumentDraftError) {
      throw new IusiaError("CONFLICT", error.message, { code: error.code });
    }
    if (error instanceof DriveConnectionError) {
      const code = driveErrorToCode(error);
      throw new IusiaError("CONFLICT", documentErrorMessage(code), { code });
    }
    throw error;
  }
});
