import { describe, expect, it, vi } from "vitest";
import type { TeamPlan } from "@iusia/domain";
import { extractJsonObject, planTeam, type MatterBrief } from "../services/team-planner.js";

/** Planner del Managing Partner: parse + repair×1 + SAFE_FALLBACK (Bloque 7.7A-FIX). */

const CATALOG = [
  { agent_id: "01-intake-y-clasificador", node_code: "01", name: "Intake", specialty: "Recepción de expedientes y base fáctica", runtime_role: "CASE_INTAKE", output_type: "INTAKE" },
  { agent_id: "especialista-contractual-y-negocios", node_code: "CTR", name: "Contractual", specialty: "Diseño e interpretación contractual", runtime_role: "LEGAL_SPECIALIST", output_type: "SPECIALIST_DICTAMEN" },
];
const ELIGIBLE = new Set(CATALOG.map((c) => c.agent_id));

const BRIEF: MatterBrief = {
  title: "Caso",
  materiality: "MATERIAL",
  jurisdiction: "Colombia",
  practice_areas: ["COMERCIAL_CONTRACTUAL"],
  document_summary: ["01_contrato.txt"],
};

const validPlan: TeamPlan = {
  plan_id: "p1",
  objective: "obj",
  issues: [],
  tasks: [
    { task_id: "t1", title: "Intake", agent_id: "01-intake-y-clasificador", mission: "hechos", why_selected: "base", questions: [], depends_on: [], expected_output: "hechos", required: true },
  ],
  integration: { mission: "integra", expected_output: "conclusión" },
};

const FALLBACK = (): TeamPlan => validPlan;

describe("extractJsonObject", () => {
  it("tolera fences ```json y texto alrededor", () => {
    const obj = extractJsonObject('Aquí tienes:\n```json\n{"a":1}\n```') as { a: number };
    expect(obj.a).toBe(1);
  });
  it("recorta al primer objeto balanceado", () => {
    expect(extractJsonObject('ruido {"b":2} fin')).toEqual({ b: 2 });
  });
  it("devuelve null si no hay JSON", () => {
    expect(extractJsonObject("sin json")).toBeNull();
  });
});

describe("planTeam", () => {
  it("acepta un plan LLM válido al primer intento", async () => {
    const runModel = vi.fn().mockResolvedValue(JSON.stringify(validPlan));
    const r = await planTeam({ objective: "obj", brief: BRIEF, catalog: CATALOG, eligible: ELIGIBLE, runModel, fallback: FALLBACK });
    expect(r.source).toBe("llm");
    expect(runModel).toHaveBeenCalledTimes(1);
  });

  it("repara una vez cuando el primer plan es inválido", async () => {
    const runModel = vi
      .fn()
      .mockResolvedValueOnce('{"plan_id":"x"}') // inválido (sin tasks)
      .mockResolvedValueOnce(JSON.stringify(validPlan));
    const r = await planTeam({ objective: "obj", brief: BRIEF, catalog: CATALOG, eligible: ELIGIBLE, runModel, fallback: FALLBACK });
    expect(r.source).toBe("repair");
    expect(runModel).toHaveBeenCalledTimes(2);
  });

  it("cae al SAFE_FALLBACK tras fallar el intento y la reparación", async () => {
    const runModel = vi.fn().mockResolvedValue("basura no-json");
    const r = await planTeam({ objective: "obj", brief: BRIEF, catalog: CATALOG, eligible: ELIGIBLE, runModel, fallback: FALLBACK });
    expect(r.source).toBe("fallback");
    expect(runModel).toHaveBeenCalledTimes(2);
    expect(r.plan.tasks.length).toBeGreaterThanOrEqual(1);
  });

  it("rechaza (vía fallback) un plan que selecciona un agente no elegible", async () => {
    const bad = { ...validPlan, tasks: [{ ...validPlan.tasks[0]!, agent_id: "especialista-tributario-y-aduanero" }] };
    const runModel = vi.fn().mockResolvedValue(JSON.stringify(bad));
    const r = await planTeam({ objective: "obj", brief: BRIEF, catalog: CATALOG, eligible: ELIGIBLE, runModel, fallback: FALLBACK });
    expect(r.source).toBe("fallback");
  });
});
