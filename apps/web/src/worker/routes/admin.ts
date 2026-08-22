import { Hono } from "hono";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { FirmRole, IusiaError, MatterRole } from "@iusia/domain";
import { schema } from "@iusia/db";
import type { AppBindings } from "../context.js";
import { GoogleDriveAdapter } from "../integrations/google-drive.js";
import { AiSearchRetrievalProvider } from "../integrations/ai-search.js";
import { StripeBillingProvider } from "../integrations/stripe-billing.js";
import { GoogleDocsTemplateAdapter, DocxtemplaterAdapter } from "../integrations/templates.js";

/**
 * Administración de la firma. La identidad y membresía las gobierna Better Auth;
 * IUSIA añade la administración de acceso por Matter y la vista de integraciones.
 * Todo cambio administrativo se audita.
 */
export const adminRoutes = new Hono<AppBindings>();

/** Sólo dirección o socios administran la firma. */
async function requireFirmAdmin(
  ctx: AppBindings["Variables"]["ctx"],
  organizationId: string,
  userId: string,
): Promise<void> {
  const role = await ctx.authz.firmRole(organizationId, userId);
  if (role !== "FIRM_DIRECTOR" && role !== "PARTNER") {
    throw new IusiaError("FORBIDDEN", "Se requiere rol de dirección o socio");
  }
}

/** Miembros de la firma con su rol. */
adminRoutes.get("/members", async (c) => {
  const { db, authz } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  await requireFirmAdmin(c.get("ctx"), organizationId, userId);
  void authz;

  const rows = await db
    .select({
      userId: schema.member.userId,
      role: schema.member.role,
      name: schema.user.name,
      email: schema.user.email,
      createdAt: schema.member.createdAt,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(eq(schema.member.organizationId, organizationId));

  return c.json({ members: rows });
});

const SetRoleInput = z.object({ user_id: z.string().min(1), role: FirmRole });

/** Cambia el rol de firma de un miembro. */
adminRoutes.post("/members/role", async (c) => {
  const { db, audit } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  await requireFirmAdmin(c.get("ctx"), organizationId, userId);

  const parsed = SetRoleInput.safeParse(await c.req.json());
  if (!parsed.success) throw new IusiaError("VALIDATION_FAILED", "Rol inválido");

  // Un director no puede degradarse a sí mismo dejando la firma sin dirección.
  if (parsed.data.user_id === userId && parsed.data.role !== "FIRM_DIRECTOR") {
    const directors = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, organizationId),
          eq(schema.member.role, "FIRM_DIRECTOR"),
        ),
      );
    if (directors.length <= 1) {
      throw new IusiaError("CONFLICT", "La firma no puede quedarse sin dirección");
    }
  }

  await db
    .update(schema.member)
    .set({ role: parsed.data.role })
    .where(
      and(
        eq(schema.member.organizationId, organizationId),
        eq(schema.member.userId, parsed.data.user_id),
      ),
    );

  await audit.record({
    organizationId,
    actorUserId: userId,
    action: "member.role.set",
    resourceType: "member",
    resourceId: parsed.data.user_id,
    outcome: "SUCCESS",
    detail: { role: parsed.data.role },
  });

  return c.json({ ok: true });
});

const GrantMatterAccessInput = z.object({
  matter_id: z.string().min(1),
  user_id: z.string().min(1),
  role: MatterRole,
  delegated_by_user_id: z.string().optional(),
});

/** Administra el acceso por Matter (ACL de IUSIA), separado del rol de firma. */
adminRoutes.post("/matter-access", async (c) => {
  const { matters, authz, audit } = c.get("ctx");
  const { organizationId, userId } = c.get("session");

  const parsed = GrantMatterAccessInput.safeParse(await c.req.json());
  if (!parsed.success) throw new IusiaError("VALIDATION_FAILED", "Datos de acceso inválidos");

  // Quien concede acceso debe poder administrar los miembros de ESE matter.
  await authz.authorizeMatter(organizationId, userId, parsed.data.matter_id, "matter:manage_members");

  await matters.addMember(
    organizationId,
    parsed.data.matter_id,
    parsed.data.user_id,
    parsed.data.role,
    userId,
    parsed.data.delegated_by_user_id,
  );

  await audit.record({
    organizationId,
    matterId: parsed.data.matter_id,
    actorUserId: userId,
    action: "matter.access.grant",
    resourceType: "matter_member",
    resourceId: parsed.data.user_id,
    outcome: "SUCCESS",
    detail: { role: parsed.data.role },
  });

  return c.json({ ok: true }, 201);
});

/** Estado consolidado de todas las integraciones externas. */
adminRoutes.get("/integrations", async (c) => {
  const { organizationId, userId } = c.get("session");
  await requireFirmAdmin(c.get("ctx"), organizationId, userId);

  return c.json({
    storage: { id: "google-drive", status: new GoogleDriveAdapter(null).status() },
    retrieval: { id: "cloudflare-ai-search", status: new AiSearchRetrievalProvider(null).status() },
    billing: { id: "stripe", status: new StripeBillingProvider(null).status() },
    templates: {
      google_docs: new GoogleDocsTemplateAdapter(null).status(),
      docxtemplater: new DocxtemplaterAdapter(false).status(),
    },
    security: {
      perimeter: "Cloudflare Turnstile + WAF (nivel plataforma; ver docs/PENDIENTES.md)",
      notifications: "Resend (no configurado)",
    },
  });
});
