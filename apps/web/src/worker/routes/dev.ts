import { Hono } from "hono";
import { IusiaError } from "@iusia/domain";
import { listAgentDefinitions } from "@iusia/agents";
import { AgentRepository } from "@iusia/db";
import type { AppBindings } from "../context.js";
import { requireSession, withContext } from "../context.js";

/**
 * Utilidades de desarrollo. Bloqueadas fuera de `IUSIA_ENV=development`.
 *
 * Los datos que crean quedan marcados explícitamente como datos de desarrollo:
 * el prompt maestro prohíbe presentar seed data como información real.
 */
export const devRoutes = new Hono<AppBindings>();

devRoutes.use("*", async (c, next) => {
  if (c.env.IUSIA_ENV !== "development") {
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
