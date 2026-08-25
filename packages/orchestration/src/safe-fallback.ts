import type { Materiality, TeamPlan, TeamPlanTask } from "@iusia/domain";
import { ORCHESTRATION_LIMITS } from "@iusia/domain";
import type { AgentDefinition } from "@iusia/agents";
import { buildRoutingPlan } from "./routing.js";

/**
 * SAFE_FALLBACK determinista: produce un TeamPlan válido cuando el planner LLM
 * falla o devuelve un plan inválido tras el intento de reparación.
 *
 * NO cae siempre a 00→01→03: usa el routing determinista real (materialidad + áreas
 * de práctica) y sólo incluye agentes EJECUTABLES (enabled). El estratega depende de
 * los especialistas sustantivos ya presentes, para conservar una dependencia real.
 */

/** Misiones genéricas por agente para el fallback (subordinadas al agent.md canónico). */
const FALLBACK_MISSION: Record<string, string> = {
  "01-intake-y-clasificador":
    "Establece la base fáctica del expediente: partes, hechos relevantes, cronología y clasificación del asunto, citando la evidencia recuperada.",
  "03-investigador-normativo-jurisprudencial":
    "Investiga el marco normativo y jurisprudencial aplicable al asunto, distinguiendo hechos del expediente de la investigación jurídica.",
  "04-analista-probatorio-y-pericial":
    "Analiza el valor probatorio de la evidencia del expediente: qué acredita, qué contradice y qué falta.",
  "05-analista-procesal-y-procedibilidad":
    "Evalúa vías procesales, procedibilidad y mecanismos de solución de controversias aplicables.",
  "06-estratega-juridico-convencional":
    "Formula una estrategia jurídica fundamentada, integrando los hallazgos de los demás especialistas y la evidencia del expediente.",
  "especialista-contractual-y-negocios":
    "Analiza el régimen contractual: interpretación, obligaciones, terminación, efectos de otrosíes e indemnización, según la evidencia.",
};

const STRATEGIST = "06-estratega-juridico-convencional";
const INTAKE = "01-intake-y-clasificador";

export function buildFallbackTeamPlan(
  input: {
    objective: string;
    materiality: Materiality;
    practice_areas: readonly string[];
  },
  agents: readonly AgentDefinition[],
): TeamPlan {
  const routing = buildRoutingPlan(
    { materiality: input.materiality, practice_areas: input.practice_areas },
    agents,
  );

  // Sólo especialistas ejecutables, excluyendo al orquestador (PLAN/INTEGRATE).
  const specialists = routing.agents
    .filter((a) => a.executable_now && a.agent_id !== "pisoso-orquestador-juridico")
    .slice(0, ORCHESTRATION_LIMITS.HARD_MAX_SPECIALISTS);

  const mission = (agentId: string, reason: string): string =>
    FALLBACK_MISSION[agentId] ?? `Analiza el asunto en tu ámbito (${reason}) con base en la evidencia del expediente.`;

  const taskIdFor = (agentId: string) => `t-${agentId}`.slice(0, 80);

  // Los task_ids de los que el estratega depende: intake + sustantivos + investigación.
  const upstreamForStrategist = specialists
    .filter((a) => a.agent_id !== STRATEGIST)
    .map((a) => taskIdFor(a.agent_id));

  const tasks: TeamPlanTask[] = specialists.map((a) => {
    const isStrategist = a.agent_id === STRATEGIST;
    const isIntake = a.agent_id === INTAKE;
    const depends_on = isStrategist
      ? upstreamForStrategist
      : isIntake
        ? []
        : specialists.some((s) => s.agent_id === INTAKE)
          ? [taskIdFor(INTAKE)]
          : [];
    return {
      task_id: taskIdFor(a.agent_id),
      title: a.agent_id,
      agent_id: a.agent_id,
      mission: mission(a.agent_id, a.reason),
      why_selected: a.reason,
      questions: [],
      depends_on,
      expected_output: "hallazgos fundamentados en el expediente",
      required: a.agent_id === INTAKE, // el intake es requerido; el resto opcional en fallback
    };
  });

  return {
    plan_id: `fallback_${Date.now().toString(36)}`,
    objective: input.objective,
    issues: [],
    tasks: tasks.length > 0 ? tasks : [
      {
        task_id: taskIdFor(INTAKE),
        title: INTAKE,
        agent_id: INTAKE,
        mission: mission(INTAKE, "fundación"),
        why_selected: "fundación: base fáctica",
        questions: [],
        depends_on: [],
        expected_output: "hechos estructurados",
        required: true,
      },
    ],
    integration: {
      mission:
        "Integra los hallazgos de los especialistas, detecta contradicciones, prioriza la evidencia del expediente, marca la incertidumbre y entrega una conclusión consolidada con recomendaciones y evidencia faltante.",
      expected_output: "análisis consolidado fundamentado",
    },
  };
}
