import { describe, expect, it } from "vitest";
import {
  deriveConclusionText,
  deriveConstellation,
  diffFinishedAnalyses,
  deriveOutcome,
  deriveProgressStages,
  ORCHESTRATOR_AGENT_ID,
  resolveEvidenceDocuments,
  selectIntegratorExecution,
  shouldKeepPolling,
  groupExecutionsByAgent,
  shouldRefreshHistory,
  stripInternalProvenance,
  sanitizeLegalOutput,
  type EventView,
  type ExecutionView,
  type GraphEventView,
} from "./orchestration-view.js";

/**
 * Contrato del modelo de vista de la orquestación (Bloque 7.5 UX).
 * Estas pruebas fijan la traducción motor→producto sin motor ni DOM.
 */

const ROOT = "exe_root";
const row = (over: Partial<ExecutionView>): ExecutionView => ({
  id: "exe_x",
  agentId: "01-intake-y-clasificador",
  status: "COMPLETED",
  createdAt: "2026-08-24T10:00:00.000Z",
  ...over,
});

describe("selectIntegratorExecution", () => {
  it("[A] excluye la fila raíz aunque comparta el agentId del 00", () => {
    const rows = [
      row({ id: ROOT, agentId: ORCHESTRATOR_AGENT_ID, status: "COMPLETED" }),
      row({ id: "exe_00", agentId: ORCHESTRATOR_AGENT_ID, status: "COMPLETED" }),
    ];
    expect(selectIntegratorExecution(rows, ROOT)?.id).toBe("exe_00");
  });

  it("[B] prefiere una ejecución COMPLETED del integrador sobre una fallida", () => {
    const rows = [
      row({ id: "exe_00a", agentId: ORCHESTRATOR_AGENT_ID, status: "FAILED", createdAt: "2026-08-24T10:00:00.000Z" }),
      row({ id: "exe_00b", agentId: ORCHESTRATOR_AGENT_ID, status: "COMPLETED", createdAt: "2026-08-24T09:00:00.000Z" }),
    ];
    expect(selectIntegratorExecution(rows, ROOT)?.id).toBe("exe_00b");
  });

  it("[C] devuelve null si no hay nodo integrador (sólo la raíz)", () => {
    const rows = [row({ id: ROOT, agentId: ORCHESTRATOR_AGENT_ID })];
    expect(selectIntegratorExecution(rows, ROOT)).toBeNull();
  });
});

describe("deriveOutcome", () => {
  it("[D] COMPLETED con evidencia => COMPLETED", () => {
    expect(deriveOutcome({ rootStatus: "COMPLETED", evidenceChunkCount: 3 })).toBe("COMPLETED");
  });
  it("[E] COMPLETED con documentos pero sin evidencia => INSUFFICIENT_EVIDENCE", () => {
    expect(deriveOutcome({ rootStatus: "COMPLETED", evidenceChunkCount: 0 })).toBe(
      "INSUFFICIENT_EVIDENCE",
    );
  });
  it("[E2] COMPLETED text-only no se degrada automáticamente a evidencia insuficiente", () => {
    expect(deriveOutcome({ rootStatus: "COMPLETED", evidenceChunkCount: 0, documentCount: 0 })).toBe(
      "COMPLETED",
    );
  });
  it("[F] estados no terminales => RUNNING; terminales conservan su naturaleza", () => {
    expect(deriveOutcome({ rootStatus: "RUNNING", evidenceChunkCount: 5 })).toBe("RUNNING");
    expect(deriveOutcome({ rootStatus: "WAITING", evidenceChunkCount: 5 })).toBe("RUNNING");
    expect(deriveOutcome({ rootStatus: "FAILED", evidenceChunkCount: 5 })).toBe("FAILED");
    expect(deriveOutcome({ rootStatus: "CANCELLED", evidenceChunkCount: 5 })).toBe("CANCELLED");
  });
});

