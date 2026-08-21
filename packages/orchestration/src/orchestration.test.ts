import { describe, expect, it } from "vitest";
import { dispatchBatches, PILOT_DAG, planFor, readyNodes } from "./dag.js";
import { evaluateGate, requiresHumanApproval } from "./gates.js";

describe("DAG jurídico", () => {
  it("respeta el orden 00 → 01 → 03 del piloto", () => {
    const batches = dispatchBatches(planFor("MATERIAL"));
    expect(batches.map((b) => b.map((n) => n.agent_id))).toEqual([
      ["pisoso-orquestador-juridico"],
      ["01-intake-y-clasificador"],
      ["03-investigador-normativo-jurisprudencial"],
    ]);
  });

  it("no despacha un nodo cuyas dependencias no han terminado", () => {
    const ready = readyNodes(PILOT_DAG, new Set());
    expect(ready.map((n) => n.agent_id)).toEqual(["pisoso-orquestador-juridico"]);
  });

  it("detecta dependencias irresolubles en lugar de colgarse", () => {
    expect(() =>
      dispatchBatches([
        { agent_id: "a", wave: "WAVE_1_INTAKE_AND_RESEARCH", requires: ["b"], parallel: true, conditional: false },
        { agent_id: "b", wave: "WAVE_1_INTAKE_AND_RESEARCH", requires: ["a"], parallel: true, conditional: false },
      ]),
    ).toThrow(/irresolubles/);
  });
});

describe("gates deterministas", () => {
  const requiredNodes = PILOT_DAG.filter((n) => n.wave === "WAVE_1_INTAKE_AND_RESEARCH");

  it("bloquea mientras falten prerrequisitos", () => {
    const result = evaluateGate({
      wave: "WAVE_1_INTAKE_AND_RESEARCH",
      materiality: "MATERIAL",
      requiredNodes,
      completedAgentIds: new Set(["pisoso-orquestador-juridico"]),
      failedAgentIds: new Set(),
      humanApproval: null,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("gate_prerequisites_pending");
  });

  it("bloquea cuando una ejecución requerida falló", () => {
    const result = evaluateGate({
      wave: "WAVE_1_INTAKE_AND_RESEARCH",
      materiality: "MATERIAL",
      requiredNodes,
      completedAgentIds: new Set(requiredNodes.map((n) => n.agent_id)),
      failedAgentIds: new Set(["01-intake-y-clasificador"]),
      humanApproval: null,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("failed_executions");
  });

  it("pasa cuando todos los nodos requeridos terminaron", () => {
    const result = evaluateGate({
      wave: "WAVE_1_INTAKE_AND_RESEARCH",
      materiality: "MATERIAL",
      requiredNodes,
      completedAgentIds: new Set(requiredNodes.map((n) => n.agent_id)),
      failedAgentIds: new Set(),
      humanApproval: null,
    });
    expect(result.passed).toBe(true);
    expect(result.gate).toBe("FOUNDATION_GATE");
  });

  it("exige aprobación humana en HIGH_STAKES sobre estrategia e integridad", () => {
    expect(requiresHumanApproval("STRATEGY_GATE", "HIGH_STAKES")).toBe(true);
    expect(requiresHumanApproval("FINAL_HARD_GATE", "HIGH_STAKES")).toBe(true);
    expect(requiresHumanApproval("STRATEGY_GATE", "MATERIAL")).toBe(false);
    expect(requiresHumanApproval("FOUNDATION_GATE", "HIGH_STAKES")).toBe(false);
  });

  it("no cierra un gate HIGH_STAKES sin aprobación registrada", () => {
    const nodes = [
      {
        agent_id: "06-estratega-juridico-convencional",
        wave: "WAVE_3_STRATEGY_AND_LITIGATION" as const,
        requires: [],
        parallel: false,
        conditional: false,
      },
    ];
    const pending = evaluateGate({
      wave: "WAVE_3_STRATEGY_AND_LITIGATION",
      materiality: "HIGH_STAKES",
      requiredNodes: nodes,
      completedAgentIds: new Set(nodes.map((n) => n.agent_id)),
      failedAgentIds: new Set(),
      humanApproval: null,
    });
    expect(pending.passed).toBe(false);
    expect(pending.reason).toBe("gate_awaiting_human_approval");

    const approved = evaluateGate({
      wave: "WAVE_3_STRATEGY_AND_LITIGATION",
      materiality: "HIGH_STAKES",
      requiredNodes: nodes,
      completedAgentIds: new Set(nodes.map((n) => n.agent_id)),
      failedAgentIds: new Set(),
      humanApproval: { approved: true, approvedBy: "usr_1", approvedAt: "2026-08-21T00:00:00Z" },
    });
    expect(approved.passed).toBe(true);
    expect(approved.reason).toContain("usr_1");
  });
});
