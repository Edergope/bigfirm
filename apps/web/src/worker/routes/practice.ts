import { Hono, type Context } from "hono";
import { z } from "zod";
import { IusiaError, calculateDeadline, DeadlineCalculationInput } from "@iusia/domain";
import type { AppBindings } from "../context.js";
import { buildCaseBrief } from "../services/case-brief.js";
import { IntelligenceService } from "../services/intelligence.js";

/**
 * Rutas de práctica jurídica: Case Brief, tareas/términos e IUSIA Intelligence.
 */
export const practiceRoutes = new Hono<AppBindings>();

/** Case Brief estructurado y regenerable. */
practiceRoutes.get("/matters/:matterId/brief", async (c) => {
  const ctx = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const matterId = c.req.param("matterId");
  await ctx.authz.authorizeMatter(organizationId, userId, matterId, "matter:read");
  const brief = await buildCaseBrief(ctx, organizationId, matterId);
  return c.json({ brief });
});

// ─────────────────────────── Tareas y términos ───────────────────────────

practiceRoutes.get("/matters/:matterId/tasks", async (c) => {
  const ctx = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const matterId = c.req.param("matterId");
  await ctx.authz.authorizeMatter(organizationId, userId, matterId, "task:read");
  const tasks = await ctx.tasks.listForMatter(organizationId, matterId);
  return c.json({ tasks });
});

const CreateTaskInput = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  kind: z.enum(["TASK", "PROCEDURAL_DEADLINE", "HEARING"]).optional(),
  due_at: z.string().datetime().optional(),
  assigned_to: z.string().optional(),
  /** Si es un término, se calcula con regla y fuente (nunca fecha suelta). */
  deadline: DeadlineCalculationInput.optional(),
});

practiceRoutes.post("/matters/:matterId/tasks", async (c) => {
  const ctx = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const matterId = c.req.param("matterId");
  await ctx.authz.authorizeMatter(organizationId, userId, matterId, "task:write");

  const parsed = CreateTaskInput.safeParse(await c.req.json());
  if (!parsed.success) {
    throw new IusiaError("VALIDATION_FAILED", "Datos de tarea inválidos", {
      issues: parsed.error.issues,
    });
  }

  // Un término procesal exige cálculo con regla y fuente.
  let dueAt = parsed.data.due_at ?? null;
  let deadlineRule: string | null = null;
  let deadlineSource: string | null = null;
  if (parsed.data.deadline) {
    const result = calculateDeadline(parsed.data.deadline);
    dueAt = `${result.due_date}T23:59:59.000Z`;
    deadlineRule = result.rule;
    deadlineSource = result.source;
  }

  const taskId = await ctx.tasks.create({
    organizationId,
    matterId,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    kind: parsed.data.deadline ? "PROCEDURAL_DEADLINE" : parsed.data.kind ?? "TASK",
    dueAt,
    deadlineRule,
    deadlineSource,
    assignedTo: parsed.data.assigned_to ?? null,
    createdBy: userId,
  });

  await ctx.audit.record({
    organizationId,
    matterId,
    actorUserId: userId,
    action: "task.create",
    resourceType: "task",
    resourceId: taskId,
    outcome: "SUCCESS",
    detail: { is_deadline: Boolean(parsed.data.deadline) },
  });

  return c.json({ task_id: taskId }, 201);
});

const TASK_STATUSES = ["PENDIENTE", "EN_CURSO", "COMPLETADA", "CANCELADA"] as const;
const UpdateTaskInput = z.object({ status: z.enum(TASK_STATUSES) });