describe("deriveProgressStages", () => {
  const events: EventView[] = [
    { type: "execution.created" },
    { type: "agent.tool.called", detail: { tool: "ai_search.retrieval", chunk_count: 4 } },
  ];

  it("[G] traduce a etapas de producto: recibido, evidencia, un agente por nodo, cierre", () => {
    const executions: ExecutionView[] = [
      row({ id: ROOT, agentId: ORCHESTRATOR_AGENT_ID, status: "COMPLETED" }),
      row({ id: "exe_00", agentId: ORCHESTRATOR_AGENT_ID, status: "COMPLETED", createdAt: "2026-08-24T10:00:01.000Z" }),
      row({ id: "exe_01", agentId: "01-intake-y-clasificador", status: "COMPLETED", createdAt: "2026-08-24T10:00:02.000Z" }),
      row({ id: "exe_03", agentId: "03-investigador-normativo-jurisprudencial", status: "RUNNING", createdAt: "2026-08-24T10:00:03.000Z" }),
    ];
    const stages = deriveProgressStages({ rootStatus: "RUNNING", events, executions, rootExecutionId: ROOT });
    expect(stages.map((s) => s.key)).toEqual([
      "received",
      "evidence",
      "agent:pisoso-orquestador-juridico",
      "agent:01-intake-y-clasificador",
      "agent:03-investigador-normativo-jurisprudencial",
      "done",
    ]);
    expect(stages.find((s) => s.key === "evidence")?.state).toBe("done");
    expect(stages.find((s) => s.key === "agent:03-investigador-normativo-jurisprudencial")?.state).toBe("active");
    // Raíz no terminal => cierre pendiente.
    expect(stages.at(-1)?.state).toBe("pending");
  });

  it("[H] un fallo del agente marca su etapa y el cierre como failed", () => {
    const executions: ExecutionView[] = [
      row({ id: ROOT, agentId: ORCHESTRATOR_AGENT_ID, status: "FAILED" }),
      row({ id: "exe_01", agentId: "01-intake-y-clasificador", status: "FAILED", createdAt: "2026-08-24T10:00:02.000Z" }),
    ];
    const stages = deriveProgressStages({ rootStatus: "FAILED", events, executions, rootExecutionId: ROOT });
    expect(stages.find((s) => s.key === "agent:01-intake-y-clasificador")?.state).toBe("failed");
    expect(stages.at(-1)?.state).toBe("failed");
  });

  it("[H2] con cero documentos no muestra etapa documental falsa", () => {
    const stages = deriveProgressStages({
      rootStatus: "RUNNING",
      events: [{ type: "execution.created" }],
      executions: [],
      rootExecutionId: ROOT,
      documentCount: 0,
    });
    expect(stages.map((s) => s.key)).toEqual(["received", "facts", "done"]);
    expect(stages.map((s) => s.key)).not.toContain("evidence");
  });

  it("[H3] puede inferir cero documentos desde eventos del ledger", () => {
    const stages = deriveProgressStages({
      rootStatus: "RUNNING",
      events: [{ type: "agent.milestone", detail: { milestone: "PLAN_START", document_count: 0 } }],
      executions: [],
      rootExecutionId: ROOT,
    });
    expect(stages.map((s) => s.key)).toEqual(["received", "facts", "done"]);
  });

  it("[H4] acepta document_count serializado como string numérico desde el ledger", () => {
    const stages = deriveProgressStages({
      rootStatus: "RUNNING",
      events: [{ type: "agent.milestone", detail: { milestone: "PLAN_START", document_count: "0" } }],
      executions: [],
      rootExecutionId: ROOT,
    });
    expect(stages.map((s) => s.key)).toEqual(["received", "facts", "done"]);
  });
});

describe("evidencia y polling", () => {
  it("[I] resuelve nombres legibles y deja el id crudo si no hay nombre", () => {
    const resolved = resolveEvidenceDocuments(
      ["doc_atlas", "doc_desconocido"],
      new Map([["doc_atlas", "Atlas Cartagena - carta"]]),
    );
    expect(resolved).toEqual([
      { document_id: "doc_atlas", document_name: "Atlas Cartagena - carta" },
      { document_id: "doc_desconocido", document_name: "doc_desconocido" },
    ]);
  });

  it("[J] el polling se detiene sólo en estados terminales", () => {
    expect(shouldKeepPolling(undefined)).toBe(true);
    expect(shouldKeepPolling("RUNNING")).toBe(true);
    expect(shouldKeepPolling("WAITING")).toBe(true);
    expect(shouldKeepPolling("COMPLETED")).toBe(false);
    expect(shouldKeepPolling("FAILED")).toBe(false);
    expect(shouldKeepPolling("CANCELLED")).toBe(false);
  });
});

