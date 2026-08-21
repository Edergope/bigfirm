import type { Materiality } from "@iusia/domain";
import type { DagNode, HardGate, Wave } from "./dag.js";
import { WAVE_GATE } from "./dag.js";

/**
 * Evaluación de gates. DETERMINISTA Y DEL LADO DEL SERVIDOR.
 *
 * Regla no negociable del Blueprint §01: no se entrega a un LLM el cálculo final
 * de gates. El modelo aporta criterio profesional dentro de un agente; el sistema
 * decide si el DAG avanza.
 */

export interface GateInput {
  wave: Wave;
  materiality: Materiality;
  /** Nodos que el plan exige para esta ola. */
  requiredNodes: readonly DagNode[];
  /** Agentes con ejecución COMPLETED. */
  completedAgentIds: ReadonlySet<string>;
  /** Agentes cuya ejecución falló. */
  failedAgentIds: ReadonlySet<string>;
  /** Aprobación humana registrada para este gate, si se exigía. */
  humanApproval: { approved: boolean; approvedBy: string; approvedAt: string } | null;
}

export interface GateResult {
  gate: HardGate;
  passed: boolean;
  /** Motivo legible; se registra como evento gate.evaluated. */
  reason: string;
  missing: string[];
  requiresHumanApproval: boolean;
}

/**
 * Los asuntos HIGH_STAKES exigen aprobación humana antes de cerrar los gates
 * de estrategia y de integridad final. Es un approval gate, no una sugerencia.
 */
const HUMAN_APPROVAL_GATES: readonly HardGate[] = ["STRATEGY_GATE", "FINAL_HARD_GATE"];

export function requiresHumanApproval(gate: HardGate, materiality: Materiality): boolean {
  return materiality === "HIGH_STAKES" && HUMAN_APPROVAL_GATES.includes(gate);
}

export function evaluateGate(input: GateInput): GateResult {
  const gate = WAVE_GATE[input.wave];
  const needsHuman = requiresHumanApproval(gate, input.materiality);

  const missing = input.requiredNodes
    .filter((n) => !input.completedAgentIds.has(n.agent_id))
    .map((n) => n.agent_id);

  const failed = input.requiredNodes
    .filter((n) => input.failedAgentIds.has(n.agent_id))
    .map((n) => n.agent_id);

  if (failed.length > 0) {
    return {
      gate,
      passed: false,
      reason: `gate_blocked_by_failed_executions:${failed.join(",")}`,
      missing,
      requiresHumanApproval: needsHuman,
    };
  }

  if (missing.length > 0) {
    return {
      gate,
      passed: false,
      reason: `gate_prerequisites_pending:${missing.join(",")}`,
      missing,
      requiresHumanApproval: needsHuman,
    };
  }

  if (needsHuman && !input.humanApproval?.approved) {
    return {
      gate,
      passed: false,
      reason: "gate_awaiting_human_approval",
      missing: [],
      requiresHumanApproval: true,
    };
  }

  return {
    gate,
    passed: true,
    reason: needsHuman
      ? `gate_passed_with_human_approval:${input.humanApproval?.approvedBy}`
      : "gate_passed",
    missing: [],
    requiresHumanApproval: needsHuman,
  };
}
