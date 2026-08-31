import { Hono } from "hono";
import { CreateMatterInput, IusiaError, MatterRole } from "@iusia/domain";
import { z } from "zod";
import type { AppBindings } from "../context.js";

export const mattersRoutes = new Hono<AppBindings>();

/** Cartera visible. Un director ve toda la firma; el resto, sus matters. */
mattersRoutes.get("/", async (c) => {
  const { matters, authz, audit } = c.get("ctx");
  const { organizationId, userId } = c.get("session");

  const supervises = await authz.canSupervisePortfolio(organizationId, userId);
  if (supervises) {
    // La supervisión de cartera completa se audita siempre (Blueprint §04).
    await audit.record({
      organizationId,
      actorUserId: userId,
      action: "portfolio.list",
      resourceType: "organization",
      resourceId: organizationId,
      outcome: "ALLOWED",
      reason: "portfolio_supervision:FIRM_DIRECTOR",
    });
  }

  const rows = await matters.listForUser(organizationId, userId, {
    includeAll: supervises,
  });
  return c.json({ matters: rows, scope: supervises ? "FIRM" : "ASSIGNED" });
});

mattersRoutes.post("/", async (c) => {
  const { matters, audit } = c.get("ctx");
  const { organizationId, userId } = c.get("session");

  const parsed = CreateMatterInput.safeParse(await c.req.json());
  if (!parsed.success) {
    throw new IusiaError("VALIDATION_FAILED", "Datos de expediente inválidos", {
      issues: parsed.error.issues,
    });
  }

  const reference = parsed.data.reference ?? (await matters.nextReference(organizationId));
  const matterId = await matters.create(organizationId, userId, parsed.data, reference);

  await audit.record({
    organizationId,
    matterId,
    actorUserId: userId,
    action: "matter.create",
    resourceType: "matter",
    resourceId: matterId,
    outcome: "SUCCESS",
    detail: { reference },
  });

  const matter = await matters.findById(organizationId, matterId);
  return c.json({ matter }, 201);
});

mattersRoutes.get("/:matterId", async (c) => {
  const { matters, documents, executions, facts, authorities, authz, audit } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const matterId = c.req.param("matterId");

  const decision = await authz.authorizeMatter(organizationId, userId, matterId, "matter:read");
  const matter = await matters.findById(organizationId, matterId);

  const [members, docs, execs, factRows, authorityRows, activity] = await Promise.all([
    matters.listMembers(matterId),
    documents.listForMatter(organizationId, matterId),
    executions.listByMatter(organizationId, matterId),
    facts.listForMatter(organizationId, matterId),
    authorities.listForMatter(organizationId, matterId),
    audit.listForMatter(organizationId, matterId, 50),
  ]);

  return c.json({
    matter,
    members,
    documents: docs,
    executions: execs,
    facts: factRows,
    authorities: authorityRows,
    activity,
    access: { via_supervision: decision.viaSupervision, reason: decision.reason },
  });
});

const AddMemberInput = z.object({
  user_id: z.string().min(1),
  role: MatterRole,
  delegated_by_user_id: z.string().optional(),
});

mattersRoutes.post("/:matterId/members", async (c) => {
  const { matters, authz, audit } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const matterId = c.req.param("matterId");

  await authz.authorizeMatter(organizationId, userId, matterId, "matter:manage_members");

  const parsed = AddMemberInput.safeParse(await c.req.json());
  if (!parsed.success) {
    throw new IusiaError("VALIDATION_FAILED", "Datos de miembro inválidos", {
      issues: parsed.error.issues,
    });
  }

  // El ACL de expediente sólo puede alcanzar a personas de ESTA firma. Sin esta
  // comprobación quedaban filas de acceso apuntando a usuarios de otra organización:
  // inertes, pero engañosas en la tabla que hace de muralla ética.
  await authz.assertOrganizationMember(organizationId, parsed.data.user_id);

  await matters.addMember(
    organizationId,
    matterId,
    parsed.data.user_id,
    parsed.data.role,
    userId,
    parsed.data.delegated_by_user_id,
  );

  // La delegación debe ser trazable y revocable (Blueprint §04).
  await audit.record({
    organizationId,
    matterId,
    actorUserId: userId,
    action: "matter.member.grant",
    resourceType: "matter_member",
    resourceId: parsed.data.user_id,
    outcome: "SUCCESS",
    detail: { role: parsed.data.role, delegated_by: parsed.data.delegated_by_user_id ?? null },
  });

  return c.json({ ok: true }, 201);
});

/**
 * Vinculación por identificador de proveedor: RETIRADA.
 *
 * Esta ruta aceptaba un `drive_file_id` elegido por el cliente y lo leía con la
 * credencial de almacenamiento DE LA FIRMA. Un identificador de proveedor pasaba
 * así a operar como autorización: bastaba conocer el id de un archivo de otro
 * expediente para adjuntarlo al propio, leerlo e indexarlo como evidencia. La
 * cadena legítima es organización → ACL de Matter → identidad documental de IUSIA
 * → proveedor, nunca provider_file_id → acceso.
 *
 * La vía correcta —y la única que usa la aplicación— es subir el archivo por
 * `POST /matters/:matterId/documents/upload`, donde IUSIA crea el archivo en la
 * carpeta del expediente y es ella quien fija el identificador de proveedor.
 */
mattersRoutes.post("/:matterId/documents", async (c) => {
  const { authz, audit } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const matterId = c.req.param("matterId");

  // Se autoriza igualmente para no revelar la existencia del expediente y para que
  // el intento quede atribuido en la auditoría.
  await authz.authorizeMatter(organizationId, userId, matterId, "document:link");
  await audit.record({
    organizationId,
    matterId,
    actorUserId: userId,
    action: "document.link.by_provider_id",
    resourceType: "document",
    resourceId: null,
    outcome: "DENIED",
    reason: "PROVIDER_ID_IS_NOT_AUTHORIZATION",
  });

  throw new IusiaError(
    "VALIDATION_FAILED",
    "Los documentos se incorporan subiéndolos al expediente, no por identificador de almacenamiento.",
    { use_instead: `POST /api/matters/${matterId}/documents/upload` },
  );
});

const SetRiskInput = z.object({
  level: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL", "UNASSESSED"]),
  rationale: z.string().max(2000),
});

mattersRoutes.post("/:matterId/risk", async (c) => {
  const { matters, authz, audit } = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const matterId = c.req.param("matterId");

  await authz.authorizeMatter(organizationId, userId, matterId, "matter:update");

  const parsed = SetRiskInput.safeParse(await c.req.json());
  if (!parsed.success) {
    throw new IusiaError("VALIDATION_FAILED", "Datos de riesgo inválidos", {
      issues: parsed.error.issues,
    });
  }

  await matters.setRisk(organizationId, matterId, parsed.data.level, parsed.data.rationale);
  await audit.record({
    organizationId,
    matterId,
    actorUserId: userId,
    action: "matter.risk.set",
    resourceType: "matter",
    resourceId: matterId,
    outcome: "SUCCESS",
    detail: { level: parsed.data.level },
  });

  return c.json({ ok: true });
});