/** Microbloque 7.6 — presentación humana del resultado. */
describe("deriveConclusionText (resultado humano, no JSON)", () => {
  const structured = JSON.stringify({
    schema: "iusia.orchestration.v1",
    conclusion_brief: "Atlas sostiene que la terminación debía notificarse con 90 días de anticipación.",
    analysis_summary: "Resumen técnico más largo.",
    evidence: [{ ref_id: "doc_x#1", excerpt: "…noventa días…" }],
  });

  it("[A] usa conclusion_brief como titular cuando existe", () => {
    expect(deriveConclusionText(structured)).toBe(
      "Atlas sostiene que la terminación debía notificarse con 90 días de anticipación.",
    );
  });

  it("[B] el JSON estructurado NO es el contenido primario cuando hay conclusion_brief", () => {
    const out = deriveConclusionText(structured);
    expect(out).not.toContain("{");
    expect(out).not.toContain("iusia.orchestration.v1");
  });

  it("[A2] encuentra conclusion_brief aunque venga anidado (schema no estable)", () => {
    const nested = JSON.stringify({
      schema: "iusia.orchestration.v1",
      result: {
        conclusion_brief: "Atlas sostiene que el preaviso exigido para la terminación es de 90 días.",
        evidence_citations: [{ ref_id: "doc_x#1", quote: "…noventa días…" }],
      },
    });
    expect(deriveConclusionText(nested)).toBe(
      "Atlas sostiene que el preaviso exigido para la terminación es de 90 días.",
    );
  });

  it("[C] fallback al mejor campo humano si falta conclusion_brief", () => {
    const noBrief = JSON.stringify({ schema: "x", analysis_summary: "Conclusión alterna legible." });
    expect(deriveConclusionText(noBrief)).toBe("Conclusión alterna legible.");
  });

  it("[C2] si no es JSON, devuelve el texto humano tal cual", () => {
    expect(deriveConclusionText("Texto plano del agente.")).toBe("Texto plano del agente.");
  });

  it("[D] nunca produce [object Object], nunca lanza, nunca vacía un resultado válido", () => {
    const weird = JSON.stringify({ schema: "x", nested: { a: 1 } });
    const out = deriveConclusionText(weird);
    expect(out).not.toContain("[object Object]");
    expect(out.length).toBeGreaterThan(0);
    expect(deriveConclusionText("")).toBe("");
    expect(deriveConclusionText(null)).toBe("");
  });
});

/** Microbloque 7.6 — refresco del historial al estado terminal. */
describe("shouldRefreshHistory (refresh en transición terminal)", () => {
  it("[E] RUNNING → COMPLETED dispara el refresh", () => {
    expect(shouldRefreshHistory("RUNNING", "COMPLETED")).toBe(true);
  });

  it("[G] COMPLETED → COMPLETED no vuelve a disparar (sin bucle)", () => {
    expect(shouldRefreshHistory("COMPLETED", "COMPLETED")).toBe(false);
  });

  it("[H] RUNNING → FAILED también refresca; CANCELLED y BLOCKED igual", () => {
    expect(shouldRefreshHistory("RUNNING", "FAILED")).toBe(true);
    expect(shouldRefreshHistory("RUNNING", "CANCELLED")).toBe(true);
    expect(shouldRefreshHistory("WAITING", "BLOCKED")).toBe(true);
  });

  it("mientras siga en curso no refresca", () => {
    expect(shouldRefreshHistory(undefined, "RUNNING")).toBe(false);
    expect(shouldRefreshHistory("RUNNING", "WAITING")).toBe(false);
  });
});

