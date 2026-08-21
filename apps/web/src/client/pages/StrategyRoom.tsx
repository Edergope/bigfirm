import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Card, CardHeader, EmptyState, EXECUTION_STATUS_PRESENTATION } from "@iusia/ui";
import type { ExecutionStatus } from "@iusia/domain";
import { api } from "../api.js";

/**
 * Strategy Room.
 *
 * REGLA DE VERDAD VISUAL (Blueprint §06, Design System §05):
 * cada nodo es una ejecución real identificada por execution_id y cada arista es
 * un evento registrado en el Execution Ledger. Esta vista no genera movimiento,
 * partículas ni estados que no provengan del backend. Si no hay evento, no se pinta.
 */
export function StrategyRoom({ rootExecutionId }: { rootExecutionId: string }) {
  const query = useQuery({
    queryKey: ["execution-events", rootExecutionId],
    queryFn: () => api.executionEvents(rootExecutionId),
    // Polling: el DAG durable avanza en el servidor. El intervalo se detiene solo
    // cuando la ejecución raíz llega a un estado terminal.
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return 2000;
      const root = data.executions.find((e) => e.id === rootExecutionId);
      const terminal = ["COMPLETED", "FAILED", "CANCELLED"];
      return root && terminal.includes(root.status) ? false : 2000;
    },
  });

  const { nodes, edges } = useMemo(() => {
    const graph = query.data?.graph;
    if (!graph) return { nodes: [] as Node[], edges: [] as Edge[] };

    const executionsById = new Map(query.data?.executions.map((e) => [e.id, e]) ?? []);

    const flowNodes: Node[] = graph.nodes.map((n, index) => {
      const status = n.status as ExecutionStatus;
      const presentation = EXECUTION_STATUS_PRESENTATION[status];
      const execution = executionsById.get(n.execution_id);
      return {
        id: n.agent_id,
        position: { x: 60 + index * 260, y: 80 + (index % 2) * 90 },
        data: {
          label: (
            <div className="min-w-[190px] text-left">
              <p className="text-[14px] font-semibold text-iusia-navy">{n.agent_id}</p>
              <p className="mt-0.5 text-[12px]" style={{ color: presentation.color }}>
                {presentation.label}
              </p>
              <p className="mt-1 text-[11px] text-iusia-mist">
                {execution?.model ?? "—"}
                {execution?.creditsConsumed ? ` · ${execution.creditsConsumed} cr` : ""}
              </p>
              <p className="mt-1 text-[11px] text-iusia-mist">último: {n.last_event}</p>
            </div>
          ),
        },
        style: {
          background: "#FFFFFF",
          border: `1.5px solid ${presentation.color}`,
          borderRadius: 14,
          padding: 12,
        },
      };
    });

    // Se colapsan aristas repetidas conservando el evento más reciente.
    const edgeMap = new Map<string, Edge>();
    for (const e of graph.edges) {
      edgeMap.set(`${e.from_agent_id}->${e.to_agent_id}`, {
        id: `${e.from_agent_id}->${e.to_agent_id}`,
        source: e.from_agent_id,
        target: e.to_agent_id,
        label: e.event_type,
        animated: false,
        style: { stroke: "#22C7E8", strokeWidth: 1.5 },
        labelStyle: { fontSize: 11, fill: "#0e7f96" },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#22C7E8" },
      });
    }

    return { nodes: flowNodes, edges: [...edgeMap.values()] };
  }, [query.data]);

  const events = query.data?.events ?? [];

  return (
    <div className="grid grid-cols-3 gap-5">
      <Card className="col-span-2 overflow-hidden">
        <CardHeader
          title="Strategy Room"
          action={
            <span className="text-[13px] text-iusia-mist">
              {nodes.length} ejecuciones · {edges.length} transferencias
            </span>
          }
        />
        <div className="h-[420px] bg-iusia-surface">
          {nodes.length === 0 ? (
            <EmptyState
              title="Sin eventos todavía"
              hint="El grafo aparece cuando el Workflow registra la primera ejecución."
            />
          ) : (
            <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: false }}>
              <Background color="#A7ADB5" gap={20} />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Eventos del Execution Ledger" />
        <div className="max-h-[420px] overflow-y-auto">
          {events.length === 0 ? (
            <EmptyState title="Sin eventos" />
          ) : (
            <ul className="divide-y divide-iusia-mist/20">
              {[...events].reverse().map((e) => (
                <li key={e.event_id} className="px-5 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[12px] text-iusia-carbon">{e.type}</span>
                    <span className="text-[11px] tabular-nums text-iusia-mist">#{e.sequence}</span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-iusia-mist">
                    {e.from_agent_id ? `${e.from_agent_id} → ` : ""}
                    {e.to_agent_id ?? e.execution_id}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
