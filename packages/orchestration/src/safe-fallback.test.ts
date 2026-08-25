import { describe, expect, it } from "vitest";
import { eligibleAgentIds, listAgentDefinitions } from "@iusia/agents";
import { validateTeamPlan } from "@iusia/domain";
import { buildFallbackTeamPlan } from "./safe-fallback.js";
import { teamPlanToDag } from "./planner-dag.js";

/** SAFE_FALLBACK: siempre produce un TeamPlan válido con los agentes ejecutables. */
describe("buildFallbackTeamPlan", () => {
  it("produce un plan válido para un asunto MATERIAL comercial", () => {
    const plan = buildFallbackTeamPlan(
      { objective: "Analiza la controversia contractual", materiality: "MATERIAL", practice_areas: ["COMERCIAL_CONTRACTUAL"] },
      listAgentDefinitions(),
    );
    const v = validateTeamPlan(plan, eligibleAgentIds());
    expect(v.ok).toBe(true);
  });

  it("no incluye agentes deshabilitados y mapea a un DAG sin dependencias colgantes", () => {
    const plan = buildFallbackTeamPlan(
      { objective: "x", materiality: "MATERIAL", practice_areas: [] },
      listAgentDefinitions(),
    );
    const eligible = eligibleAgentIds();
    for (const t of plan.tasks) expect(eligible.has(t.agent_id)).toBe(true);
    const nodes = teamPlanToDag(plan);
    const agentSet = new Set(nodes.map((n) => n.agent_id));
    for (const n of nodes) for (const req of n.requires) expect(agentSet.has(req)).toBe(true);
  });
});
