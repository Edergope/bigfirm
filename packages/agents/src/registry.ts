import { IusiaError } from "@iusia/domain";
import { AgentDefinition } from "./definition.js";
import pilotAgents from "./pilot-agents.json" with { type: "json" };

/**
 * Agent Registry — piloto técnico: 00 Managing Partner, 01 Intake, 03 Investigación.
 *
 * Las definiciones viven en `pilot-agents.json` para que el runtime y el script de
 * sincronización de prompts lean exactamente la misma fuente, sin duplicarla.
 *
 * Los `prompt_sha256` provienen de `repo/manifests/AGENTS_MANIFEST.json` y fueron
 * verificados contra los archivos canónicos. Si un agent.md cambia, el hash deja de
 * coincidir y el Prompt Loader falla de forma explícita: esa es la protección de
 * integridad de la propiedad intelectual, no un obstáculo.
 *
 * Los 27 agentes restantes NO se registran todavía (Blueprint §10: primero el
 * vertical slice end-to-end). Habilitarlos es añadir entradas a ese JSON.
 */
const DEFINITIONS: AgentDefinition[] = pilotAgents.map((raw) => AgentDefinition.parse(raw));

const BY_ID = new Map(DEFINITIONS.map((d) => [d.agent_id, d]));
const BY_NODE = new Map(DEFINITIONS.map((d) => [d.node_code, d]));

export function listAgentDefinitions(): readonly AgentDefinition[] {
  return DEFINITIONS;
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