/** Actualiza el estado de una tarea/término (lifecycle CRUD). */
practiceRoutes.patch("/matters/:matterId/tasks/:taskId", async (c) => {
  const ctx = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const matterId = c.req.param("matterId");
  const taskId = c.req.param("taskId");
  await ctx.authz.authorizeMatter(organizationId, userId, matterId, "task:write");

  const parsed = UpdateTaskInput.safeParse(await c.req.json());
  if (!parsed.success) {
    throw new IusiaError("VALIDATION_FAILED", "Estado de tarea inválido", {
      allowed: TASK_STATUSES,
    });
  }

  const task = await ctx.tasks.findById(organizationId, taskId);
  if (!task || task.matterId !== matterId) {
    throw new IusiaError("NOT_FOUND", "Tarea no encontrada");
  }

  await ctx.tasks.setStatus(organizationId, taskId, parsed.data.status);
  await ctx.audit.record({
    organizationId,
    matterId,
    actorUserId: userId,
    action: "task.status.set",
    resourceType: "task",
    resourceId: taskId,
    outcome: "SUCCESS",
    detail: { from: task.status, to: parsed.data.status },
  });

  return c.json({ ok: true });
});

/** Cálculo de término sin crear tarea (preview). */
practiceRoutes.post("/deadlines/calculate", async (c) => {
  const parsed = DeadlineCalculationInput.safeParse(await c.req.json());
  if (!parsed.success) {
    throw new IusiaError("VALIDATION_FAILED", "Un término requiere regla, fuente y fecha de inicio", {
      issues: parsed.error.issues,
    });
  }
  return c.json({ result: calculateDeadline(parsed.data) });
});

// ─────────────────────────── IUSIA Intelligence ───────────────────────────

/**
 * Tools read-only. `firmWide` sólo se concede a dirección y queda auditado.
 */
async function resolveFirmWide(c: Context<AppBindings>) {
  const ctx = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  const requested = c.req.query("scope") === "firm";
  if (!requested) return { firmWide: false, organizationId, userId, ctx };
  const canSupervise = await ctx.authz.canSupervisePortfolio(organizationId, userId);
  if (!canSupervise) {
    throw new IusiaError("FORBIDDEN", "El alcance de firma requiere rol de dirección");
  }
  await ctx.audit.record({
    organizationId,
    actorUserId: userId,
    action: "intelligence.firm_scope",
    resourceType: "organization",
    resourceId: organizationId,
    outcome: "ALLOWED",
    reason: "portfolio_supervision",
  });
  return { firmWide: true, organizationId, userId, ctx };
}

practiceRoutes.get("/intelligence/case-health", async (c) => {
  const { ctx, organizationId, userId, firmWide } = await resolveFirmWide(c);
  const svc = new IntelligenceService(ctx, organizationId);
  return c.json(await svc.caseHealth(userId, firmWide));
});

practiceRoutes.get("/intelligence/overdue-tasks", async (c) => {
  const { ctx, organizationId, userId, firmWide } = await resolveFirmWide(c);
  const svc = new IntelligenceService(ctx, organizationId);
  return c.json({ tasks: await svc.overdueTasks(userId, firmWide) });
});

practiceRoutes.get("/intelligence/upcoming-deadlines", async (c) => {
  const { ctx, organizationId, userId, firmWide } = await resolveFirmWide(c);
  const svc = new IntelligenceService(ctx, organizationId);
  const days = Number.parseInt(c.req.query("days") ?? "15", 10);
  return c.json({ deadlines: await svc.upcomingDeadlines(userId, firmWide, days) });
});

practiceRoutes.get("/intelligence/case-risks", async (c) => {
  const { ctx, organizationId, userId, firmWide } = await resolveFirmWide(c);
  const svc = new IntelligenceService(ctx, organizationId);
  return c.json({ risks: await svc.caseRisks(userId, firmWide) });
});

practiceRoutes.get("/intelligence/inactive-matters", async (c) => {
  const { ctx, organizationId, userId, firmWide } = await resolveFirmWide(c);
  const svc = new IntelligenceService(ctx, organizationId);
  return c.json({ matters: await svc.inactiveMatters(userId, firmWide) });
});

/** Carga del equipo: exclusivamente dirección. */
practiceRoutes.get("/intelligence/workload", async (c) => {
  const ctx = c.get("ctx");
  const { organizationId, userId } = c.get("session");
  if (!(await ctx.authz.canSupervisePortfolio(organizationId, userId))) {
    throw new IusiaError("FORBIDDEN", "La carga del equipo es visión de dirección");
  }
  const svc = new IntelligenceService(ctx, organizationId);
  return c.json({ workload: await svc.workload() });
});
