import { TERMINAL_STATUSES } from "./execution.js";

/**
 * Modelo de vista de la orquestación para la experiencia del abogado.
 *
 * Traduce lo que el motor registra (ejecuciones + eventos del Execution Ledger)
 * a un lenguaje de PRODUCTO: etapas legibles, un desenlace y las fuentes usadas.
 * No inventa estados: cada etapa y cada desenlace se derivan de datos reales.
 *
 * Estas funciones son puras y viven en el dominio para poder probarse sin DOM ni
 * red. El cliente sólo mapea sus salidas a copy visible; el motor no se toca.
 */

/** Nodo raíz del grafo: dirige e integra. No es un agente sustantivo más. */
export const ORCHESTRATOR_AGENT_ID = "pisoso-orquestador-juridico";

/** Vista mínima de una fila de ejecución que necesita el modelo de progreso. */
export interface ExecutionView {
  id: string;
  agentId: string;
  status: string;
  createdAt: string;
}

/** Vista mínima de un evento del ledger. */
export interface EventView {
  type: string;
  detail?: Record<string, string | number | boolean>;
}

/**
 * Desenlace de la orquestación en términos de producto. `status` sigue siendo la
 * verdad del ledger; este desenlace añade el matiz de "terminó pero sin evidencia".
 */
export type OrchestrationOutcome =
  | "RUNNING"
  | "COMPLETED"
  | "INSUFFICIENT_EVIDENCE"
  | "BLOCKED"
  | "FAILED"
  | "CANCELLED";

export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * Selecciona la ejecución del nodo integrador (00) que produjo la conclusión.
 * Excluye SIEMPRE la fila raíz: comparte `agentId` con el 00 pero es el contenedor
 * de la orquestación, no una ejecución de agente con salida propia.
 */
export function selectIntegratorExecution<T extends ExecutionView>(
  rows: readonly T[],
  rootExecutionId: string,
  orchestratorAgentId: string = ORCHESTRATOR_AGENT_ID,
): T | null {
  const candidates = rows.filter(
    (r) => r.agentId === orchestratorAgentId && r.id !== rootExecutionId,
  );
  if (candidates.length === 0) return null;
  const completed = candidates.filter((r) => r.status === "COMPLETED");
  const pool = completed.length > 0 ? completed : candidates;
  // El más reciente: ante reintentos, la última ejecución es la vigente.
  return pool.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));
}

/**
 * Deriva el desenlace de producto a partir del estado raíz y de si hubo evidencia.
 * Una orquestación COMPLETED sin ningún chunk recuperado se presenta como
 * "sin evidencia suficiente": el motor terminó, pero no hubo base documental.
 */
export function deriveOutcome(args: {
  rootStatus: string;
  evidenceChunkCount: number;
}): OrchestrationOutcome {
  const { rootStatus, evidenceChunkCount } = args;
  if (rootStatus === "CANCELLED") return "CANCELLED";
  if (rootStatus === "FAILED") return "FAILED";
  if (rootStatus === "BLOCKED") return "BLOCKED";
  if (!isTerminalStatus(rootStatus)) return "RUNNING";
  // COMPLETED
  return evidenceChunkCount > 0 ? "COMPLETED" : "INSUFFICIENT_EVIDENCE";
}

export type StageState = "pending" | "active" | "done" | "failed";

/** Una etapa del progreso, en lenguaje de producto (el cliente le pone copy). */
export interface ProgressStage {
  /** Clave estable: "received" | "evidence" | `agent:<agentId>` | "done". */
  key: string;
  /** Presente sólo en etapas de agente; permite resolver el nombre del equipo. */
  agentId?: string;
  state: StageState;
}

function stateFromStatus(status: string): StageState {
  switch (status) {
    case "COMPLETED":
      return "done";
    case "FAILED":
      return "failed";
    case "RUNNING":
    case "WAITING":
    case "PENDING":
      return "active";
    default:
      return "pending";
  }
}

/**
 * Construye las etapas de progreso a partir de datos reales:
 *  1. "received": el encargo entró (hay al menos un evento).
 *  2. "evidence": se recuperó evidencia del expediente (tool call de retrieval).
 *  3. una etapa por cada agente del equipo que efectivamente se ejecutó.
 *  4. "done": la orquestación cerró (estado raíz terminal).
 *
 * El orden de las etapas de agente respeta el orden de creación en el ledger.
 */