/** Sprint 7.10 — el ruido operacional no debe llegar a la lectura jurídica. */
describe("RETRY_ROWS_GROUPED", () => {
  it("colapsa los reintentos en una sola etapa por especialista", () => {
    const executions: ExecutionView[] = [
      { id: "root", agentId: ORCHESTRATOR_AGENT_ID, status: "COMPLETED", createdAt: "2026-08-25T10:00:00.000Z" },
      { id: "e1", agentId: "04-analista-probatorio-y-pericial", status: "PENDING", createdAt: "2026-08-25T10:00:01.000Z" },
      { id: "e2", agentId: "04-analista-probatorio-y-pericial", status: "COMPLETED", createdAt: "2026-08-25T10:00:02.000Z" },
      { id: "e3", agentId: "03-investigador-normativo-jurisprudencial", status: "COMPLETED", createdAt: "2026-08-25T10:00:03.000Z" },
    ];
    const stages = deriveProgressStages({ rootStatus: "COMPLETED", events: [{ type: "execution.created" }], executions, rootExecutionId: "root" });
    const agentStages = stages.filter((s) => s.agentId);
    // Dos especialistas distintos, no tres filas.
    expect(agentStages).toHaveLength(2);
    expect(agentStages.filter((s) => s.agentId === "04-analista-probatorio-y-pericial")).toHaveLength(1);
    // Conserva el desenlace alcanzado, no el reintento huérfano.
    expect(agentStages[0]!.state).toBe("done");
  });

  it("groupExecutionsByAgent conserva el orden de primera aparición", () => {
    const rows: ExecutionView[] = [
      { id: "root", agentId: "x", status: "COMPLETED", createdAt: "2026-08-25T10:00:00.000Z" },
      { id: "a1", agentId: "a", status: "FAILED", createdAt: "2026-08-25T10:00:01.000Z" },
      { id: "b1", agentId: "b", status: "COMPLETED", createdAt: "2026-08-25T10:00:02.000Z" },
      { id: "a2", agentId: "a", status: "COMPLETED", createdAt: "2026-08-25T10:00:03.000Z" },
    ];
    const grouped = groupExecutionsByAgent(rows, "root");
    expect(grouped.map((r) => r.agentId)).toEqual(["a", "b"]);
    expect(grouped[0]!.status).toBe("COMPLETED");
  });
});

describe("INTERNAL_PROVENANCE_HIDDEN", () => {
  it("retira el encabezado de procedencia interna del texto entregado", () => {
    const raw = [
      "PRODUCED_BY: 00-orquestador-general-juridico",
      "AGENT_EXECUTION_ID: exe_2za8ycpk08xzn1e8",
      "SOURCE_INPUTS: contrato (doc_x), otrosí (doc_y)",
      "- executions/org/matter/exe_7vpgfehdv8yfkhrp.json (especialista-contractual)",
      "DATE: 2026-08-25T00:00:00Z",
      "STATUS: READY",
      "",
      "Atlas sostiene que el preaviso exigido es de 90 días.",
    ].join("\n");
    const out = stripInternalProvenance(raw);
    expect(out).toBe("Atlas sostiene que el preaviso exigido es de 90 días.");
    expect(out).not.toMatch(/exe_[a-z0-9]{8}/);
    expect(out).not.toContain("executions/");
  });

  it("no altera un texto que ya es puramente jurídico", () => {
    const clean = "Atlas sostiene que la terminación debía notificarse con 90 días.";
    expect(stripInternalProvenance(clean)).toBe(clean);
  });

  it("si el recorte dejara el texto vacío, conserva el original", () => {
    const onlyHeader = "PRODUCED_BY: 00\nSTATUS: READY";
    expect(stripInternalProvenance(onlyHeader)).toBe(onlyHeader);
  });
});

