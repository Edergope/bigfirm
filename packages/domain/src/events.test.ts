import { describe, expect, it } from "vitest";
import {
  assertDetailIsSafe,
  projectStrategyGraph,
  type ExecutionEvent,
} from "./events.js";

const MATTER = "mtr_aaaaaaaaaaaaaaaaaaaaaaaa";
const ROOT = "exe_aaaaaaaaaaaaaaaaaaaaaaaa";

function event(partial: Partial<ExecutionEvent> & Pick<ExecutionEvent, "type" | "sequence">) {
  return {
    event_id: `evt_${partial.sequence}`,
    matter_id: MATTER,
    root_execution_id: ROOT,
    execution_id: ROOT,
    from_agent_id: null,
    to_agent_id: null,
    status: null,
    detail: {},
    occurred_at: new Date(2026, 0, 1, 0, 0, partial.sequence).toISOString(),
    ...partial,
  } as ExecutionEvent;
}

describe("proyección del grafo de la Strategy Room", () => {
  it("no produce nodos ni aristas sin eventos", () => {
    expect(projectStrategyGraph([])).toEqual({ nodes: [], edges: [] });
  });

  it("deriva una arista sólo de eventos de transferencia real", () => {
    const graph = projectStrategyGraph([
      event({ type: "agent.started", sequence: 0, to_agent_id: "01", status: "RUNNING" }),
      // agent.progress no es una transferencia: no debe pintar una arista.
      event({ type: "agent.progress", sequence: 1, from_agent_id: "01", to_agent_id: "03" }),
      event({
        type: "work_package.sent",
        sequence: 2,
        from_agent_id: "01",
        to_agent_id: "03",
      }),
    ]);

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ from_agent_id: "01", to_agent_id: "03" });
  });

  it("refleja el último estado conocido de cada ejecución", () => {
    const graph = projectStrategyGraph([
      event({ type: "agent.started", sequence: 0, to_agent_id: "01", status: "RUNNING" }),
      event({ type: "agent.completed", sequence: 1, to_agent_id: "01", status: "COMPLETED" }),
    ]);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]?.status).toBe("COMPLETED");
    expect(graph.nodes[0]?.last_event).toBe("agent.completed");
  });

  it("ordena por secuencia aunque los eventos lleguen desordenados", () => {
    const graph = projectStrategyGraph([
      event({ type: "agent.completed", sequence: 1, to_agent_id: "01", status: "COMPLETED" }),
      event({ type: "agent.started", sequence: 0, to_agent_id: "01", status: "RUNNING" }),
    ]);
    expect(graph.nodes[0]?.status).toBe("COMPLETED");
  });
});

describe("guarda de confidencialidad de los eventos", () => {
  it("rechaza publicar contenido confidencial en el detalle", () => {
    for (const key of ["prompt", "document_content", "reasoning", "api_key"]) {
      expect(() => assertDetailIsSafe({ [key]: "x" })).toThrow();
    }
  });

  it("acepta metadata operativa", () => {
    expect(() =>
      assertDetailIsSafe({ agent_id: "01", credits: 12, gate: "FOUNDATION_GATE" }),
    ).not.toThrow();
  });
});
