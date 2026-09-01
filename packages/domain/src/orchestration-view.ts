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
  documentCount?: number;
}): OrchestrationOutcome {
  const { rootStatus, evidenceChunkCount, documentCount } = args;
  if (rootStatus === "CANCELLED") return "CANCELLED";
  if (rootStatus === "FAILED") return "FAILED";
  if (rootStatus === "BLOCKED") return "BLOCKED";
  if (!isTerminalStatus(rootStatus)) return "RUNNING";
  // COMPLETED
  if (documentCount === 0) return "COMPLETED";
  return evidenceChunkCount > 0 ? "COMPLETED" : "INSUFFICIENT_EVIDENCE";
}

export interface GroundingNotice {
  /** Etiqueta corta junto al título de la conclusión. */
  label: string;
  tone: "success" | "warning";
  /** Aviso extenso sobre la conclusión. `null` cuando está fundamentada. */
  detail: string | null;
}

/**
 * Fundamentación del análisis ENTREGADO.
 *
 * Un análisis terminado se entrega SIEMPRE. La fundamentación es una propiedad que se
 * declara junto al trabajo, nunca un motivo para ocultarlo.
 *
 * Antes no era así y el resultado se contradecía a sí mismo: `INSUFFICIENT_EVIDENCE`
 * cortaba la pantalla con «Sin evidencia suficiente» y descartaba los outputs, cuando
 * un bloque más abajo la misma pantalla habría mostrado esa conclusión como válida y
 * «Basado en hechos informados». En la ejecución exe_xpxvvs1s09x6hp9p los cinco
 * especialistas produjeron análisis reales sobre los hechos declarados por el abogado
 * —25.395 caracteres sólo el de intake— y el abogado no recibió ninguno.
 *
 * La asimetría lo delataba: sin documentos adjuntos el análisis se entregaba con un
 * matiz, y con documentos adjuntos que no recuperaron nada se entregaba MENOS. El caso
 * con más insumos daba menos producto, que es exactamente al revés.
 *
 * Que no se recuperara nada teniendo documentos SÍ es una anomalía, y por eso se
 * nombra de forma específica y accionable en vez de esconderse tras el aviso genérico.
 */
export function groundingNotice(args: {
  documentCount: number;
  evidenceChunkCount: number;
}): GroundingNotice {
  if (args.evidenceChunkCount > 0) {
    return { label: "Fundamentado en el expediente", tone: "success", detail: null };
  }
  if (args.documentCount === 0) {
    return {
      label: "Basado en hechos informados",
      tone: "warning",
      detail:
        "Este análisis se basa en los hechos informados en el expediente y deberá contrastarse con la documentación cuando sea aportada.",
    };
  }
  const plural = args.documentCount === 1 ? "documento" : "documentos";
  return {
    label: "Basado en hechos informados",
    tone: "warning",
    detail:
      `IUSIA no recuperó fragmentos de ${args.documentCount} ${plural} del expediente, así que este análisis se apoya únicamente en los hechos que declaraste. ` +
      "Revisa el estado de indexación de los documentos antes de usarlo como fundamento.",
  };
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
  documentCount?: number;
}): ProgressStage[] {
  const { rootStatus, events, executions, rootExecutionId, documentCount } = args;

  const hasAnyEvent = events.length > 0;
  const retrieval = events.find(
    (e) => e.type === "agent.tool.called" && e.detail?.tool === "ai_search.retrieval",
  );
  const eventDocumentCount = events
    .map((e) => {
      const count = e.detail?.document_count;
      if (typeof count === "number") return count;
      if (typeof count === "string" && /^\d+$/.test(count)) return Number(count);
      return undefined;
    })
    .find((count): count is number => typeof count === "number");
  const hasNoDocuments = (documentCount ?? eventDocumentCount) === 0;
  const rootTerminal = isTerminalStatus(rootStatus);

  const stages: ProgressStage[] = [];

  // 1. Encargo recibido.
  stages.push({ key: "received", state: hasAnyEvent ? "done" : "active" });

  // 2. Base del análisis. Con cero documentos no se inventa una fase RAG.
  if (hasNoDocuments) {
    stages.push({
      key: "facts",
      state: rootTerminal ? "done" : hasAnyEvent ? "active" : "pending",
    });
  } else {
    const evidenceState: StageState = retrieval
      ? "done"
      : rootTerminal
        ? "done"
        : hasAnyEvent
          ? "active"
          : "pending";
    stages.push({ key: "evidence", state: evidenceState });
  }

  // 3. Una etapa por AGENTE, no por fila de ejecución.
  //
  // El motor reintenta pasos por durabilidad: eso deja filas huérfanas (PENDING o
  // FAILED) del mismo agente. Son ruido operacional, no trabajo jurídico distinto:
  // mostrarlas haría creer que un especialista intervino varias veces. Se agrupan y
  // se conserva el desenlace más avanzado de cada uno.
  for (const row of groupExecutionsByAgent(executions, rootExecutionId)) {
    stages.push({ key: `agent:${row.agentId}`, agentId: row.agentId, state: stateFromStatus(row.status) });
  }

  // 4. Cierre. La clave dice CÓMO terminó, no sólo que terminó: anunciar "análisis
  // completado" en una orquestación detenida a mano le haría creer al abogado que
  // tiene un dictamen. Cada vista traduce la clave a su copy.
  const closingKey =
    rootStatus === "CANCELLED" ? "stopped" : rootStatus === "FAILED" || rootStatus === "BLOCKED" ? "failed" : "done";
  stages.push({
    key: closingKey,
    state: rootStatus === "FAILED" || rootStatus === "BLOCKED" ? "failed" : rootTerminal ? "done" : "pending",
  });

  // Con la raíz ya terminada nada sigue "en curso": una fila latiendo bajo un
  // análisis detenido sugiere trabajo que no está ocurriendo.
  if (rootTerminal) {
    return stages.map((s) => (s.state === "active" ? { ...s, state: "pending" as StageState } : s));
  }

  return stages;
}

