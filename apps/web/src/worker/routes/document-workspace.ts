import { Hono } from "hono";
import { z } from "zod";
import { IusiaError, documentErrorMessage } from "@iusia/domain";
import { TemplateRepository, createDb } from "@iusia/db";
import type { AppBindings } from "../context.js";
import { DriveConnectionError, DriveCredentialResolver } from "../services/drive-credentials.js";
import { DriveWorkspaceService } from "../services/drive-workspace.js";
import {
  DocumentGenerationError,
  DocumentGenerationService,
} from "../services/document-generation.js";
import { seedOpinionTemplate } from "../services/template-seed.js";

export const documentWorkspaceRoutes = new Hono<AppBindings>();

/** MIME aceptados: sólo lo que la ingestión ya sabe normalizar de forma segura. */
const ACCEPTED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "text/markdown",
]);
const MAX_FILE_BYTES = 20 * 1024 * 1024;

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

  const resolver = DriveCredentialResolver.forEnv(c.env);
  const drive = await resolver.resolveAdapter(userId, { requireWrite: true });

  const results: Array<{ document_id: string; name: string; status: string }> = [];
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
      const meta = await drive.uploadFile({
        name: file.name,
        parentId: uploadedFolder,
        mimeType: mime,
        content: await file.arrayBuffer(),
      });
      const documentId = await documents.link({
        organizationId,
        matterId,
        driveFileId: meta.provider_file_id,
        name: meta.name,
        mimeType: mime,
        classification: "FUENTE",
        linkedBy: userId,
      });
      await c.env.DOCUMENT_INGESTION.send({
        organization_id: organizationId,
        matter_id: matterId,
        document_id: documentId,
        drive_file_id: meta.provider_file_id,
        reason: "LINKED",
        enqueued_at: new Date().toISOString(),
      });
      results.push({ document_id: documentId, name: meta.name, status: "PROCESSING" });
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
  const shape = (d: (typeof docs)[number]) => ({
    id: d.id,
    name: d.name,
    mime_type: d.mimeType,
    status: d.status,
    classification: d.classification,
    drive_file_id: d.driveFileId,
    updated_at: d.updatedAt,
  });

  return c.json({
    uploaded: docs.filter((d) => d.classification !== "ENTREGABLE").map(shape),
    generated: docs.filter((d) => d.classification === "ENTREGABLE").map(shape),
  });
});

const GenerateInput = z.object({
  document_type: z.string().min(1),
  values: z.record(z.string(), z.string()),
});

/** Genera un entregable oficial con plantilla → DOCX/PDF → Drive. */
documentWorkspaceRoutes.post("/matters/:matterId/generate", async (c) => {
  const { matters, authz, audit } = c.get("ctx");
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
  try {
    const result = await service.generate({
      userId,
      organizationId,
      matter: { id: matter.id, reference: matter.reference, title: matter.title },
      documentType: parsed.data.document_type,
      values: parsed.data.values,
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
      },
    });
    return c.json({
      docx: { name: result.docx.name, document_id: result.docx.document_id },
      pdf: { name: result.pdf.name, document_id: result.pdf.document_id },
    });
  } catch (error) {
    if (error instanceof DocumentGenerationError) {
      throw new IusiaError("CONFLICT", documentErrorMessage(error.code), { code: error.code });
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
    const resolver = DriveCredentialResolver.forEnv(c.env);
    const drive = await resolver.resolveAdapter(userId, { requireWrite: true });

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

/** Siembra/actualiza la plantilla institucional de Opinión Legal. Sólo superadmin. */
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
      variables: t.variables ?? [],
    })),
  });
});
