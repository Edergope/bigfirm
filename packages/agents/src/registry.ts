import { IusiaError } from "@iusia/domain";
import { AgentDefinition } from "./definition.js";
import fullAgents from "./full-agents.json" with { type: "json" };

/**
 * Agent Registry — los 30 agentes canónicos registrados por metadata.
 *
 * Las definiciones viven en `full-agents.json` para que el runtime y el script de
 * sincronización de prompts lean exactamente la misma fuente, sin duplicarla.
 * Habilitar un agente es sólo cambiar su `enabled` a true (más sincronizar su
 * prompt a R2): no requiere tocar el runtime ni el prompt jurídico.
 *
 * Los `prompt_sha256` provienen de `repo/manifests/AGENTS_MANIFEST.json` y se
 * verifican contra los archivos canónicos en carga. Si un agent.md cambia, el hash
 * deja de coincidir y el Prompt Loader falla de forma explícita: esa es la
 * protección de integridad de la propiedad intelectual.
 *
 * Piloto técnico ACTIVO (Blueprint §10): 00 → 01 → 03 (enabled). Los otros 27
 * quedan registrados pero deshabilitados hasta su activación por vertical.
 */
const DEFINITIONS: AgentDefinition[] = fullAgents.map((raw) => AgentDefinition.parse(raw));

const BY_ID = new Map(DEFINITIONS.map((d) => [d.agent_id, d]));
const BY_NODE = new Map(DEFINITIONS.map((d) => [d.node_code, d]));

export function listAgentDefinitions(): readonly AgentDefinition[] {
  return DEFINITIONS;
}

/** Sólo los agentes habilitados para ejecución real. */
export function listEnabledAgentDefinitions(): readonly AgentDefinition[] {
  return DEFINITIONS.filter((d) => d.enabled);
}

export function getAgentDefinition(agentId: string): AgentDefinition {
  const def = BY_ID.get(agentId);
  if (!def) {
    throw new IusiaError(
      "AGENT_NOT_REGISTERED",
      `El agente "${agentId}" no está registrado en el Agent Registry`,
      { agent_id: agentId, registered: [...BY_ID.keys()] },
    );
  }
  return def;
}

/** Id canónico del orquestador (fases PLAN e INTEGRATE); no es un especialista. */
export const ORCHESTRATOR_AGENT_ID = "pisoso-orquestador-juridico";

/**
 * Entrada del catálogo que ve el PLANNER. Subset SEGURO de metadata: lo justo para
 * elegir especialistas. NUNCA incluye system prompt, sha, model_policy ni secretos.
 */
export interface AgentCatalogEntry {
  agent_id: string;
  node_code: string;
  name: string;
  role: string;
  domain: string;
  output_type: string;
}

/**
 * Catálogo de especialistas ELEGIBLES para el planner: sólo agentes `enabled`,
 * excluyendo al orquestador (que actúa como PLAN/INTEGRATE, no como especialista).
 */
export function buildAgentCatalog(): AgentCatalogEntry[] {
  return DEFINITIONS.filter((d) => d.enabled && d.agent_id !== ORCHESTRATOR_AGENT_ID).map((d) => ({
    agent_id: d.agent_id,
    node_code: d.node_code,
    name: d.name,
    role: d.role,
    domain: d.domain,
    output_type: d.output_type,
  }));
}

/** Conjunto de agent_ids ejecutables (enabled). El validador de planes lo usa. */
export function eligibleAgentIds(): Set<string> {
  return new Set(DEFINITIONS.filter((d) => d.enabled).map((d) => d.agent_id));
}

export function getAgentByNodeCode(nodeCode: string): AgentDefinition {
  const def = BY_NODE.get(nodeCode);
  if (!def) {
    throw new IusiaError(
      "AGENT_NOT_REGISTERED",
      `No hay agente registrado para el nodo "${nodeCode}" del DAG`,
      { node_code: nodeCode },
    );
  }
  return def;
}