describe("deriveConstellation", () => {
  const names = new Map([
    ["03-investigador-normativo-jurisprudencial", "Investigación normativa"],
    ["04-analista-probatorio-y-pericial", "Análisis probatorio"],
  ]);

  it("[CN-1] un nodo por especialista, sin el orquestador ni la raíz", () => {
    const view = deriveConstellation({
      executions: [
        row({ id: ROOT, agentId: ORCHESTRATOR_AGENT_ID, status: "RUNNING" }),
        row({ id: "exe_00", agentId: ORCHESTRATOR_AGENT_ID, status: "COMPLETED" }),
        row({ id: "exe_03", agentId: "03-investigador-normativo-jurisprudencial", status: "RUNNING" }),
        row({ id: "exe_04", agentId: "04-analista-probatorio-y-pericial", status: "COMPLETED" }),
      ],
      events: [],
      rootExecutionId: ROOT,
      agentNames: names,
    });
    expect(view.nodes.map((n) => n.id).sort()).toEqual([
      "03-investigador-normativo-jurisprudencial",
      "04-analista-probatorio-y-pericial",
    ]);
    expect(view.nodes.find((n) => n.id.startsWith("03"))?.state).toBe("active");
    expect(view.nodes.find((n) => n.id.startsWith("04"))?.state).toBe("done");
    expect(view.nodes.find((n) => n.id.startsWith("03"))?.label).toBe("Investigación normativa");
  });

  it("[CN-2] los reintentos no duplican el nodo del especialista", () => {
    const view = deriveConstellation({
      executions: [
        row({ id: ROOT, agentId: ORCHESTRATOR_AGENT_ID, status: "RUNNING" }),
        row({ id: "exe_a", agentId: "04-analista-probatorio-y-pericial", status: "FAILED" }),
        row({ id: "exe_b", agentId: "04-analista-probatorio-y-pericial", status: "COMPLETED" }),
      ],
      events: [],
      rootExecutionId: ROOT,
      agentNames: names,
    });
    expect(view.nodes).toHaveLength(1);
    expect(view.nodes[0]!.state).toBe("done");
  });

  it("[CN-3] la dependencia declarada dibuja arista, y sólo la transferencia real la enciende", () => {
    const executions = [
      row({ id: ROOT, agentId: ORCHESTRATOR_AGENT_ID, status: "RUNNING" }),
      row({ id: "exe_04", agentId: "04-analista-probatorio-y-pericial", status: "COMPLETED" }),
      row({ id: "exe_03", agentId: "03-investigador-normativo-jurisprudencial", status: "RUNNING" }),
    ];
    const dispatched: GraphEventView = {
      type: "agent.dispatched",
      to_agent_id: "03-investigador-normativo-jurisprudencial",
      detail: { depends_on: "04-analista-probatorio-y-pericial" },
    };

    const declaredOnly = deriveConstellation({
      executions,
      events: [dispatched],
      rootExecutionId: ROOT,
      agentNames: names,
    });
    expect(declaredOnly.links).toEqual([
      {
        from: "04-analista-probatorio-y-pericial",
        to: "03-investigador-normativo-jurisprudencial",
        transferred: false,
      },
    ]);

    const withTransfer = deriveConstellation({
      executions,
      events: [
        dispatched,
        {
          type: "message.transferred",
          from_agent_id: "04-analista-probatorio-y-pericial",
          to_agent_id: "03-investigador-normativo-jurisprudencial",
        },
      ],
      rootExecutionId: ROOT,
      agentNames: names,
    });
    expect(withTransfer.links[0]!.transferred).toBe(true);
  });

  it("[CN-4] ignora aristas hacia agentes que no se ejecutaron: no inventa equipo", () => {
    const view = deriveConstellation({
      executions: [
        row({ id: ROOT, agentId: ORCHESTRATOR_AGENT_ID, status: "RUNNING" }),
        row({ id: "exe_03", agentId: "03-investigador-normativo-jurisprudencial", status: "RUNNING" }),
      ],
      events: [
        {
          type: "agent.dispatched",
          to_agent_id: "03-investigador-normativo-jurisprudencial",
          detail: { depends_on: "99-agente-inexistente" },
        },
      ],
      rootExecutionId: ROOT,
      agentNames: names,
    });
    expect(view.links).toHaveLength(0);
  });

  it("[CN-5] sin especialistas todavía, la constelación va vacía (núcleo pensando)", () => {
    const view = deriveConstellation({
      executions: [row({ id: ROOT, agentId: ORCHESTRATOR_AGENT_ID, status: "RUNNING" })],
      events: [],
      rootExecutionId: ROOT,
      agentNames: names,
    });
    expect(view.nodes).toHaveLength(0);
    expect(view.integrating).toBe(false);
  });

  it("[CN-6] la fase de integración marca la convergencia", () => {
    const view = deriveConstellation({
      executions: [row({ id: ROOT, agentId: ORCHESTRATOR_AGENT_ID, status: "RUNNING" })],
      events: [{ type: "agent.started", detail: { phase: "integrate" } }],
      rootExecutionId: ROOT,
      agentNames: names,
    });
    expect(view.integrating).toBe(true);
  });
});

