import { z } from "zod";
import { ORCHESTRATION_LIMITS, dagDepth } from "./orchestration-safety.js";

/**
 * TeamPlan — contrato del plan de equipo que produce el Managing Partner (00 PLAN)
 * y que el servidor VALIDA antes de construir el DAG dinámico.
 *
 * El plan describe QUÉ especialistas intervienen y QUÉ misión recibe cada uno. NUNCA
 * describe scope (organización/matter), modelo, proveedor, tools ni permisos: eso lo
 * fija el servidor. Un plan validado es un CONTRATO DE EJECUCIÓN INMUTABLE para su
 * root execution: el modelo no puede modificar el DAG después de validado.
 */

/** Campos que el modelo NUNCA puede fijar. Su presencia invalida el plan. */
export const TEAM_PLAN_FORBIDDEN_KEYS = [
  "organization_id",
  "organizationId",
  "matter_id",
  "matterId",
  "provider",
  "model",
  "model_policy",
  "api_key",
  "apiKey",
  "tools",
  "allowed_tools",
  "permissions",
  "wallet",
  "credits",
  "reasoning",
  "chain_of_thought",
] as const;

export const TeamPlanTask = z.object({
  task_id: z.string().min(1).max(80),
  title: z.string().min(1).max(120),
  agent_id: z.string().min(1),
  mission: z.string().min(1).max(2000),
  why_selected: z.string().min(1).max(300),
  questions: z.array(z.string().min(1).max(2000)).max(10).default([]),
  depends_on: z.array(z.string().min(1)).max(6).default([]),
  expected_output: z.string().min(1).max(300),
  required: z.boolean().default(true),
});
export type TeamPlanTask = z.infer<typeof TeamPlanTask>;

export const TeamPlan = z.object({
  plan_id: z.string().min(1),
  objective: z.string().min(1).max(4000),
  issues: z.array(z.string().min(1).max(500)).max(10).default([]),
  tasks: z.array(TeamPlanTask).min(1),
  integration: z.object({
    mission: z.string().min(1).max(2000),
    expected_output: z.string().min(1).max(300),
  }),
});
export type TeamPlan = z.infer<typeof TeamPlan>;

export interface PlanValidationError {
  code: string;
  detail: string;
}

export type TeamPlanValidation =
  | { ok: true; plan: TeamPlan }
  | { ok: false; errors: PlanValidationError[] };

/** Detección de ciclos en el grafo de dependencias (DFS con colores). */
function hasCycle(tasks: readonly TeamPlanTask[]): boolean {
  const adj = new Map(tasks.map((t) => [t.task_id, t.depends_on]));
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>(tasks.map((t) => [t.task_id, WHITE]));

  const visit = (id: string): boolean => {
    color.set(id, GRAY);
    for (const dep of adj.get(id) ?? []) {
      const c = color.get(dep);
      if (c === undefined) continue; // dependencia inexistente: la reporta otra regla
      if (c === GRAY) return true;
      if (c === WHITE && visit(dep)) return true;
    }
    color.set(id, BLACK);
    return false;
  };

  for (const t of tasks) {
    if (color.get(t.task_id) === WHITE && visit(t.task_id)) return true;
  }
  return false;
}

/** Busca recursivamente claves prohibidas en el objeto crudo del plan. */
function findForbiddenKeys(raw: unknown, depth = 4): string[] {
  if (depth < 0 || raw === null || typeof raw !== "object") return [];
  const found: string[] = [];
  if (Array.isArray(raw)) {
    for (const el of raw) found.push(...findForbiddenKeys(el, depth - 1));
    return found;
  }
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    if ((TEAM_PLAN_FORBIDDEN_KEYS as readonly string[]).includes(key)) found.push(key);
    found.push(...findForbiddenKeys((raw as Record<string, unknown>)[key], depth - 1));
  }
  return found;
}

/**
 * Valida un TeamPlan de forma DETERMINÍSTICA y SERVER-SIDE.
 * Un plan inválido JAMÁS se ejecuta.
 *
 * @param raw       objeto crudo devuelto por el planner (o el fallback).
 * @param eligible  agent_ids ejecutables (enabled ∧ en catálogo). El scope real
 *                  (org/matter/model/tools) lo pone el servidor, no el plan.
 */
export function validateTeamPlan(
  raw: unknown,
  eligible: ReadonlySet<string>,
  limits = ORCHESTRATION_LIMITS,
): TeamPlanValidation {
  const errors: PlanValidationError[] = [];

  // 1. Claves prohibidas (scope/model/tools inyectados por el modelo).
  const forbidden = findForbiddenKeys(raw);
  if (forbidden.length > 0) {
    errors.push({ code: "FORBIDDEN_KEYS", detail: [...new Set(forbidden)].join(",") });
  }

  // 2. Schema.
  const parsed = TeamPlan.safeParse(raw);
  if (!parsed.success) {
    errors.push({ code: "SCHEMA_INVALID", detail: parsed.error.issues.map((i) => i.path.join(".") + ":" + i.message).join(" | ") });
    return { ok: false, errors };
  }
  const plan = parsed.data;
  const tasks = plan.tasks;

  // 3. Número de especialistas.
  if (tasks.length < limits.MIN_SPECIALISTS) {
    errors.push({ code: "TOO_FEW_SPECIALISTS", detail: `${tasks.length} < ${limits.MIN_SPECIALISTS}` });
  }
  if (tasks.length > limits.HARD_MAX_SPECIALISTS) {
    errors.push({ code: "TOO_MANY_SPECIALISTS", detail: `${tasks.length} > ${limits.HARD_MAX_SPECIALISTS}` });
  }

  // 4. task_id únicos.
  const ids = new Set<string>();
  for (const t of tasks) {
    if (ids.has(t.task_id)) errors.push({ code: "DUPLICATE_TASK_ID", detail: t.task_id });
    ids.add(t.task_id);
  }

  // 5. agent_id existente y habilitado; sin agente duplicado.
  const seenAgents = new Set<string>();
  for (const t of tasks) {
    if (!eligible.has(t.agent_id)) {
      errors.push({ code: "AGENT_NOT_ELIGIBLE", detail: `${t.task_id}:${t.agent_id}` });
    }
    if (seenAgents.has(t.agent_id)) {
      errors.push({ code: "DUPLICATE_AGENT", detail: t.agent_id });
    }
    seenAgents.add(t.agent_id);
  }

  // 6. depends_on: existentes, sin auto-dependencia.
  for (const t of tasks) {
    for (const dep of t.depends_on) {
      if (dep === t.task_id) errors.push({ code: "SELF_DEPENDENCY", detail: t.task_id });
      else if (!ids.has(dep)) errors.push({ code: "DEPENDENCY_NOT_FOUND", detail: `${t.task_id}->${dep}` });
    }
  }

  // 7. Aciclicidad.
  if (hasCycle(tasks)) errors.push({ code: "CYCLE_DETECTED", detail: "el grafo de dependencias tiene un ciclo" });

  // 8. Profundidad del DAG.
  const depth = dagDepth(tasks.map((t) => ({ task_id: t.task_id, depends_on: t.depends_on })));
  if (depth > limits.MAX_DAG_DEPTH) {
    errors.push({ code: "MAX_DAG_DEPTH_EXCEEDED", detail: `${depth} > ${limits.MAX_DAG_DEPTH}` });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, plan };
}
