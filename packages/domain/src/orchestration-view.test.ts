import { describe, expect, it } from "vitest";
import {
  deriveOutcome,
  deriveProgressStages,
  ORCHESTRATOR_AGENT_ID,
  resolveEvidenceDocuments,
  selectIntegratorExecution,
  shouldKeepPolling,
  type EventView,
  type ExecutionView,
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
  it("[E] COMPLETED sin evidencia => INSUFFICIENT_EVIDENCE", () => {
    expect(deriveOutcome({ rootStatus: "COMPLETED", evidenceChunkCount: 0 })).toBe(
      "INSUFFICIENT_EVIDENCE",
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