describe("BACKGROUND_ANALYSIS_INDICATOR", () => {
  const a = { root_execution_id: "exe_a", matter_id: "mtr_1", matter_title: "Delta vs Atlas" };
  const b = { root_execution_id: "exe_b", matter_id: "mtr_2", matter_title: "Otro" };

  it("[BG-1] el análisis que desaparece de los activos se considera terminado", () => {
    expect(diffFinishedAnalyses([a, b], [b])).toEqual([a]);
  });

  it("[BG-2] mientras siga activo no avisa", () => {
    expect(diffFinishedAnalyses([a], [a])).toEqual([]);
  });

  it("[BG-3] el primer sondeo tras cargar la app no anuncia trabajo anterior", () => {
    expect(diffFinishedAnalyses([], [])).toEqual([]);
    expect(diffFinishedAnalyses([], [a])).toEqual([]);
  });

  it("[BG-4] varios cierres simultáneos se avisan todos", () => {
    expect(diffFinishedAnalyses([a, b], []).map((x) => x.root_execution_id)).toEqual([
      "exe_a",
      "exe_b",
    ]);
  });
});

describe("INTERNAL_PROVENANCE_HIDDEN — referencias intercaladas", () => {
  const names = new Map([["04-analista-probatorio-y-pericial", "Análisis Probatorio y Pericial"]]);

  it("[SAN-1] retira la referencia a la ruta de ejecución que el integrador intercala", () => {
    const text =
      '- 04-analista-probatorio-y-pericial (EVIDENTIARY): "No consta en el expediente." (ref=executions/org/exe_kppb6bjskbgy9k2g.json)';
    const out = sanitizeLegalOutput(text, names);
    expect(out).not.toMatch(/exe_[a-z0-9]{8,}/);
    expect(out).not.toContain("executions/");
    expect(out).not.toContain(".json");
    // La autoría del hallazgo es información jurídica: se conserva, con nombre humano.
    expect(out).toContain("Análisis Probatorio y Pericial");
    expect(out).toContain("No consta en el expediente.");
  });

  it("[SAN-2] elimina identificadores de ejecución y de flujo sueltos", () => {
    const out = sanitizeLegalOutput("Ver exe_abcd1234efgh y wf_zzzz9999yyyy para el detalle.");
    expect(out).not.toMatch(/exe_|wf_/);
  });

  it("[SAN-3] no toca un dictamen limpio", () => {
    const clean =
      "Plazo de preaviso: 90 días.\nCita: “la terminación debía notificarse con noventa días”.";
    expect(sanitizeLegalOutput(clean, names)).toBe(clean);
  });

  it("[SAN-4] si la limpieza vaciara el texto, devuelve el original", () => {
    const onlyRefs = "executions/org/exe_aaaabbbbcccc.json";
    expect(sanitizeLegalOutput(onlyRefs)).toBe(onlyRefs);
  });

  it("[SAN-5] conserva las citas del expediente, que sí son evidencia", () => {
    const t = "Fuente: Atlas Cartagena - carta terminacion, chunk 1.";
    expect(sanitizeLegalOutput(t)).toContain("Atlas Cartagena - carta terminacion");
  });
});

