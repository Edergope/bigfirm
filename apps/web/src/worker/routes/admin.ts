import { Hono } from "hono";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { FirmRole, IusiaError, MatterRole } from "@iusia/domain";
import { schema } from "@iusia/db";
import type { AppBindings } from "../context.js";
import { GoogleDriveAdapter } from "../integrations/google-drive.js";
import { ResendNotificationProvider } from "../integrations/notifications.js";
import { AiSearchRetrievalProvider } from "../integrations/ai-search.js";
import { StripeBillingProvider } from "../integrations/stripe-billing.js";
import { GoogleDocsTemplateAdapter, DocxtemplaterAdapter } from "../integrations/templates.js";
import { uploadToAiSearch } from "../services/ingestion.js";

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
/**
 * Acceso a expedientes de toda la firma, para administración.
 *
 * Sólo lectura y sólo para quien ya administra la firma: no cambia el ACL, no
 * concede nada y no expone expedientes fuera de la organización. Existe porque la
 * dirección podía invitar personas pero no ver, en un solo lugar, a qué casos
 * tenía acceso cada una — que es justo la pregunta que se hace al repartir trabajo.
 */
adminRoutes.get("/matter-access", async (c) => {
  const { db, matters } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  await requireFirmAdmin(c.get("ctx"), organizationId, userId);

  // La administración de la firma ya está verificada arriba; este listado es
  // exactamente el alcance de firma, en sólo lectura.
  const list = await matters.listForUser(organizationId, userId, { includeAll: true });
  const rows = await Promise.all(
    list.map(async (m) => ({
      matter_id: m.id,
      reference: m.reference,
      title: m.title,
      members: (await matters.listMembers(m.id)).map((mem) => ({
        user_id: mem.userId,
        name: mem.name,
        email: mem.email,
        role: mem.role,
      })),
    })),
  );
  void db;
  return c.json({ matters: rows });
});

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

/**
 * Impide dejar el tenant sin administración. No es gobernanza multi-tenant: es la
 * integridad operacional mínima de la firma.
 */
export async function assertNotLastDirector(
  db: AppBindings["Variables"]["ctx"]["db"],
  organizationId: string,
  targetUserId: string,
  action: "degradar" | "retirar",
): Promise<void> {
  const directors = await db
    .select({ userId: schema.member.userId })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, organizationId),
        eq(schema.member.role, "FIRM_DIRECTOR"),
      ),
    );
  const isTargetDirector = directors.some((d) => d.userId === targetUserId);
  if (isTargetDirector && directors.length <= 1) {
    throw new IusiaError(
      "CONFLICT",
      `No se puede ${action} al último director: la firma quedaría sin dirección`,
    );
  }
}

const SetRoleInput = z.object({ user_id: z.string().min(1), role: FirmRole });