/** Un especialista tal y como debe dibujarse en la constelación. */
export interface ConstellationView {
  nodes: Array<{ id: string; label: string; state: "waiting" | "active" | "done" | "failed" }>;
  links: Array<{ from: string; to: string; transferred: boolean }>;
  integrating: boolean;
}

/** Evento con los campos de origen/destino que necesita el grafo. */
export interface GraphEventView extends EventView {
  from_agent_id?: string | null;
  to_agent_id?: string | null;
}

/**
 * Traduce lo ocurrido en el ledger a la constelación que ve el abogado.
 *
 * Sólo dibuja lo que el motor registró: un nodo por especialista realmente
 * despachado, una arista por dependencia declarada en el plan y un pulso por
 * transferencia efectivamente ocurrida. Si el equipo todavía no se conoce,
 * devuelve una constelación vacía y la vista muestra el núcleo pensando.
 */
export function deriveConstellation(args: {
  executions: readonly ExecutionView[];
  events: readonly GraphEventView[];
  rootExecutionId: string;
  orchestratorAgentId?: string;
  /** agent_id → nombre legible del especialista. */
  agentNames: ReadonlyMap<string, string>;
}): ConstellationView {
  const orchestrator = args.orchestratorAgentId ?? ORCHESTRATOR_AGENT_ID;

  // Los especialistas son los agentes distintos del orquestador realmente ejecutados.
  const grouped = groupExecutionsByAgent(args.executions, args.rootExecutionId).filter(
    (e) => e.agentId !== orchestrator,
  );

  const nodes = grouped.map((e) => ({
    id: e.agentId,
    label: args.agentNames.get(e.agentId) ?? e.agentId,
    state: constellationState(e.status),
  }));

  const present = new Set(nodes.map((n) => n.id));

  // Dependencias declaradas en el despacho + transferencias efectivamente emitidas.
  const declared = new Map<string, boolean>();
  for (const ev of args.events) {
    if (ev.type === "agent.dispatched" && typeof ev.detail?.depends_on === "string") {
      const to = ev.to_agent_id;
      if (!to || !present.has(to)) continue;
      for (const from of ev.detail.depends_on.split(",").map((x) => x.trim()).filter(Boolean)) {
        if (present.has(from)) declared.set(`${from}->${to}`, declared.get(`${from}->${to}`) ?? false);
      }
    }
    if (ev.type === "message.transferred" && ev.from_agent_id && ev.to_agent_id) {
      if (present.has(ev.from_agent_id) && present.has(ev.to_agent_id)) {
        declared.set(`${ev.from_agent_id}->${ev.to_agent_id}`, true);
      }
    }
  }

  const links = [...declared.entries()].map(([key, transferred]) => {
    const [from, to] = key.split("->");
    return { from: from!, to: to!, transferred };
  });

  // El integrador está consolidando cuando su fase arrancó y aún no cerró la raíz.
  const integrating = args.events.some(
    (e) => e.detail?.phase === "integrate" && (e.type === "agent.started" || e.type === "agent.dispatched"),
  );

  return { nodes, links, integrating };
}

