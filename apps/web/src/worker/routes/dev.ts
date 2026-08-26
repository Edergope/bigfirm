import { Hono } from "hono";
import { z } from "zod";
import { IusiaError } from "@iusia/domain";
import { listAgentDefinitions } from "@iusia/agents";
import { AgentRepository } from "@iusia/db";
import type { AppBindings } from "../context.js";
import { requireSession, withContext } from "../context.js";
import { createAuth } from "../auth/config.js";
import { DriveConnectionError, DriveCredentialResolver } from "../services/drive-credentials.js";
import { normalizeToText } from "../services/ingestion.js";

/**
 * Utilidades de desarrollo. Bloqueadas fuera de `IUSIA_ENV=development`.
 *
 * Los datos que crean quedan marcados explícitamente como datos de desarrollo:
 * el prompt maestro prohíbe presentar seed data como información real.
 */
export const devRoutes = new Hono<AppBindings>();

/**
 * Fail-closed: SÓLO el valor exacto "development" habilita el harness. Cualquier otro
 * estado (production, staging, test, undefined, null, "", valor desconocido) lo cierra.
 * Nunca se usa `!== "production"` (sería fail-open).
 */
export function isDevelopmentEnv(iusiaEnv: string | undefined | null): boolean {
  return iusiaEnv === "development";
}

/**
 * Gate del harness dev. Se ejecuta ANTES que withContext/requireSession y cualquier
 * side-effect: fuera de development responde 404 sin tocar D1, créditos ni Drive.
 */
devRoutes.use("*", async (c, next) => {
  if (!isDevelopmentEnv(c.env.IUSIA_ENV)) {
    throw new IusiaError("NOT_FOUND", "Ruta no disponible");
  }
  await next();
});

devRoutes.use("*", withContext);
devRoutes.use("*", requireSession);

/** Sincroniza el Agent Registry hacia D1 y acredita créditos de desarrollo. */
devRoutes.post("/bootstrap", async (c) => {
  const { credits, db } = c.get("ctx");
  const { organizationId } = c.get("session");

  const agents = new AgentRepository(db);

  for (const def of listAgentDefinitions()) {
    await agents.upsert({
      agentId: def.agent_id,
      name: def.name,
      role: def.role,
      domain: def.domain,
      promptRef: def.prompt_ref,
      promptVersion: def.prompt_version,
      promptSha256: def.prompt_sha256,
      enabled: def.enabled,
      modelPolicy: def.model_policy,
      toolsPolicy: def.tools_policy,
      outputType: def.output_type,
      outputSchemaId: def.output_schema_id,
      parallelizable: def.parallelizable,
      timeoutMs: def.timeout_ms,
    });
  }

  await credits.ensureWallet(organizationId, 0);
  const wallet = await credits.post({
    organizationId,
    kind: "GRANT",
    amount: 50_000,
    idempotencyKey: `dev-grant:${organizationId}`,
  });

  return c.json({
    agents_registered: listAgentDefinitions().length,
    credits_balance: wallet.balance,
    notice: "DATOS DE DESARROLLO: créditos otorgados sin contraprestación económica.",
  });
});

/**
 * Scaffolding de pruebas: añade un usuario EXISTENTE a la organización activa vía la
 * API server-only sancionada por Better Auth (`auth.api.addMember`). No inserta filas
 * a mano ni crea usuarios. Sólo desarrollo. El acceso al Matter se concede aparte por
 * la ruta real `/api/admin/matter-access`.
 */
const AddMemberInput = z.object({
  user_id: z.string().min(1),
  role: z
    .enum(["FIRM_DIRECTOR", "PARTNER", "LAWYER", "ASSISTANT", "PARALEGAL", "EXTERNAL_LAWYER", "READ_ONLY"])
    .default("LAWYER"),
});
devRoutes.post("/e2e/add-org-member", async (c) => {
  const { organizationId } = c.get("session");
  const parsed = AddMemberInput.safeParse(await c.req.json());
  if (!parsed.success) throw new IusiaError("VALIDATION_FAILED", "user_id requerido");

  const auth = createAuth(c.env);
  await auth.api.addMember({
    body: {
      userId: parsed.data.user_id,
      role: parsed.data.role,
      organizationId,
    },
  });
  return c.json({ ok: true, organization_id: organizationId, user_id: parsed.data.user_id });
});

/**
 * Harness de la FASE 1 (LIVE DRIVE READ). Para el usuario autenticado resuelve sus
 * credenciales de Drive con `DriveCredentialResolver` y ejecuta getMetadata + download
 * + el normalizador REAL. NUNCA devuelve tokens ni el contenido completo: sólo
 * metadata, longitud, hash y si el marcador está presente.
 */
const DriveReadInput = z.object({
  drive_file_id: z.string().min(1),
  marker: z.string().min(1),
});
devRoutes.post("/e2e/drive-read", async (c) => {
  const { userId } = c.get("session");
  const parsed = DriveReadInput.safeParse(await c.req.json());
  if (!parsed.success) throw new IusiaError("VALIDATION_FAILED", "drive_file_id y marker requeridos");

  const resolver = DriveCredentialResolver.forEnv(c.env);
  let adapter;
  try {
    adapter = await resolver.resolveAdapter(userId);
  } catch (error) {
    if (error instanceof DriveConnectionError) {
      return c.json({ ok: false, stage: "resolve", error_code: error.code }, 200);
    }
    throw error;
  }

  const metadata = await adapter.getMetadata(parsed.data.drive_file_id);
  const bytes = await adapter.download(parsed.data.drive_file_id);
  const normalized = await normalizeToText(bytes, metadata.mime_type, metadata.name, c.env.AI);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

  return c.json({
    ok: true,
    // metadata NO sensible del archivo (nunca tokens):
    metadata: {
      provider_file_id: metadata.provider_file_id,
      name: metadata.name,
      mime_type: metadata.mime_type,
      size_bytes: metadata.size_bytes,
      modified_at: metadata.modified_at,
    },
    normalized_length: normalized.length,
    normalized_sha256: sha256,
    marker_present: normalized.includes(parsed.data.marker),
  });
});