describe("deriveConclusionText — schema inestable de los agentes", () => {
  it("[CT-1] reconoce two_line_summary anidado bajo output", () => {
    const raw = JSON.stringify({
      schema: "iusia.orchestration.v1",
      matter_id: "mtr_x",
      output: { two_line_summary: "El preaviso sostenido es de 90 días." },
      citations: [{ ref_id: "doc_a#1" }],
    });
    expect(deriveConclusionText(raw)).toBe("El preaviso sostenido es de 90 días.");
  });

  it("[CT-2] reconoce executive_summary", () => {
    const raw = JSON.stringify({ output: { executive_summary: "Procede la acción." } });
    expect(deriveConclusionText(raw)).toBe("Procede la acción.");
  });

  it("[CT-3] conclusion_brief sigue teniendo prioridad sobre los demás", () => {
    const raw = JSON.stringify({
      output: { two_line_summary: "resumen corto", conclusion_brief: "dictamen" },
    });
    expect(deriveConclusionText(raw)).toBe("dictamen");
  });

  it("[CT-4] sin campo humano reconocible devuelve el crudo, nunca [object Object]", () => {
    const raw = JSON.stringify({ output: { rows: [1, 2, 3] } });
    const out = deriveConclusionText(raw);
    expect(out).not.toContain("[object Object]");
    expect(out).toBe(raw);
  });
});

describe("sanitizeLegalOutput — documentos por su nombre", () => {
  const docs = new Map([["doc_pp3mtb3a8q4z74cj", "Carta de terminación"]]);

  it("[SAN-6] sustituye el id del documento y conserva el fragmento citado", () => {
    const out = sanitizeLegalOutput("Consta en (doc_pp3mtb3a8q4z74cj#1).", new Map(), docs);
    expect(out).toContain("Carta de terminación (fragmento 1)");
    expect(out).not.toContain("doc_pp3mtb");
  });

  it("[SAN-7] un documento sin nombre conocido se deja intacto, no se inventa", () => {
    const out = sanitizeLegalOutput("Ver doc_desconocido#2.", new Map(), docs);
    expect(out).toContain("doc_desconocido#2");
  });
});

describe("sanitizeLegalOutput — coste acotado", () => {
  it("[SAN-8] no se degrada con un texto largo y un paréntesis sin cerrar", () => {
    // El patrón anterior encadenaba cuantificadores y colgaba la petición del
    // resultado con entradas de esta forma. Debe resolverse de inmediato.
    const hostile = "(ref=" + "a".repeat(20000);
    const started = Date.now();
    const out = sanitizeLegalOutput(hostile);
    expect(Date.now() - started).toBeLessThan(300);
    expect(out.length).toBeGreaterThan(0);
  });

  it("[SAN-9] respeta un paréntesis que no es una referencia interna", () => {
    const t = "El plazo (ref=norma 1234 del estatuto) es de 90 días.";
    expect(sanitizeLegalOutput(t)).toContain("ref=norma 1234 del estatuto");
  });
});

describe("deriveProgressStages — cierre según el desenlace", () => {
  const base = { events: [{ type: "execution.created" }], executions: [], rootExecutionId: ROOT };

  it("[PS-1] una orquestación detenida no se cierra como completada", () => {
    const stages = deriveProgressStages({ ...base, rootStatus: "CANCELLED" });
    expect(stages.at(-1)!.key).toBe("stopped");
  });

  it("[PS-2] una orquestación fallida se cierra como fallida", () => {
    expect(deriveProgressStages({ ...base, rootStatus: "FAILED" }).at(-1)!.key).toBe("failed");
    expect(deriveProgressStages({ ...base, rootStatus: "BLOCKED" }).at(-1)!.key).toBe("failed");
  });

  it("[PS-3] con la raíz terminada ninguna etapa queda 'en curso'", () => {
    const stages = deriveProgressStages({
      rootStatus: "CANCELLED",
      events: [{ type: "execution.created" }],
      executions: [
        row({ id: ROOT, agentId: ORCHESTRATOR_AGENT_ID, status: "CANCELLED" }),
        row({ id: "exe_01", agentId: "01-intake-y-clasificador", status: "RUNNING" }),
      ],
      rootExecutionId: ROOT,
    });
    expect(stages.some((s) => s.state === "active")).toBe(false);
  });

  it("[PS-4] mientras corre, el cierre sigue pendiente y se llama 'done'", () => {
    const stages = deriveProgressStages({ ...base, rootStatus: "RUNNING" });
    expect(stages.at(-1)).toMatchObject({ key: "done", state: "pending" });
  });
});