function constellationState(status: string): "waiting" | "active" | "done" | "failed" {
  switch (status) {
    case "COMPLETED":
      return "done";
    case "FAILED":
      return "failed";
    case "RUNNING":
    case "WAITING":
      return "active";
    default:
      return "waiting";
  }
}

/** Prioridad de desenlace: lo alcanzado pesa más que un reintento posterior fallido. */
const STATUS_RANK: Record<string, number> = {
  COMPLETED: 5,
  RUNNING: 4,
  WAITING: 3,
  FAILED: 2,
  BLOCKED: 2,
  PENDING: 1,
  CANCELLED: 1,
};

/**
 * Colapsa las filas de ejecución en una por agente, conservando el estado más
 * avanzado y el orden de primera aparición. Excluye la fila raíz, que es el
 * contenedor de la orquestación y no un especialista.
 */
export function groupExecutionsByAgent<T extends ExecutionView>(
  executions: readonly T[],
  rootExecutionId: string,
): T[] {
  const byAgent = new Map<string, T>();
  const order: string[] = [];
  const rows = executions
    .filter((e) => e.id !== rootExecutionId)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const row of rows) {
    const current = byAgent.get(row.agentId);
    if (!current) {
      byAgent.set(row.agentId, row);
      order.push(row.agentId);
      continue;
    }
    const rank = STATUS_RANK[row.status] ?? 0;
    const currentRank = STATUS_RANK[current.status] ?? 0;
    if (rank > currentRank) byAgent.set(row.agentId, row);
  }
  return order.map((id) => byAgent.get(id)!);
}

/**
 * Retira del texto entregado al abogado el encabezado de procedencia interna que
 * algunos agentes anteponen (identificadores de ejecución y rutas de almacenamiento).
 *
 * Esa trazabilidad es real y se conserva en el ledger y en la salida estructurada;
 * simplemente no pertenece a la lectura jurídica. No se altera el contenido del
 * dictamen: sólo se recorta el bloque técnico inicial.
 */
export function stripInternalProvenance(text: string): string {
  const lines = text.split("\n");
  const isProvenanceLine = (line: string): boolean => {
    const t = line.trim();
    if (t.length === 0) return false;
    if (/^(PRODUCED_BY|AGENT_EXECUTION_ID|SOURCE_INPUTS|EXECUTION_ID|DATE|STATUS)\s*:/i.test(t)) return true;
    // Continuación de una lista de fuentes con rutas internas o ids de ejecución.
    if (/^[-*]\s/.test(t) && /(executions\/|exe_[a-z0-9]{8,})/i.test(t)) return true;
    return false;
  };

  let cut = 0;
  let sawProvenance = false;
  for (let i = 0; i < lines.length; i++) {
    if (isProvenanceLine(lines[i]!)) {
      sawProvenance = true;
      cut = i + 1;
      continue;
    }
    // Una línea en blanco dentro del bloque no lo interrumpe.
    if (sawProvenance && lines[i]!.trim().length === 0) {
      cut = i + 1;
      continue;
    }
    break;
  }
  if (!sawProvenance) return text;
  const rest = lines.slice(cut).join("\n").trim();
  // Si el recorte se comiera todo el contenido, se prefiere el texto íntegro.
  return rest.length > 0 ? rest : text;
}

/**
 * Retira del cuerpo del dictamen las referencias técnicas internas que algunos
 * agentes intercalan al integrar hallazgos.
 *
 * `stripInternalProvenance` sólo recorta el encabezado; esto limpia lo que aparece
 * DENTRO del texto: rutas de artefactos, identificadores de ejecución y de flujo,
 * claves de prompt. Un dictamen que dice
 * `(ref=executions/.../exe_kppb6bjskbgy9k2g.json)` obliga al abogado a leer
 * fontanería en medio de un razonamiento jurídico, y ese identificador no significa
 * nada para él ni para su cliente.
 *
 * Los identificadores de agente se sustituyen por el nombre del especialista cuando
 * se conoce: la autoría del hallazgo SÍ es información jurídica y se conserva; lo
 * que se retira es su forma de código.
 *
 * Nada de esto toca el ledger: la trazabilidad íntegra sigue en la salida
 * estructurada y en la actividad técnica.
 */
