import { Hono } from "hono";
import { z } from "zod";
import {
  accountUploads,
  isAcceptedUpload,
  isReadableMimeType,
  MAX_FILES_PER_UPLOAD,
  batchProgress,
  canRetryIngestion,
  documentIntelligenceState,
  ingestionLifecycle,
  documentIngressKey,
  documentTypeForIntent,
  newId,
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
import { normalizeToText, setMirrorIndexActive } from "../services/ingestion.js";
import { discoverTemplateVariables } from "../services/template-placeholders.js";

export const documentWorkspaceRoutes = new Hono<AppBindings>();

/**
 * Los MIME aceptados ya no se enumeran aquí.
 *
 * Esta lista y la de la ingestión eran distintas —ésta admitía `.doc` e imágenes que
 * aquélla no sabía leer—, y esa diferencia fue lo que dejó dos documentos del lote de
 * 17 esperando turno para acabar en «no indexado». `isAcceptedUpload` decide qué entra
 * y `formatCoverage` explica por qué, con las mismas palabras en el navegador y aquí.
 */
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

/**
 * Archivos que se suben a la vez al proveedor de almacenamiento.
 *
 * Coincide con el techo del consumidor de la cola: el cuello de botella es el mismo
 * —conexiones simultáneas al proveedor— y tener dos números distintos sólo invitaría a
 * que uno de los dos se quedara sin justificación.
 */
const UPLOAD_CONCURRENCY = 6;

function initialIngestionStatus(mime: string): "NOT_INDEXABLE" | "PROCESSING" {
  return isReadableMimeType(mime) ? "PROCESSING" : "NOT_INDEXABLE";
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
  // Defensa en profundidad: el mismo techo que aplica el cliente. Rechazar es preferible
  // a recortar en silencio, que es como se perdieron siete archivos sin que nadie lo
  // supiera —la auditoría registró `count: 10` de una selección de 17—.
  if (files.length > MAX_FILES_PER_UPLOAD) {
    throw new IusiaError(
      "VALIDATION_FAILED",
      `En una sola carga caben ${MAX_FILES_PER_UPLOAD} archivos; llegaron ${files.length}.`,
      { code: "TOO_MANY_FILES", limit: MAX_FILES_PER_UPLOAD, received: files.length },
    );
  }

  // Identidad del LOTE. No es una transacción: no se confirma ni se revierte en bloque,
  // y el fallo de un archivo no toca a los demás. Sólo correlaciona qué entró junto.
  const uploadBatchId = newId("uploadBatch");
  const enqueuedAt = new Date().toISOString();

  type UploadResult = {
    document_id: string;
    name: string;
    status: string;
    deduplicated?: boolean;
  };

  /*
    INGRESO DURABLE.

    Esta petición NO habla con Drive. Antes sí, y ahí estaban los dos incidentes de
    IUS-2026-016: la ruta empezaba creando cuatro carpetas en Drive —llamadas
    secuenciales, sin cota— y sólo escribía la primera fila de documento DESPUÉS de que
    la subida al proveedor hubiera terminado. Con eso, cualquier cuelgue, excepción o
    aborto del navegador antes de ese punto no dejaba rastro: el ledger de aquel
    expediente tiene el `matter.create` y NADA más —cero documentos, cero carpetas, ni
    un solo evento `document.upload`—, que es exactamente lo que el abogado vio.

    Ahora el orden se invierte. Los bytes van a R2, que es almacenamiento durable que ya
    usamos, y la fila del documento se escribe inmediatamente después. En ese momento el
    archivo YA ES DE IUSIA: cerrar la pestaña, perder la conexión o navegar a otra
    sección no puede hacerlo desaparecer, porque su existencia vive en D1 y sus bytes en
    R2, no en el estado de un componente de React.

    Drive sigue siendo el proveedor definitivo y sigue siendo invisible para el abogado:
    la sincronización ocurre en la cola, junto con la normalización y el índice.
  */
  const results: UploadResult[] = new Array(files.length);

  await mapWithConcurrency(
    files.map((file, index) => ({ file, index })),
    UPLOAD_CONCURRENCY,
    async ({ file, index }) => {
      if (file.size > MAX_FILE_BYTES) {
        results[index] = { document_id: "", name: file.name, status: "UPLOAD_FAILED" };
        return;
      }
      const mime = file.type || "application/octet-stream";
      if (!isAcceptedUpload(mime)) {
        results[index] = { document_id: "", name: file.name, status: "UNSUPPORTED" };
        return;
      }
      try {
        const bytes = await file.arrayBuffer();
        const fileChecksum = await checksum(bytes);

        // Un REINTENTO TÉCNICO no incorpora el documento dos veces. Volver a aportar el
        // mismo archivo a propósito es otra acción —crear una versión— y tiene su ruta.
        const alreadyThere = await documents.findByChecksum(organizationId, matterId, fileChecksum);
        if (alreadyThere) {
          results[index] = {
            document_id: alreadyThere.documentId,
            name: alreadyThere.filename,
            status: alreadyThere.ingestionStatus,
            deduplicated: true,
          };
          return;
        }

        // 1. La fila PRIMERO, con los bytes todavía en vuelo. Así el expediente puede
        //    mostrar el archivo como «Subiendo» desde el primer instante, y un fallo
        //    posterior deja un registro reintentable en vez de un vacío.
        const documentId = await documents.link({
          organizationId,
          matterId,
          driveFileId: null,
          name: file.name,
          mimeType: mime,
          classification: "FUENTE",
          linkedBy: userId,
          sizeBytes: file.size,
          checksum: fileChecksum,
          ingestionStatus: "UPLOADING",
          uploadBatchId,
          ingestionEnqueuedAt: enqueuedAt,
        });

        try {
          // 2. Los bytes, a almacenamiento durable.
          await c.env.ARTIFACTS.put(
            documentIngressKey(organizationId, matterId, documentId),
            bytes,
            {
              httpMetadata: { contentType: mime },
              customMetadata: {
                organization_id: organizationId,
                matter_id: matterId,
                document_id: documentId,
                original_name: file.name,
              },
            },
          );
        } catch (error) {
          // El archivo no llegó entero: se declara así, no como «procesando».
          await documents.markUploadFailed(organizationId, documentId);
          results[index] = { document_id: documentId, name: file.name, status: "UPLOAD_FAILED" };
          throw error;
        }

        // 3. A partir de aquí el archivo es de IUSIA. Lo demás ocurre en segundo plano.
        //
        //    SE ENCOLA SIEMPRE, también lo no indexable. Antes sólo se encolaba lo que
        //    iba al índice, así que los bytes de una imagen se quedaban para siempre en
        //    el ingreso durable y nunca llegaban al proveedor: el expediente perdía su
        //    respaldo sin que nadie se enterara. El trabajo de fondo se salta la
        //    inteligencia para estos formatos y hace sólo la sincronización.
        const nextStatus = initialIngestionStatus(mime);
        await documents.markUploadDurable(organizationId, documentId, nextStatus);
        await c.env.DOCUMENT_INGESTION.send({
          organization_id: organizationId,
          matter_id: matterId,
          document_id: documentId,
          reason: "UPLOADED",
          enqueued_at: enqueuedAt,
        });
        results[index] = { document_id: documentId, name: file.name, status: nextStatus };
      } catch {
        // Cada archivo resuelve su propio destino: uno que reviente no cancela el lote.
        results[index] ??= { document_id: "", name: file.name, status: "UPLOAD_FAILED" };
      }
    },
  );

  /*
    CONSTANCIA POR ARCHIVO.

    Este registro decía `{count: 10, failed: 0}` para el lote de 17. Las dos cifras eran
    ciertas y el informe era falso: se crearon nueve filas. `failed` sólo contaba
    `UPLOAD_FAILED`, y el décimo archivo se fue por una de las dos ramas que devuelven
    resultado sin crear fila —formato no admitido, o contenido idéntico a otro del mismo
    lote—. Al reconstruirlo semanas después no hubo forma de decidir cuál: la respuesta
    por archivo se le dio al navegador y no se guardó en ninguna parte.

    Ahora cada casilla queda escrita, con los nombres de lo que no entró. Un lote se
    puede auditar sin volver a preguntarle al abogado qué había seleccionado.
  */
  const accounting = accountUploads(results);
  await audit.record({
    organizationId,
    matterId,
    actorUserId: userId,
    action: "document.upload",
    resourceType: "document",
    outcome: accounting.accepted > 0 ? "SUCCESS" : "FAILURE",
    detail: {
      batch_id: uploadBatchId,
      requested: accounting.requested,
      accepted: accounting.accepted,
      duplicate: accounting.duplicate,
      unsupported: accounting.unsupported,
      failed: accounting.failed,
      duplicate_names: accounting.duplicateNames,
      unsupported_names: accounting.unsupportedNames,
      failed_names: accounting.failedNames,
    },
  });

  return c.json({ uploaded: results, batch_id: uploadBatchId, accounting }, 201);
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
    // Señales de operación del procesamiento. No son dato de negocio y no se muestran:
    // la pantalla deriva de ellas el estado que lee el abogado, con la MISMA función
    // que usa el endpoint de reintento.
    ingestion_attempts: d.ingestionAttempts,
    ingestion_enqueued_at: d.ingestionEnqueuedAt,
    ingestion_heartbeat_at: d.ingestionHeartbeatAt,
    // La ETAPA distingue «el proveedor va lento» de «esto no avanza». Sin ella la
    // pantalla no puede separar «Indexación demorada» de «Procesamiento detenido», y
    // acaba ofreciendo un botón de reintentar que vuelve a subirlo todo. No es dato de
    // negocio: es la misma clase de señal que los intentos y el latido.
    ingestion_stage: d.ingestionStage,
    ingestion_confirm_attempts: d.indexConfirmAttempts,
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
  // Un documento recién cargado todavía no está en el proveedor definitivo: sus bytes
  // viven en el ingreso durable. Se sirven desde allí, de modo que el abogado puede
  // abrir lo que acaba de aportar sin esperar a la sincronización de fondo.
  let bytes: ArrayBuffer;
  if (version.driveFileId === null) {
    const ingress = await c.env.ARTIFACTS.get(
      documentIngressKey(organizationId, matterId, documentId),
    );
    if (!ingress) {
      throw new IusiaError("NOT_FOUND", "El documento todavía se está cargando");
    }
    bytes = await ingress.arrayBuffer();
  } else {
    // La ACL autoriza al solicitante; la firma provee el storage físico.
    const drive = await OrganizationStorageResolver.forEnv(c.env).resolveAdapter(organizationId);
    bytes = await drive.download(version.driveFileId);
  }
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
  if (!isAcceptedUpload(mime)) throw new IusiaError("VALIDATION_FAILED", "Tipo de archivo no admitido");

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
  // Sólo se mueve lo que ya existe en el proveedor. Una versión aún sin sincronizar no
  // tiene nada que mover allí; sus bytes se retiran del ingreso durable más abajo.
  for (const version of versions) {
    if (version.driveFileId) await drive.moveFile(version.driveFileId, folders.retired);
  }
  await c.env.ARTIFACTS.delete(documentIngressKey(organizationId, matterId, documentId));
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

/**
 * Reintenta la ingestión de UN documento fallido.
 *
 * Reintenta ese archivo y sólo ese: los otros catorce de un lote de quince no se
 * vuelven a tocar. Es idempotente —mismo `document_id`, misma versión, mismo binario
 * en el proveedor—, así que reescribe el mismo espejo en R2 y reenvía el mismo item al
 * índice con la misma clave, sin duplicar nada.
 */
documentWorkspaceRoutes.post("/matters/:matterId/documents/:documentId/retry", async (c) => {
  const { documents, authz, audit } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const matterId = c.req.param("matterId");
  const documentId = c.req.param("documentId");

  await authz.authorizeMatter(organizationId, userId, matterId, "document:link");

  const doc = await documents.findById(organizationId, documentId);
  if (!doc || doc.matterId !== matterId) {
    throw new IusiaError("NOT_FOUND", "Documento no encontrado en este expediente");
  }
  /*
    LA MISMA definición de «reintentable» que usa la pantalla.

    Antes eran dos: el botón aparecía a partir del estado DERIVADO —«detenido», por
    antigüedad— y aquí se validaba la COLUMNA CRUDA, que decía `PROCESSING`. El
    resultado fue que `CC JFRR.pdf` mostró «Reintentando…», recibió un 409 y volvió a
    su sitio sin que la fila se tocara siquiera: su `updated_at` seguía siendo el
    segundo de la carga original.
  */
  const state = ingestionLifecycle({
    status: doc.ingestionStatus,
    attempts: doc.ingestionAttempts,
    heartbeatAt: doc.ingestionHeartbeatAt,
    enqueuedAt: doc.ingestionEnqueuedAt,
    updatedAt: doc.updatedAt,
    stage: doc.ingestionStage,
    confirmAttempts: doc.indexConfirmAttempts,
  });
  if (!canRetryIngestion(state)) {
    throw new IusiaError(
      "CONFLICT",
      "Este documento no necesita reintento ahora mismo.",
      { code: "NOT_RETRYABLE", state },
    );
  }

  /*
    REANUDAR, NO EMPEZAR DE CERO.

    Un documento que ya tiene su espejo en R2 y su identidad de item en el índice no
    necesita volver a descargarse, convertirse ni subirse: lo único que le falta es que
    alguien pregunte si el proveedor terminó. Reprocesarlo entero deja el item anterior
    obsoleto, reinicia la cuenta de confirmaciones y multiplica el trabajo — es el bucle
    que dejó un DOCX en 19 confirmaciones sin converger.

    Se reanuda desde la confirmación. Sólo se rehace todo si no hay item que reutilizar.
  */
  if (doc.aiSearchItemId !== null && doc.indexedAt === null) {
    await c.env.DOCUMENT_INGESTION.send({
      organization_id: organizationId,
      matter_id: matterId,
      document_id: documentId,
      reason: "AI_SEARCH_CONFIRM",
      enqueued_at: new Date().toISOString(),
    });
    await audit.record({
      organizationId,
      matterId,
      actorUserId: userId,
      action: "document.ingestion.retry",
      resourceType: "document",
      resourceId: documentId,
      outcome: "SUCCESS",
      detail: { from_state: state, resumed_from: "AI_SEARCH_CONFIRM" },
    });
    return c.json({ status: "RETRYING", resumed_from: "AI_SEARCH_CONFIRM" });
  }

  const hasBytes =
    doc.driveFileId !== null ||
    (await c.env.ARTIFACTS.head(documentIngressKey(organizationId, matterId, documentId))) !== null;
  if (!hasBytes) {
    // Sin bytes no hay nada que reintentar, y decirlo es mejor que reencolar un trabajo
    // que va a fallar igual. El abogado tiene que volver a aportar el archivo.
    throw new IusiaError(
      "CONFLICT",
      "No conservamos el contenido de este archivo. Vuelve a adjuntarlo.",
      { code: "NO_SOURCE_FILE" },
    );
  }

  // Reclamo del reintento: dos clics seguidos no pueden encolar dos mensajes. La
  // transición desde el estado observado es lo que autoriza: si otra pestaña ya
  // reintentó, esta condición no encuentra la fila.
  const claimed = await documents.markIngestionRetrying(
    organizationId,
    documentId,
    doc.ingestionStatus,
  );
  if (!claimed) {
    throw new IusiaError("CONFLICT", "El documento ya se está reprocesando", {
      code: "ALREADY_RETRYING",
    });
  }

  try {
    await c.env.DOCUMENT_INGESTION.send({
      organization_id: organizationId,
      matter_id: matterId,
      document_id: documentId,
      // Sin `drive_file_id` el trabajo de fondo lee del ingreso durable y sincroniza el
      // proveedor. Con él, reprocesa desde el archivo que ya existe allí.
      ...(doc.driveFileId ? { drive_file_id: doc.driveFileId } : {}),
      reason: "RETRY",
      enqueued_at: new Date().toISOString(),
    });
  } catch (error) {
    // Si la cola NO aceptó el mensaje, el documento no puede quedarse diciendo que está
    // en camino: no lo está. Se devuelve a un estado reintentable y se dice la verdad.
    await documents.markIngestionFailedAt(
      organizationId,
      documentId,
      "INGRESS",
      "QUEUE_SEND_FAILED",
      error instanceof Error ? error.message : "no fue posible encolar el reprocesamiento",
    );
    throw new IusiaError(
      "CONFLICT",
      "No fue posible poner el documento en cola de procesamiento. Vuelve a intentarlo.",
      { code: "QUEUE_SEND_FAILED" },
    );
  }

  await audit.record({
    organizationId,
    matterId,
    actorUserId: userId,
    action: "document.ingestion.retry",
    resourceType: "document",
    resourceId: documentId,
    outcome: "SUCCESS",
    detail: { attempts: doc.ingestionAttempts ?? 0 },
  });

  return c.json({ document_id: documentId, ingestion_status: "PROCESSING" });
});

/**
 * Progreso agregado de un lote de carga.
 *
 * Es lo que permite decir «12 de 15 documentos preparados» sin que el cliente sondee
 * quince veces por separado ni tenga que recargar el expediente entero.
 */
documentWorkspaceRoutes.get("/matters/:matterId/uploads/:batchId", async (c) => {
  const { documents, authz } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const matterId = c.req.param("matterId");
  const batchId = c.req.param("batchId");

  await authz.authorizeMatter(organizationId, userId, matterId, "document:read");

  const docs = (await documents.listByBatch(organizationId, batchId)).filter(
    (d) => d.matterId === matterId,
  );
  const items = docs.map((d) => ({
    document_id: d.id,
    name: d.name,
    ingestion_status: d.ingestionStatus,
  }));

  return c.json({
    batch_id: batchId,
    ...batchProgress(
      docs.map((d) =>
        documentIntelligenceState(d.ingestionStatus, d.updatedAt, new Date(), d.ingestionHeartbeatAt),
      ),
    ),
    documents: items,
  });
});