/** Cambia el rol de firma de un miembro. */
adminRoutes.post("/members/role", async (c) => {
  const { db, audit } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  await requireFirmAdmin(c.get("ctx"), organizationId, userId);

  const parsed = SetRoleInput.safeParse(await c.req.json());
  if (!parsed.success) throw new IusiaError("VALIDATION_FAILED", "Rol inválido");

  // Integridad operacional: la firma nunca puede quedarse sin dirección, ni por
  // autodegradación ni degradando al último director.
  if (parsed.data.role !== "FIRM_DIRECTOR") {
    await assertNotLastDirector(db, organizationId, parsed.data.user_id, "degradar");
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

/**
 * Autodiagnóstico del canal de correo (mismo patrón que el self-test de Drive).
 *
 * Un fallo de entrega silencioso es indistinguible de un correo no abierto: esta
 * ruta devuelve el resultado NORMALIZADO del proveedor para poder operar el sistema.
 * Sólo administración de la firma. Nunca expone la API key ni el contenido; el
 * destinatario es siempre el propio administrador que la invoca.
 */
adminRoutes.post("/integrations/email/self-test", async (c) => {
  const { db } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  await requireFirmAdmin(c.get("ctx"), organizationId, userId);

  const [me] = await db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  if (!me) throw new IusiaError("NOT_FOUND", "Usuario no encontrado");

  const provider = new ResendNotificationProvider({
    apiKey: c.env.RESEND_API_KEY ?? null,
    from: c.env.RESEND_FROM ?? "IUSIA <notificaciones@iusia.legal>",
  });
  const result = await provider.send({
    to: me.email,
    subject: "IUSIA — prueba de canal de correo",
    text: "Prueba operativa del canal de correo de IUSIA. No requiere ninguna acción.",
    tags: { flow: "email_self_test" },
  });

  return c.json({
    provider: provider.id,
    configured: provider.status(),
    // Diagnóstico normalizado: estado, clasificación y motivo (código HTTP), sin
    // credenciales. `from_configured` indica sólo si la variable está presente.
    result: {
      status: result.status,
      failure_kind: "failure_kind" in result ? result.failure_kind : null,
      detail: "error" in result ? result.error : null,
    },
    from_configured: Boolean(c.env.RESEND_FROM),
  });
});

/**
 * Ejecuciones recientes para el control del sistema.
 *
 * Vista técnica reservada a la autoridad de plataforma: aquí sí procede ver estado,
 * duración, consumo y causa de un circuit breaker. La experiencia jurídica no expone
 * nada de esto. La autorización es `requireSystemSuperadmin`, no el rol de firma.
 */
adminRoutes.get("/system/executions", async (c) => {
  const { authz, executions, matters } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  await authz.requireSystemSuperadmin(userId, "system.executions.read", organizationId);

  const roots = await executions.listRecentRoots(organizationId, 25);
  const rows = await Promise.all(
    roots.map(async (r) => {
      const matter = await matters.findById(organizationId, r.matterId);
      const nodes = await executions.listByRoot(r.id);
      const specialists = nodes.filter((n) => n.id !== r.id);
      return {
        root_execution_id: r.id,
        matter_id: r.matterId,
        matter_title: matter?.title ?? r.matterId,
        status: r.status,
        started_at: r.createdAt,
        completed_at: r.completedAt,
        error_code: r.errorCode,
        agents: specialists.length,
        credits: specialists.reduce((sum, n) => sum + (n.creditsConsumed ?? 0), 0),
      };
    }),
  );
  return c.json({ executions: rows });
});

/**
 * Smoke técnico de ingestión AI Search reservado a SYSTEM_SUPERADMIN.
 *
 * Usa contenido sintético fijo, no acepta documentos del usuario y limpia el item
 * al terminar si la API devuelve id. Sirve para validar el binding real de staging
 * sin crear una segunda instancia ni exponer contenido jurídico.
 */
adminRoutes.post("/system/ingestion-smoke", async (c) => {
  const { authz } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  await authz.requireSystemSuperadmin(userId, "system.ingestion.smoke", organizationId);

  const key = "iusia-e2e-ingestion-smoke-20260826.md";
  const content = "IUSIA_AI_SEARCH_BINDING_SMOKE_20260826";
  const metadata = {
    organization_id: "org_iusia_smoke_20260826",
    matter_id: "mtr_iusia_smoke_20260826",
    document_id: "doc_iusia_smoke_20260826",
    document_version: "1",
    is_current: "true",
  };

  let itemId: string | undefined;
  try {
    const item = await uploadToAiSearch(c.env.AI_SEARCH ?? null, key, content, metadata);
    itemId = item.id;
    return c.json({
      ok: true,
      key: item.key ?? key,
      status: item.status,
      chunks_count: item.chunks_count ?? null,
      file_size: item.file_size ?? null,
      cleaned_up: await cleanupAiSearchSmoke(c.env.AI_SEARCH ?? null, itemId),
    });
  } catch (error) {
    return c.json(
      {
        ok: false,
        key,
        error_name: error instanceof Error ? error.name : typeof error,
        safe_message: error instanceof Error ? error.message.slice(0, 300) : "unknown",
        cleaned_up: await cleanupAiSearchSmoke(c.env.AI_SEARCH ?? null, itemId),
      },
      200,
    );
  }
});

async function cleanupAiSearchSmoke(
  aiSearch: AppBindings["Bindings"]["AI_SEARCH"] | null,
  itemId: string | undefined,
) {
  if (!aiSearch?.items?.delete || !itemId) return false;
  try {
    await aiSearch.items.delete(itemId);
    return true;
  } catch {
    return false;
  }
}

const RemoveMemberInput = z.object({ user_id: z.string().min(1) });

/**
 * Retira a un miembro de la firma.
 *
 * Al dejar de ser miembro pierde el tenant y, con él, cualquier acceso a
 * expedientes: `AuthorizationService` deniega sin rol de firma. Las filas de
 * `matter_members` se retiran para que no quede acceso utilizable; el rastro de lo
 * ocurrido queda en la auditoría, que es donde corresponde.
 */
adminRoutes.post("/members/remove", async (c) => {
  const { db, audit } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  await requireFirmAdmin(c.get("ctx"), organizationId, userId);

  const parsed = RemoveMemberInput.safeParse(await c.req.json());
  if (!parsed.success) throw new IusiaError("VALIDATION_FAILED", "Miembro inválido");
  const targetUserId = parsed.data.user_id;

  await assertNotLastDirector(db, organizationId, targetUserId, "retirar");

  const [existing] = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, organizationId),
        eq(schema.member.userId, targetUserId),
      ),
    )
    .limit(1);
  if (!existing) throw new IusiaError("NOT_FOUND", "El usuario no es miembro de esta firma");

  await db
    .delete(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, organizationId),
        eq(schema.member.userId, targetUserId),
      ),
    );
  await db
    .delete(schema.matterMembers)
    .where(
      and(
        eq(schema.matterMembers.organizationId, organizationId),
        eq(schema.matterMembers.userId, targetUserId),
      ),
    );

  await audit.record({
    organizationId,
    actorUserId: userId,
    action: "member.removed",
    resourceType: "member",
    resourceId: targetUserId,
    outcome: "SUCCESS",
  });

  return c.json({ ok: true });
});

/** Invitaciones de la firma con su estado real (Better Auth). Nunca expone tokens. */
adminRoutes.get("/invitations", async (c) => {
  const { db } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  await requireFirmAdmin(c.get("ctx"), organizationId, userId);

  const rows = await db
    .select({
      id: schema.invitation.id,
      email: schema.invitation.email,
      role: schema.invitation.role,
      status: schema.invitation.status,
      expiresAt: schema.invitation.expiresAt,
      createdAt: schema.invitation.createdAt,
    })
    .from(schema.invitation)
    .where(eq(schema.invitation.organizationId, organizationId));

  const now = Date.now();
  return c.json({
    invitations: rows.map((r) => ({
      // El id se usa como identificador de la fila, no como credencial: quien no
      // recibió el correo tampoco puede aceptarla (Better Auth exige sesión propia).
      id: r.id,
      email: r.email,
      role: r.role,
      // El estado mostrado refleja también la caducidad efectiva.
      status: r.status === "pending" && r.expiresAt.getTime() < now ? "expired" : r.status,
      expires_at: r.expiresAt.toISOString(),
      created_at: r.createdAt.toISOString(),
    })),
  });
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
