import { describe, expect, it } from "vitest";
import {
  buildAgentCatalog,
  eligibleAgentIds,
  listAgentDefinitions,
  ORCHESTRATOR_AGENT_ID,
} from "@iusia/agents";
import { ORCHESTRATION_LIMITS, validateTeamPlan } from "@iusia/domain";
import { buildFallbackTeamPlan } from "./safe-fallback.js";
import { teamPlanToDag } from "./planner-dag.js";

/**
 * Cobertura del catálogo ampliado por dominio jurídico (Bloque 7.7B).
 *
 * Determinista y sin LLM: ejercita el planner de respaldo, que es la vía por la que
 * el sistema arma un equipo cuando el modelo falla. Valida el CONTRATO (elegibilidad,
 * límites, misiones, aciclicidad), no un agent_id exacto: para un mismo asunto puede
 * haber varias composiciones válidas.
 */

const AGENTS = listAgentDefinitions();
const ELIGIBLE = eligibleAgentIds();

const CASES: Array<{ label: string; area: string; expectAny: string[] }> = [
  { label: "A contractual", area: "COMERCIAL_CONTRACTUAL", expectAny: ["especialista-contractual-y-negocios"] },
  { label: "B laboral", area: "LABORAL", expectAny: ["especialista-laboral-y-seguridad-social"] },
  { label: "C societario", area: "SOCIETARIO_MA", expectAny: ["especialista-societario-y-mna"] },
  { label: "D propiedad intelectual", area: "PROPIEDAD_INTELECTUAL", expectAny: ["especialista-propiedad-intelectual-y-datos"] },
  { label: "E administrativo/regulatorio", area: "ADMINISTRATIVO", expectAny: ["especialista-administrativo-y-regulatorio"] },
  { label: "F tributario", area: "TRIBUTARIO", expectAny: ["especialista-tributario-y-aduanero"] },
  { label: "G compliance", area: "COMPLIANCE", expectAny: ["oficial-compliance-sagrilaft-ptee"] },
];

describe("cobertura del planner por dominio", () => {
  for (const c of CASES) {
    it(`${c.label}: produce un plan válido y activa la competencia del área`, () => {
      const plan = buildFallbackTeamPlan(
        { objective: `Analiza el asunto (${c.label})`, materiality: "MATERIAL", practice_areas: [c.area] },
        AGENTS,
      );
      const v = validateTeamPlan(plan, ELIGIBLE);
      expect(v.ok, JSON.stringify(!v.ok ? v.errors : "")).toBe(true);

      const ids = plan.tasks.map((t) => t.agent_id);
      expect(ids.some((id) => c.expectAny.includes(id)), `área ${c.area} sin su especialista`).toBe(true);

      // Contrato de seguridad, idéntico al del planner LLM.
      expect(plan.tasks.length).toBeLessThanOrEqual(ORCHESTRATION_LIMITS.HARD_MAX_SPECIALISTS);
      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(plan.tasks.map((t) => t.task_id)).size).toBe(ids.length);
      expect(new Set(plan.tasks.map((t) => t.mission)).size).toBe(ids.length);
      for (const id of ids) {
        expect(ELIGIBLE.has(id), `${id} no es seleccionable`).toBe(true);
        expect(id).not.toBe(ORCHESTRATOR_AGENT_ID);
      }
      // El DAG resultante no deja dependencias colgantes.
      const nodes = teamPlanToDag(plan);
      const present = new Set(nodes.map((n) => n.agent_id));
      for (const n of nodes) for (const r of n.requires) expect(present.has(r)).toBe(true);
    });
  }

  it("multidisciplinario: varias áreas no rompen el límite duro de especialistas", () => {
    const plan = buildFallbackTeamPlan(
      {
        objective: "Asunto multidisciplinario",
        materiality: "HIGH_STAKES",
        practice_areas: ["COMERCIAL_CONTRACTUAL", "LABORAL", "TRIBUTARIO", "SOCIETARIO_MA", "PENAL_ECONOMICO"],
      },
      AGENTS,
    );
    expect(validateTeamPlan(plan, ELIGIBLE).ok).toBe(true);
    expect(plan.tasks.length).toBeLessThanOrEqual(ORCHESTRATION_LIMITS.HARD_MAX_SPECIALISTS);
  });

  it("ningún rol de soporte (documento/auditoría/orquestación) entra como especialista", () => {
    const forbidden = new Set(
      AGENTS.filter((a) => !a.planner_eligible).map((a) => a.agent_id),
    );
    for (const materiality of ["SIMPLE", "MATERIAL", "HIGH_STAKES"] as const) {
      const plan = buildFallbackTeamPlan(
        { objective: "x", materiality, practice_areas: ["COMERCIAL_CONTRACTUAL"] },
        AGENTS,
      );
      for (const t of plan.tasks) expect(forbidden.has(t.agent_id), `${t.agent_id} en ${materiality}`).toBe(false);
    }
  });

  it("MAX_SPECIALISTS sigue siendo 6 pese al catálogo ampliado", () => {
    expect(ORCHESTRATION_LIMITS.HARD_MAX_SPECIALISTS).toBe(6);
    expect(ORCHESTRATION_LIMITS.DEFAULT_MAX_SPECIALISTS).toBe(5);
    expect(ORCHESTRATION_LIMITS.MAX_PARALLEL_AGENTS).toBe(3);
    expect(ORCHESTRATION_LIMITS.MAX_MAIN_LLM_EXECUTIONS_PER_ROOT).toBe(8);
    expect(buildAgentCatalog().length).toBeGreaterThan(ORCHESTRATION_LIMITS.HARD_MAX_SPECIALISTS);
  });
});
