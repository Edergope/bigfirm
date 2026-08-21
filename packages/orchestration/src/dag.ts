import type { Materiality } from "@iusia/domain";

/**
 * DAG jurídico de IUSIA.
 *
 * Los nombres de olas y gates NO se inventan: replican el DAG canónico de
 * `repo/orchestration/routing/auto_entrypoint.py` (canonical_dag_waves / hard_gates),
 * que es propiedad intelectual jurídica del sistema.
 *
 * Cloudflare Workflows ejecuta este DAG de forma durable. El DAG en sí —qué agentes,
 * en qué orden, qué corre en paralelo y qué gate bloquea— es de IUSIA, no del motor.
 */

export const WAVES = [
  "WAVE_1_INTAKE_AND_RESEARCH",
  "WAVE_2_SUBSTANTIVE_SPECIALISTS",
  "WAVE_3_STRATEGY_AND_LITIGATION",
  "WAVE_4_AUDITING_AND_INTEGRITY",
  "WAVE_5_SYNTHESIS_AND_DELIVERY",
] as const;
export type Wave = (typeof WAVES)[number];

export const HARD_GATES = [
  "FOUNDATION_GATE",
  "SPECIALIST_GATE",
  "STRATEGY_GATE",
  "FINAL_HARD_GATE",
  "SYNTHESIS_GATE",
] as const;
export type HardGate = (typeof HARD_GATES)[number];

/** Gate que cierra cada ola. Ninguna ola avanza sin cerrar el suyo. */
export const WAVE_GATE: Record<Wave, HardGate> = {
  WAVE_1_INTAKE_AND_RESEARCH: "FOUNDATION_GATE",
  WAVE_2_SUBSTANTIVE_SPECIALISTS: "SPECIALIST_GATE",
  WAVE_3_STRATEGY_AND_LITIGATION: "STRATEGY_GATE",
  WAVE_4_AUDITING_AND_INTEGRITY: "FINAL_HARD_GATE",
  WAVE_5_SYNTHESIS_AND_DELIVERY: "SYNTHESIS_GATE",
};

export interface DagNode {
  agent_id: string;
  wave: Wave;
  /** Todos los agentes de esta lista deben estar COMPLETED antes de despachar. */
  requires: readonly string[];
  /** Puede correr en paralelo con otros nodos de la misma ola. */
  parallel: boolean;
  /** Condicional: sólo entra al plan si el routing lo activa. */
  conditional: boolean;
}

/**
 * Plan de ejecución del PILOTO TÉCNICO (Blueprint §10, fase 4).
 * Sólo 00 -> 01 -> 03. Los 27 agentes restantes no están habilitados todavía;
 * añadirlos es agregar nodos aquí, no reescribir prompts ni runtime.
 */
export const PILOT_DAG: readonly DagNode[] = [
  {
    agent_id: "pisoso-orquestador-juridico",
    wave: "WAVE_1_INTAKE_AND_RESEARCH",
    requires: [],
    parallel: false,
    conditional: false,
  },
  {
    agent_id: "01-intake-y-clasificador",
    wave: "WAVE_1_INTAKE_AND_RESEARCH",
    requires: ["pisoso-orquestador-juridico"],
    parallel: false,
    conditional: false,
  },
  {
    agent_id: "03-investigador-normativo-jurisprudencial",
    wave: "WAVE_1_INTAKE_AND_RESEARCH",
    requires: ["01-intake-y-clasificador"],
    parallel: true,
    conditional: false,
  },
];

/**
 * Routing por materialidad. Determina cuántos agentes se ejecutan realmente:
 * no todo asunto ejecuta los 30. En el piloto los tres nodos son obligatorios
 * en cualquier materialidad, pero la función ya es el punto de extensión.
 */
export function planFor(
  materiality: Materiality,
  dag: readonly DagNode[] = PILOT_DAG,
): readonly DagNode[] {
  if (materiality === "SIMPLE") {
    return dag.filter((n) => !n.conditional);
  }
  return dag;
}

/** Nodos de una ola listos para despacho dado el conjunto de agentes completados. */
export function readyNodes(
  plan: readonly DagNode[],
  completedAgentIds: ReadonlySet<string>,
): readonly DagNode[] {
  return plan.filter(
    (n) =>
      !completedAgentIds.has(n.agent_id) &&
      n.requires.every((r) => completedAgentIds.has(r)),
  );
}

/** Grupos de despacho: cada grupo puede lanzarse en paralelo real. */
export function dispatchBatches(plan: readonly DagNode[]): DagNode[][] {
  const batches: DagNode[][] = [];
  const completed = new Set<string>();
  let remaining = [...plan];

  while (remaining.length > 0) {
    const ready = readyNodes(remaining, completed);
    if (ready.length === 0) {
      throw new Error(
        `DAG con dependencias irresolubles: ${remaining.map((n) => n.agent_id).join(", ")}`,
      );
    }
    // Un nodo no paralelizable ocupa su propio lote.
    const serial = ready.find((n) => !n.parallel);
    const batch = serial ? [serial] : [...ready];
    batches.push(batch);
    for (const n of batch) completed.add(n.agent_id);
    remaining = remaining.filter((n) => !completed.has(n.agent_id));
  }

  return batches;
}
