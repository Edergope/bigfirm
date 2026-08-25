import { describe, expect, it } from "vitest";
import { validateTeamPlan, type TeamPlan } from "./team-plan.js";

/**
 * Validación determinista del TeamPlan (Bloque 7.7A-FIX).
 * Un plan inválido JAMÁS se ejecuta: estos tests son la primera línea del circuit breaker.
 */

const ELIGIBLE = new Set([
  "pisoso-orquestador-juridico",
  "01-intake-y-clasificador",
  "03-investigador-normativo-jurisprudencial",
  "04-analista-probatorio-y-pericial",
  "06-estratega-juridico-convencional",
  "especialista-contractual-y-negocios",
]);

const task = (over: Partial<TeamPlan["tasks"][number]> = {}) => ({
  task_id: "t-intake",
  title: "Intake",
  agent_id: "01-intake-y-clasificador",
  mission: "Mapa fáctico del caso",
  why_selected: "Necesario para establecer los hechos",
  questions: [],
  depends_on: [],
  expected_output: "hechos estructurados",
  required: true,
  ...over,
});

const basePlan = (tasks: unknown[]): unknown => ({
  plan_id: "plan_1",
  objective: "Análisis integral de la controversia",
  issues: [],
  tasks,
  integration: { mission: "Integra los hallazgos", expected_output: "conclusión consolidada" },
});

describe("validateTeamPlan", () => {
  it("acepta un plan válido con dependencias acíclicas", () => {
    const plan = basePlan([
      task(),
      task({ task_id: "t-ctr", agent_id: "especialista-contractual-y-negocios", mission: "Interpreta el contrato", depends_on: ["t-intake"] }),
    ]);
    const r = validateTeamPlan(plan, ELIGIBLE);
    expect(r.ok).toBe(true);
  });

  it("[TEST A] rechaza un ciclo A→B→A sin ejecutar nada", () => {
    const plan = basePlan([
      task({ task_id: "A", agent_id: "04-analista-probatorio-y-pericial", depends_on: ["B"] }),
      task({ task_id: "B", agent_id: "06-estratega-juridico-convencional", depends_on: ["A"] }),
    ]);
    const r = validateTeamPlan(plan, ELIGIBLE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("CYCLE_DETECTED");
  });

  it("[TEST B] rechaza más especialistas que HARD_MAX (7 > 6)", () => {
    const seven = Array.from({ length: 7 }, (_, i) =>
      task({ task_id: `t${i}`, agent_id: i === 0 ? "01-intake-y-clasificador" : `x-agent-${i}` }),
    );
    const r = validateTeamPlan(basePlan(seven), ELIGIBLE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("TOO_MANY_SPECIALISTS");
  });

  it("[TEST K] rechaza un agente no elegible/disabled", () => {
    const plan = basePlan([task({ task_id: "t-x", agent_id: "especialista-tributario-y-aduanero" })]);
    const r = validateTeamPlan(plan, ELIGIBLE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("AGENT_NOT_ELIGIBLE");
  });

  it("[TEST L] rechaza si el modelo inyecta model/provider/tools/scope", () => {
    const plan = basePlan([task()]) as Record<string, unknown>;
    (plan.tasks as Record<string, unknown>[])[0]!.model = "gpt-4o";
    (plan.tasks as Record<string, unknown>[])[0]!.provider = "openai";
    plan.organization_id = "org_injected";
    const r = validateTeamPlan(plan, ELIGIBLE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("FORBIDDEN_KEYS");
  });

  it("rechaza dependencia inexistente y auto-dependencia", () => {
    const plan = basePlan([
      task({ task_id: "t-a", depends_on: ["t-a"] }),
      task({ task_id: "t-b", agent_id: "04-analista-probatorio-y-pericial", depends_on: ["t-zzz"] }),
    ]);
    const r = validateTeamPlan(plan, ELIGIBLE);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const codes = r.errors.map((e) => e.code);
      expect(codes).toContain("SELF_DEPENDENCY");
      expect(codes).toContain("DEPENDENCY_NOT_FOUND");
    }
  });

  it("rechaza agente duplicado en dos tareas", () => {
    const plan = basePlan([
      task({ task_id: "t1", agent_id: "04-analista-probatorio-y-pericial" }),
      task({ task_id: "t2", agent_id: "04-analista-probatorio-y-pericial", mission: "otra" }),
    ]);
    const r = validateTeamPlan(plan, ELIGIBLE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain("DUPLICATE_AGENT");
  });
});
