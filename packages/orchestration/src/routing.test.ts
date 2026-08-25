import { describe, expect, it } from "vitest";
import { listAgentDefinitions } from "@iusia/agents";
import { buildRoutingPlan } from "./routing.js";

const AGENTS = listAgentDefinitions();

describe("motor de routing jurídico", () => {
  it("un asunto SIMPLE ejecuta sólo la fundación", () => {
    const plan = buildRoutingPlan(
      { materiality: "SIMPLE", practice_areas: ["COMERCIAL_CONTRACTUAL"] },
      AGENTS,
    );
    expect(plan.agents.map((a) => a.agent_id)).toEqual([
      "pisoso-orquestador-juridico",
      "01-intake-y-clasificador",
      "03-investigador-normativo-jurisprudencial",
    ]);
  });

  it("un asunto MATERIAL añade el especialista del área, estrategia y auditoría", () => {
    const plan = buildRoutingPlan(
      { materiality: "MATERIAL", practice_areas: ["LABORAL"] },
      AGENTS,
    );
    const ids = plan.agents.map((a) => a.agent_id);
    expect(ids).toContain("especialista-laboral-y-seguridad-social");
    expect(ids).toContain("06-estratega-juridico-convencional");
    expect(ids).toContain("11-auditor-de-citas-y-vigencia");
    expect(ids).toContain("02-compilador-y-entrega-final");
  });

  it("HIGH_STAKES incorpora shadow bench y estrategia disruptiva", () => {
    const plan = buildRoutingPlan(
      { materiality: "HIGH_STAKES", practice_areas: ["SOCIETARIO_MA"] },
      AGENTS,
    );
    const ids = plan.agents.map((a) => a.agent_id);
    expect(ids).toContain("14-magistrado-procesal-y-nulidades");
    expect(ids).toContain("15-estratega-disruptivo-y-negociador");
    expect(ids).toContain("especialista-societario-y-mna");
  });

  it("marca como planned_disabled los agentes aún no habilitados", () => {
    const plan = buildRoutingPlan(
      { materiality: "MATERIAL", practice_areas: ["TRIBUTARIO"] },
      AGENTS,
    );
    // El especialista del área ya es operacional tras la activación del registry...
    const executable = plan.agents.filter((a) => a.executable_now).map((a) => a.agent_id);
    expect(executable).toContain("especialista-tributario-y-aduanero");
    expect(executable).toContain("pisoso-orquestador-juridico");
    // ...pero los roles de documento siguen feature-gated hasta el Document Pipeline.
    expect(plan.planned_disabled).toContain("08-redactor-senior-juridico");
    expect(plan.planned_disabled).toContain("02-compilador-y-entrega-final");
  });

  it("es determinista: mismos inputs producen la misma firma", () => {
    const input = { materiality: "MATERIAL" as const, practice_areas: ["CIVIL"] };
    const a = buildRoutingPlan(input, AGENTS);
    const b = buildRoutingPlan(input, AGENTS);
    expect(a.signature).toBe(b.signature);
  });

  it("las señales del intake activan agentes condicionales", () => {
    const plan = buildRoutingPlan(
      {
        materiality: "SIMPLE",
        practice_areas: ["CIVIL"],
        needs: { evidence: true, procedural: true },
      },
      AGENTS,
    );
    const ids = plan.agents.map((a) => a.agent_id);
    expect(ids).toContain("04-analista-probatorio-y-pericial");
    expect(ids).toContain("05-analista-procesal-y-procedibilidad");
  });

  it("ordena los agentes por ola canónica", () => {
    const plan = buildRoutingPlan(
      { materiality: "HIGH_STAKES", practice_areas: ["PENAL_ECONOMICO"] },
      AGENTS,
    );
    const waves = plan.agents.map((a) => a.wave);
    const order = [
      "WAVE_1_INTAKE_AND_RESEARCH",
      "WAVE_2_SUBSTANTIVE_SPECIALISTS",
      "WAVE_3_STRATEGY_AND_LITIGATION",
      "WAVE_4_AUDITING_AND_INTEGRITY",
      "WAVE_5_SYNTHESIS_AND_DELIVERY",
    ];
    const indices = waves.map((w) => order.indexOf(w));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });
});