export function deriveProgressStages(args: {
  rootStatus: string;
  events: readonly EventView[];
  executions: readonly ExecutionView[];
  rootExecutionId: string;
}): ProgressStage[] {
  const { rootStatus, events, executions, rootExecutionId } = args;

  const hasAnyEvent = events.length > 0;
  const retrieval = events.find(
    (e) => e.type === "agent.tool.called" && e.detail?.tool === "ai_search.retrieval",
  );
  const rootTerminal = isTerminalStatus(rootStatus);

  const stages: ProgressStage[] = [];

  // 1. Encargo recibido.
  stages.push({ key: "received", state: hasAnyEvent ? "done" : "active" });

  // 2. Recuperación de evidencia.
  const evidenceState: StageState = retrieval
    ? "done"
    : rootTerminal
      ? "done"
      : hasAnyEvent
        ? "active"
        : "pending";
  stages.push({ key: "evidence", state: evidenceState });

  // 3. Una etapa por agente del equipo (excluye la fila raíz contenedora).
  const agentRows = executions
    .filter((e) => e.id !== rootExecutionId)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const row of agentRows) {
    stages.push({ key: `agent:${row.agentId}`, agentId: row.agentId, state: stateFromStatus(row.status) });
  }

  // 4. Cierre.
  stages.push({
    key: "done",
    state: rootStatus === "FAILED" ? "failed" : rootTerminal ? "done" : "pending",
  });

  return stages;
}

/** ¿Debe seguir el polling? Sólo mientras la raíz no esté en estado terminal. */
export function shouldKeepPolling(rootStatus: string | undefined): boolean {
  if (!rootStatus) return true;
  return !isTerminalStatus(rootStatus);
}

/**
 * Estados terminales de una orquestación desde la perspectiva de la UI. Incluye
 * BLOCKED además de los tres del ledger: la vista deja de esperar en cuanto el
 * flujo no puede avanzar por sí solo.
 */
export function isTerminalOrchestrationStatus(status: string): boolean {
  return (
    status === "COMPLETED" ||
    status === "FAILED" ||
    status === "CANCELLED" ||
    status === "BLOCKED"
  );
}

/**
 * ¿Hay que refrescar el historial? Sólo en la TRANSICIÓN real de no-terminal a
 * terminal. Devuelve false si ya estaba terminal (evita bucles de invalidación) y
 * false mientras siga en curso.
 */
export function shouldRefreshHistory(
  prevStatus: string | undefined,
  currentStatus: string | undefined,
): boolean {
  return (
    isTerminalOrchestrationStatus(currentStatus ?? "") &&
    !isTerminalOrchestrationStatus(prevStatus ?? "")
  );
}

/**
 * Extrae la conclusión HUMANA de la salida de un agente para presentarla como
 * titular. La salida real puede ser JSON estructurado (p.ej. schema
 * `iusia.orchestration.v1`) cuyo campo legible es `conclusion_brief`.
 *
 * Robustez (no negociable): nunca devuelve "[object Object]", nunca lanza, nunca
 * deja vacío un resultado válido. Prioriza `conclusion_brief`; si falta, usa el
 * mejor campo humano disponible; si nada es interpretable, devuelve el texto crudo
 * tal cual (legible como último recurso). No cambia el schema del agente.
 */
const HUMAN_CONCLUSION_FIELDS = [
  "conclusion_brief",
  "conclusion",
  "analysis_summary",
  "summary",
  "resumen",
  "respuesta",
  "answer",
  "text",
] as const;

/**
 * Busca en profundidad acotada el primer valor string no vacío para `field`.
 * El schema del agente no es estable (p.ej. `conclusion_brief` puede venir a nivel
 * raíz o anidado bajo `result`), por eso la búsqueda recorre el árbol en vez de mirar
 * sólo la raíz. Depth limitado para evitar coste/ciclos.
 */
function findStringFieldDeep(node: unknown, field: string, depth: number): string | null {
  if (depth < 0 || node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const el of node) {
      const found = findStringFieldDeep(el, field, depth - 1);
      if (found) return found;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  const direct = obj[field];
  if (typeof direct === "string" && direct.trim().length > 0) return direct.trim();
  for (const key of Object.keys(obj)) {
    const found = findStringFieldDeep(obj[key], field, depth - 1);
    if (found) return found;
  }
  return null;
}

export function deriveConclusionText(rawOutput: string | null | undefined): string {
  const raw = (rawOutput ?? "").trim();
  if (raw.length === 0) return "";

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // No es JSON: ya es texto humano.
    return raw;
  }

  if (typeof parsed === "string") {
    return parsed.trim().length > 0 ? parsed.trim() : raw;
  }
  if (parsed && typeof parsed === "object") {
    // Prioridad por campo: `conclusion_brief` en cualquier nivel gana a los demás.
    for (const field of HUMAN_CONCLUSION_FIELDS) {
      const found = findStringFieldDeep(parsed, field, 6);
      if (found) return found;
    }
  }
  // Estructurado pero sin campo humano reconocido: se muestra crudo, legible.
  return raw;
}

/**
 * Resuelve nombres legibles de documentos de evidencia a partir de sus ids,
 * conservando el orden y sin inventar: un id sin nombre conocido se muestra tal cual.
 */
export function resolveEvidenceDocuments(
  documentIds: readonly string[],
  documentNames: ReadonlyMap<string, string>,
): Array<{ document_id: string; document_name: string }> {
  return documentIds.map((id) => ({
    document_id: id,
    document_name: documentNames.get(id) ?? id,
  }));
}
