import { z } from "zod";
import { ExecutionId, MatterId } from "./ids.js";
import { ExecutionStatus } from "./execution.js";

/**
 * Modelo de eventos de ejecución. Alimenta la Strategy Room.
 *
 * Regla de verdad visual (Blueprint §06, Design System §05): la UI sólo anima
 * lo que existe aquí. Un pulso en una arista exige un evento real registrado.
 * No hay eventos "de relleno" ni estados sintéticos.
 */

export const EXECUTION_EVENT_TYPES = [
  "execution.created",
  "agent.dispatched",
  "agent.started",
  "work_package.sent",
  "agent.progress",
  "agent.tool.called",
  "agent.milestone",
  "agent.output.received",
  "agent.completed",
  "agent.failed",
  "agent.cancelled",
  "message.transferred",
  "gate.evaluated",
  "gate.passed",
  "gate.blocked",
  "execution.completed",
  "execution.failed",
] as const;
export const ExecutionEventType = z.enum(EXECUTION_EVENT_TYPES);
export type ExecutionEventType = z.infer<typeof ExecutionEventType>;

/** Eventos que representan una transferencia real entre nodos del grafo. */
export const EDGE_EVENT_TYPES: readonly ExecutionEventType[] = [
  "work_package.sent",
  "agent.output.received",
  "message.transferred",
];

export const ExecutionEvent = z.object({
  event_id: z.string().min(1),
  matter_id: MatterId,
  /** Ejecución raíz del DAG: agrupa todo el grafo de la Strategy Room. */
  root_execution_id: ExecutionId,
  execution_id: ExecutionId,
  type: ExecutionEventType,
  /** Nodo origen y destino cuando el evento representa una arista. */
  from_agent_id: z.string().nullable(),
  to_agent_id: z.string().nullable(),
  status: ExecutionStatus.nullable(),
  /** Detalle no confidencial: nunca prompts, documentos ni razonamiento privado. */
  detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  /** Secuencia monótona por root_execution_id; permite replay ordenado. */
  sequence: z.number().int().nonnegative(),
  occurred_at: z.string().datetime(),
});
export type ExecutionEvent = z.infer<typeof ExecutionEvent>;

/** Campos prohibidos en `detail`: evita filtrar contenido confidencial a la UI/logs. */
const FORBIDDEN_DETAIL_KEYS = [
  "prompt",
  "system_prompt",
  "document",
  "document_content",
  "content",
  "reasoning",
  "api_key",
  "token",
];

export function assertDetailIsSafe(detail: Record<string, unknown>): void {
  for (const key of Object.keys(detail)) {
    if (FORBIDDEN_DETAIL_KEYS.includes(key.toLowerCase())) {
      throw new Error(
        `El campo "${key}" no puede publicarse en un ExecutionEvent: contenido potencialmente confidencial`,
      );
    }
  }
}

/**
 * Proyección del grafo para la Strategy Room, derivada exclusivamente de eventos.
 * Si un nodo no tiene eventos, no existe en la vista.
 */
export interface StrategyGraphNode {
  execution_id: string;
  agent_id: string;
  status: ExecutionStatus;
  last_event: ExecutionEventType;
  last_event_at: string;
}

export interface StrategyGraphEdge {
  from_agent_id: string;
  to_agent_id: string;
  event_type: ExecutionEventType;
  occurred_at: string;
}

export function projectStrategyGraph(events: readonly ExecutionEvent[]): {
  nodes: StrategyGraphNode[];
  edges: StrategyGraphEdge[];
} {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const nodes = new Map<string, StrategyGraphNode>();
  const edges: StrategyGraphEdge[] = [];

  for (const e of ordered) {
    const existing = nodes.get(e.execution_id);
    const agentId = e.to_agent_id ?? existing?.agent_id ?? e.from_agent_id;
    if (agentId) {
      nodes.set(e.execution_id, {
        execution_id: e.execution_id,
        agent_id: agentId,
        status: e.status ?? existing?.status ?? "PENDING",
        last_event: e.type,
        last_event_at: e.occurred_at,
      });
    }

    if (EDGE_EVENT_TYPES.includes(e.type) && e.from_agent_id && e.to_agent_id) {
      edges.push({
        from_agent_id: e.from_agent_id,
        to_agent_id: e.to_agent_id,
        event_type: e.type,
        occurred_at: e.occurred_at,
      });
    }
  }

  return { nodes: [...nodes.values()], edges };
}
