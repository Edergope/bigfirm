import type { TeamPlan } from "@iusia/domain";
import type { DagNode, Wave } from "./dag.js";

/**
 * Traduce un TeamPlan YA VALIDADO en DagNode[] para reutilizar `dispatchBatches`
 * (no se crea un segundo dispatcher). Un plan validado es un contrato inmutable:
 * este mapeo es puro y determinista.
 *
 * Identidad del nodo = agent_id (los duplicados de agente están prohibidos por el
 * validador, de modo que task_id ↔ agent_id es biyectivo dentro del plan).
 */

const INTAKE_AGENT = "01-intake-y-clasificador";

/** Nodos de especialistas. El nodo integrador (00) lo añade el workflow al final. */
export function teamPlanToDag(plan: TeamPlan): DagNode[] {
  const agentByTask = new Map(plan.tasks.map((t) => [t.task_id, t.agent_id]));

  return plan.tasks.map((t): DagNode => {
    const requires = t.depends_on
      .map((depTaskId) => agentByTask.get(depTaskId))
      .filter((a): a is string => Boolean(a));
    // El intake pertenece a la ola de fundación; el resto, a especialistas sustantivos.
    const wave: Wave =
      t.agent_id === INTAKE_AGENT ? "WAVE_1_INTAKE_AND_RESEARCH" : "WAVE_2_SUBSTANTIVE_SPECIALISTS";
    return {
      agent_id: t.agent_id,
      wave,
      requires,
      parallel: true,
      conditional: false,
    };
  });
}

/** Mapa task_id → agent_id, para poblar upstream_outputs y eventos de transferencia. */
export function taskAgentMap(plan: TeamPlan): Map<string, string> {
  return new Map(plan.tasks.map((t) => [t.task_id, t.agent_id]));
}
