import { Hono } from "hono";
import { IusiaError, isIusiaError } from "@iusia/domain";
import type { Env } from "./env.js";
import { createAuth } from "./auth/config.js";
import { requireSession, withContext, type AppBindings } from "./context.js";
import { mattersRoutes } from "./routes/matters.js";
import { orchestrationRoutes } from "./routes/orchestration.js";
import { documentsRoutes } from "./routes/documents.js";
import { practiceRoutes } from "./routes/practice.js";
import { adminRoutes } from "./routes/admin.js";
import { devRoutes } from "./routes/dev.js";
import { IngestionService } from "./services/ingestion.js";
import { DocumentIngestionMessage } from "@iusia/domain";

const app = new Hono<AppBindings>();

app.onError((error, c) => {
  if (isIusiaError(error)) {
    // El detalle tipado es seguro: nunca contiene prompts ni documentos.
    return c.json(error.toJSON(), error.status as 400);
  }
  console.error("unhandled_error", {
    path: c.req.path,
    message: error instanceof Error ? error.message : "unknown",
  });
  return c.json(
    { error: { code: "INTERNAL", message: "Error interno", details: {} } },
    500,
  );
});

// Better Auth gobierna todo /api/auth/*.
app.all("/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

app.use("/api/*", withContext);

app.get("/api/health", (c) =>
  c.json({ ok: true, env: c.env.IUSIA_ENV, service: "iusia" }),
);

const protectedApi = new Hono<AppBindings>();
protectedApi.use("*", requireSession);

/** Identidad, rol de firma y saldo de créditos del usuario actual. */
protectedApi.get("/me", async (c) => {
  const { authz, credits } = c.get("ctx");
  const { userId, userName, organizationId } = c.get("session");
  const [firmRole, balance, systemRole] = await Promise.all([
    authz.firmRole(organizationId, userId),
    credits.balance(organizationId),
    authz.systemRole(userId),
  ]);
  if (!firmRole) {
    throw new IusiaError("FORBIDDEN", "El usuario no pertenece a esta firma");
  }
  return c.json({
    user: { id: userId, name: userName },
    organization_id: organizationId,
    firm_role: firmRole,
    credits: balance,
    // Capacidad de sistema resuelta EN EL SERVIDOR. La UI la lee para decidir qué
    // mostrar; jamás para autorizar: cada ruta de sistema vuelve a comprobarla.
    system_role: systemRole,
    is_system_superadmin: systemRole === "SYSTEM_SUPERADMIN",
  });
});

protectedApi.route("/matters", mattersRoutes);
protectedApi.route("/", orchestrationRoutes);
protectedApi.route("/", documentsRoutes);
protectedApi.route("/", practiceRoutes);
protectedApi.route("/admin", adminRoutes);

app.route("/api", protectedApi);
app.route("/api/dev", devRoutes);

/**
 * Consumidor de la cola de ingestión documental.
 *
 * Idempotente: reprocesar un mensaje reescribe el mismo espejo R2. Los mensajes
 * que fallan por causa transitoria se reintentan (retry); los que fallan por
 * configuración externa (Drive sin OAuth) se ACK-ean para no llenar la DLQ con un
 * fallo que ningún reintento resolverá — el documento queda PENDIENTE de indexar.
 */
async function handleIngestionQueue(
  batch: MessageBatch<unknown>,
  env: Env,
): Promise<void> {
  const service = IngestionService.forEnv(env);
  for (const message of batch.messages) {
    const parsed = DocumentIngestionMessage.safeParse(message.body);
    if (!parsed.success) {
      message.ack(); // mensaje malformado: no se reintenta
      continue;
    }
    const outcome = await service.ingest(parsed.data);
    if (outcome.status === "ERROR") {
      message.retry(); // fallo transitorio: reintentar (o a la DLQ tras max_retries)
    } else {
      message.ack();
    }
  }
}

// El módulo del Worker expone `fetch` (Hono) y `queue` (ingestión).
export default {
  fetch: app.fetch,
  queue: handleIngestionQueue,
};

// Runtime multiagente y motor durable. Los nombres de clase deben coincidir con
// wrangler.jsonc y sobrevivir al bundling (ver vite.config.ts, keepNames).
export { LegalWorker } from "./agents/legal-worker.js";
export { MatterOrchestrationWorkflow } from "./workflows/matter-orchestration.js";
export type { Env };
