import type { Materiality } from "@iusia/domain";
import type { AgentDefinition } from "@iusia/agents";
import { WAVES, type Wave } from "./dag.js";

/**
 * Motor de routing jurídico DETERMINISTA.
 *
 * Decide QUÉ agentes deben intervenir según los datos del Matter (materialidad,
 * áreas de práctica, necesidades). El modelo puede recomendar, pero la decisión
 * la toma y persiste el sistema (Blueprint §06; prompt maestro §27).
 *
 * No todo asunto ejecuta los 30 agentes. La materialidad y el área acotan el plan.
 */

/** Área de práctica del Matter → agente especialista canónico. */
const PRACTICE_AREA_SPECIALIST: Record<string, string> = {
  CIVIL: "especialista-civil-bienes-e-inmobiliario",
  COMERCIAL_CONTRACTUAL: "especialista-contractual-y-negocios",
  SOCIETARIO_MA: "especialista-societario-y-mna",
  LABORAL: "especialista-laboral-y-seguridad-social",
  TRIBUTARIO: "especialista-tributario-y-aduanero",
  PENAL_ECONOMICO: "especialista-penal-corporativo-y-delitos-economicos",
  ADMINISTRATIVO: "especialista-administrativo-y-regulatorio",
  CONSTITUCIONAL: "especialista-constitucional-y-derechos-fundamentales",
  FAMILIA: "especialista-familia-y-planeacion-patrimonial",
  INMOBILIARIO: "especialista-civil-bienes-e-inmobiliario",
  PROPIEDAD_INTELECTUAL: "especialista-propiedad-intelectual-y-datos",
  INSOLVENCIA: "especialista-insolvencia-y-reestructuracion",
  MIGRATORIO: "especialista-migratorio-y-movilidad",
  FINANCIERO: "especialista-financiero-y-mercado-capitales",
  COMPLIANCE: "oficial-compliance-sagrilaft-ptee",
};

export interface RoutingInput {
  materiality: Materiality;
  practice_areas: readonly string[];
  /** Señales del intake que activan agentes condicionales. */
  needs?: {
    evidence?: boolean;
    procedural?: boolean;
    negotiation?: boolean;
    litigation?: boolean;
  };
}

export interface RoutedAgent {
  agent_id: string;
  wave: Wave;
  /** El sistema lo incluyó en el plan por esta razón trazable. */
  reason: string;
  /** True si además está habilitado para ejecución real hoy. */
  executable_now: boolean;
}

export interface RoutingPlan {
  materiality: Materiality;
  agents: RoutedAgent[];
  /** Agentes planificados pero aún deshabilitados (registrados, no ejecutables). */
  planned_disabled: string[];
  /** Snapshot determinista para persistir/auditar. */
  signature: string;
}

/**
 * Construye el plan de routing. Determinista: mismos inputs ⇒ mismo plan.
 * `agents` es el registro completo (para saber wave/enabled de cada uno).
 */
export function buildRoutingPlan(
  input: RoutingInput,
  agents: readonly AgentDefinition[],
): RoutingPlan {
  const byId = new Map(agents.map((a) => [a.agent_id, a]));
  const enabled = new Set(agents.filter((a) => a.enabled).map((a) => a.agent_id));
  const routed: RoutedAgent[] = [];
  const seen = new Set<string>();

  const add = (agentId: string, reason: string) => {
    if (seen.has(agentId)) return;
    const def = byId.get(agentId);
    if (!def) return;
    seen.add(agentId);
    routed.push({
      agent_id: agentId,
      wave: def.wave ?? "WAVE_2_SUBSTANTIVE_SPECIALISTS",
      reason,
      executable_now: enabled.has(agentId),
    });
  };

  // Fundación: siempre.
  add("pisoso-orquestador-juridico", "orquestación: dirige e integra");
  add("01-intake-y-clasificador", "fundación: base fáctica");
  add("03-investigador-normativo-jurisprudencial", "fundación: investigación normativa");

  if (input.needs?.evidence) add("04-analista-probatorio-y-pericial", "señal: necesidad probatoria");
  if (input.needs?.procedural) add("05-analista-procesal-y-procedibilidad", "señal: cuestión procesal");

  if (input.materiality !== "SIMPLE") {
    // Especialistas sustantivos según áreas de práctica.
    for (const area of input.practice_areas) {
      const specialist = PRACTICE_AREA_SPECIALIST[area];
      if (specialist) add(specialist, `área de práctica: ${area}`);
    }
    // Estrategia + auditoría de calidad/citas.
    add("06-estratega-juridico-convencional", "materialidad ≥ MATERIAL: estrategia");
    add("10-auditor-juridico-y-red-team", "materialidad ≥ MATERIAL: red team");
    add("11-auditor-de-citas-y-vigencia", "materialidad ≥ MATERIAL: auditoría de citas");
  }

  if (input.materiality === "HIGH_STAKES") {
    add("14-magistrado-procesal-y-nulidades", "HIGH_STAKES: shadow bench procesal");
    add("15-estratega-disruptivo-y-negociador", "HIGH_STAKES: estrategia disruptiva");
  }
  if (input.needs?.negotiation) add("15-estratega-disruptivo-y-negociador", "señal: negociación");

  // Síntesis y entrega cuando el asunto produce documento final.
  if (input.materiality !== "SIMPLE") {
    add("08-redactor-senior-juridico", "entrega: redacción senior");
    add("02-compilador-y-entrega-final", "entrega: compilación final");
  }

  // Orden por ola canónica para lectura/ejecución coherente.
  routed.sort((a, b) => WAVES.indexOf(a.wave) - WAVES.indexOf(b.wave));

  const planned_disabled = routed.filter((r) => !r.executable_now).map((r) => r.agent_id);
  const signature = routed.map((r) => r.agent_id).join(">");

  return { materiality: input.materiality, agents: routed, planned_disabled, signature };
}
