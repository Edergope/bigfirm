import { Hono } from "hono";
import { z } from "zod";
import {
  IusiaError,
  allowedFolderPrefixes,
  type RetrievalScope,
} from "@iusia/domain";
import type { AppBindings } from "../context.js";
import { GoogleDriveAdapter } from "../integrations/google-drive.js";
import { AiSearchRetrievalProvider } from "../integrations/ai-search.js";

export const documentsRoutes = new Hono<AppBindings>();

/**
 * Estado de las integraciones documentales. La UI usa esto para mostrar
 * NOT_CONFIGURED en vez de fingir que Drive/AI Search están activos.
 */
documentsRoutes.get("/integrations/status", (c) => {
  const storage = new GoogleDriveAdapter(null);
  // El binding de AI Search aún no existe en wrangler (POC): NOT_CONFIGURED.
  const retrieval = new AiSearchRetrievalProvider(null);
  return c.json({
    storage: { id: storage.id, status: storage.status() },
    retrieval: { id: retrieval.id, status: retrieval.status() },
    notes: {
      storage: "Requiere OAuth de Google (GOOGLE_CLIENT_ID/SECRET). Ver docs/PENDIENTES.md.",
      retrieval: "AI Search es un POC pendiente de validación de aislamiento.",
    },
  });
});

/** Re-encola la ingestión de un documento ya vinculado. */
documentsRoutes.post("/matters/:matterId/documents/:documentId/reindex", async (c) => {
  const { authz, documents } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const matterId = c.req.param("matterId");
  const documentId = c.req.param("documentId");

  await authz.authorizeMatter(organizationId, userId, matterId, "document:link");

  const doc = await documents.findById(organizationId, documentId);
  if (!doc || doc.matterId !== matterId) {
    throw new IusiaError("NOT_FOUND", "Documento no encontrado");
  }
  if (!doc.driveFileId) {
    throw new IusiaError("VALIDATION_FAILED", "El documento no tiene origen en Drive");
  }

  await c.env.DOCUMENT_INGESTION.send({
    organization_id: organizationId,
    matter_id: matterId,
    document_id: documentId,
    drive_file_id: doc.driveFileId,
    reason: "MANUAL_REINDEX",
    enqueued_at: new Date().toISOString(),
  });

  return c.json({ ok: true, status: "ENQUEUED" }, 202);
});

const DOCUMENT_STATUSES = [
  "PENDIENTE",
  "EN_REVISION",
  "REVISADO",
  "CRITICO",
  "APROBADO",
  "SUSTITUIDO",
] as const;
const SetDocStatusInput = z.object({ status: z.enum(DOCUMENT_STATUSES) });

/** Ciclo de revisión de un documento (Design System §06: estados del expediente). */
documentsRoutes.patch("/matters/:matterId/documents/:documentId", async (c) => {
  const { documents, authz, audit } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const matterId = c.req.param("matterId");
  const documentId = c.req.param("documentId");

  await authz.authorizeMatter(organizationId, userId, matterId, "document:link");

  const parsed = SetDocStatusInput.safeParse(await c.req.json());
  if (!parsed.success) {
    throw new IusiaError("VALIDATION_FAILED", "Estado de documento inválido", {
      allowed: DOCUMENT_STATUSES,
    });
  }

  const doc = await documents.findById(organizationId, documentId);
  if (!doc || doc.matterId !== matterId) {
    throw new IusiaError("NOT_FOUND", "Documento no encontrado");
  }

  await documents.setStatus(organizationId, documentId, parsed.data.status);
  await audit.record({
    organizationId,
    matterId,
    actorUserId: userId,
    action: "document.status.set",
    resourceType: "document",
    resourceId: documentId,
    outcome: "SUCCESS",
    detail: { from: doc.status, to: parsed.data.status },
  });

  return c.json({ ok: true });
});

const RetrievalInput = z.object({
  query: z.string().min(3).max(1000),
  max_results: z.number().int().min(1).max(20).optional(),
});

/**
 * Búsqueda RAG anclada al Matter. El alcance de recuperación se construye en el
 * servidor a partir de la autorización real; el cliente NUNCA define el scope.
 */
documentsRoutes.post("/matters/:matterId/retrieval", async (c) => {
  const { authz } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const matterId = c.req.param("matterId");

  await authz.authorizeMatter(organizationId, userId, matterId, "document:read");

  const parsed = RetrievalInput.safeParse(await c.req.json());
  if (!parsed.success) {
    throw new IusiaError("VALIDATION_FAILED", "Consulta de recuperación inválida");
  }

  // Alcance = esta organización + este matter (ya autorizado). Nada más.
  const scope: RetrievalScope = {
    organization_id: organizationId,
    authorized_matter_ids: [matterId],
  };

  const retrieval = new AiSearchRetrievalProvider(null);
  if (retrieval.status() !== "CONNECTED") {
    return c.json({
      status: "NOT_CONFIGURED",
      results: [],
      scope_folders: allowedFolderPrefixes(scope),
      note: "AI Search POC no configurado. El alcance de aislamiento ya se calcula en servidor.",
    });
  }

  const results = await retrieval.search({
    scope,
    query: parsed.data.query,
    max_results: parsed.data.max_results,
  });
  return c.json({ status: "OK", results });
});