/** Marcadores que convierten una referencia en fontanería interna. */
const INTERNAL_REF = /executions\/|artifacts\/|prompts\/|exe_[a-z0-9]{8,}|wf_[a-z0-9]{8,}|\.json/i;

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sanitizeLegalOutput(
  text: string,
  agentNames: ReadonlyMap<string, string> = new Map(),
  documentNames: ReadonlyMap<string, string> = new Map(),
): string {
  let out = text;

  // Nombre humano del especialista en lugar de su identificador de catálogo.
  for (const [agentId, name] of agentNames) {
    if (!agentId || !name) continue;
    out = out.split(agentId).join(name);
  }

  // Los documentos se citan por su nombre y su fragmento, no por su id interno:
  // `doc_pp3mtb…#1` no le dice nada al abogado sobre qué está leyendo.
  for (const [docId, name] of documentNames) {
    if (!docId || !name) continue;
    out = out.replace(
      new RegExp(escapeForRegExp(docId) + "#(\\d+)", "g"),
      (_m, chunk: string) => `${name} (fragmento ${chunk})`,
    );
    out = out.split(docId).join(name);
  }

  // Referencias internas: `(ref=executions/…/exe_….json)` y sus variantes sueltas.
  //
  // Se acota la longitud y se decide en JavaScript en vez de encadenar cuantificadores
  // dentro del patrón: `[^)]*…[^)]*` provoca retroceso catastrófico y llegó a colgar
  // la petición del resultado con salidas largas sin paréntesis de cierre.
  out = out.replace(/\s*\((?:ref|source|src)\s*=\s*[^)\n]{0,300}\)/gi, (match) =>
    INTERNAL_REF.test(match) ? "" : match,
  );
  out = out.replace(/\s*\b(?:ref|source|src)\s*=\s*[^\s)\n]{0,300}/gi, (match) =>
    INTERNAL_REF.test(match) ? "" : match,
  );
  // Rutas de artefactos y de prompts, e identificadores de ejecución o flujo sueltos.
  out = out.replace(/\b(?:executions|artifacts|prompts)\/[^\s)"',\n]{0,300}/gi, "");
  out = out.replace(/\b(?:exe|wf|run)_[a-z0-9]{8,}\b/gi, "");

  // La limpieza deja restos de puntuación: se normalizan sin tocar el contenido.
  out = out
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").replace(/\(\s*\)/g, "").trimEnd())
    .join("\n");

  const cleaned = out.trim();
  // Si la limpieza se comiera el dictamen, se prefiere el texto íntegro.
  return cleaned.length > 0 ? cleaned : text;
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
  // El schema de salida de los agentes no es estable: el mismo integrador ha
  // devuelto `conclusion_brief`, `two_line_summary` y `executive_summary` en
  // corridas distintas. Reconocerlos aquí es más barato —y menos invasivo— que
  // tocar los prompts canónicos, y el coste de no reconocerlos es que el abogado
  // recibe un volcado de JSON donde esperaba un dictamen.
  "two_line_summary",
  "executive_summary",
  "brief",
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

// ───────────────────── Analyses en segundo plano ─────────────────────

export interface ActiveAnalysisRef {
  root_execution_id: string;
  matter_id: string;
  matter_title: string;
}

/**
 * Análisis que estaban en curso y ya no lo están.
 *
 * El servidor sólo publica los ACTIVOS, así que la desaparición de una raíz de la
 * lista es la señal de que terminó. Se calcula sobre listas, no sobre eventos, para
 * que un aviso no dependa de tener el modal abierto: el abogado puede estar en otra
 * vista y aun así enterarse. Una lista `prev` vacía no genera avisos —el primer
 * sondeo tras cargar la aplicación no debe anunciar trabajo anterior.
 */
/**
 * Aviso de cierre de un análisis, según CÓMO terminó.
 *
 * El aviso de fondo decía siempre «El análisis de IUSIA terminó» en tono de éxito,
 * incluso cuando el abogado acababa de detenerlo: la ventana decía «Análisis
 * detenido» y el aviso, a la vez, que había terminado bien. Un sistema que se
 * contradice sobre lo que acaba de pasar no es creíble en nada más.
 */
export function analysisCompletionNotice(status: string): {
  title: string;
  tone: "success" | "critical" | "navy";
} {
  if (status === "CANCELLED") {
    return { title: "El análisis de IUSIA fue detenido", tone: "navy" };
  }
  if (status === "FAILED" || status === "BLOCKED") {
    return { title: "El análisis de IUSIA no pudo completarse", tone: "critical" };
  }
  if (status === "COMPLETED") {
    return { title: "El análisis de IUSIA terminó", tone: "success" };
  }
  // Estado desconocido o aún no terminal: se informa sin afirmar un desenlace.
  return { title: "El análisis de IUSIA salió de los análisis en curso", tone: "navy" };
}

/**
 * Espera declarada mientras el socio director planifica.
 *
 * La fase 00 PLAN es una sola llamada de razonamiento que en producción tarda entre
 * medio minuto y algo más de dos. Mientras dura, el ledger emite `PLAN_MODEL_ATTEMPT`
 * pero no hay avance que mostrar. Sin decir nada, la pantalla parecía congelada —y en
 * la primera prueba real con un abogado, eso terminó en una cancelación humana de un
 * análisis que estaba funcionando.
 */
export function planningWaitHint(args: {
  events: readonly EventView[];
  rootStatus: string;
}): string | null {
  if (isTerminalStatus(args.rootStatus)) return null;
  const attempted = args.events.some(
    (e) => e.type === "agent.milestone" && e.detail?.milestone === "PLAN_MODEL_ATTEMPT",
  );
  if (!attempted) return null;
  const planned = args.events.some(
    (e) => e.type === "agent.milestone" && e.detail?.milestone === "PLAN_COMPLETE",
  );
  if (planned) return null;
  return "El socio director está estudiando el encargo para decidir qué especialistas intervienen. Suele tardar entre uno y dos minutos.";
}

/**
 * Una raíz de orquestación no puede seguir «en curso» indefinidamente.
 *
 * El motor tiene un límite duro de tiempo de pared por ejecución, así que una raíz
 * creada hace mucho más que eso y todavía no terminal no está trabajando: su workflow
 * murió sin cerrar el ledger. Contarla como activa hace que el indicador de la firma
 * mienta —«2 análisis en curso» cuando sólo hay uno— y esconde el problema real.
 *
 * El margen es deliberadamente generoso (el doble del límite del motor): antes se
 * oculta un problema que se esconde un análisis lento que sigue vivo.
 */
export const ABANDONED_ROOT_AFTER_MINUTES = 30;

export function isAbandonedRoot(createdAt: string, now: Date = new Date()): boolean {
  const started = Date.parse(createdAt);
  if (Number.isNaN(started)) return false;
  return now.getTime() - started > ABANDONED_ROOT_AFTER_MINUTES * 60_000;
}

/**
 * Cómo presentar un fallo al cargar un expediente.
 *
 * «Expediente no disponible» se mostraba ante CUALQUIER error, de modo que un 503
 * transitorio era indistinguible de un expediente inexistente o de una falta de
 * autorización. Son tres cosas distintas y sólo una es responsabilidad del abogado.
 */
export function matterLoadFailure(status: number): {
  title: string;
  hint: string;
  retryable: boolean;
} {
  if (status === 404) {
    return {
      title: "Expediente no encontrado",
      hint: "Este expediente no existe o no está entre los que tienes asignados.",
      retryable: false,
    };
  }
  if (status === 403) {
    return {
      title: "Sin acceso a este expediente",
      hint: "No formas parte del equipo de este expediente. Pídeselo a la dirección de la firma.",
      retryable: false,
    };
  }
  if (status === 401) {
    return {
      title: "Sesión expirada",
      hint: "Vuelve a iniciar sesión para continuar.",
      retryable: false,
    };
  }
  if (status >= 500 || status === 0) {
    return {
      title: "No fue posible cargar el expediente",
      hint: "Es un problema temporal del servicio, no del expediente. El análisis en curso, si lo hay, sigue trabajando.",
      retryable: true,
    };
  }
  return {
    title: "No fue posible cargar el expediente",
    hint: "Vuelve a intentarlo.",
    retryable: true,
  };
}

export function diffFinishedAnalyses(
  prev: readonly ActiveAnalysisRef[],
  next: readonly ActiveAnalysisRef[],
): ActiveAnalysisRef[] {
  if (prev.length === 0) return [];
  const stillActive = new Set(next.map((a) => a.root_execution_id));
  return prev.filter((a) => !stillActive.has(a.root_execution_id));
}
