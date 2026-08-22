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
import { motion, useReducedMotion } from "motion/react";
import { Card, CardHeader, StateBlock, EXECUTION_STATUS_PRESENTATION } from "@iusia/ui";
import type { ExecutionStatus } from "@iusia/domain";
import { api } from "../api.js";

/**
 * Strategy Room — identidad visual propia.
 *
 * REGLA DE VERDAD VISUAL (Blueprint §06, Design System §05): cada nodo es una
 * ejecución real (execution_id) y cada arista un evento del Execution Ledger.
 * No se genera movimiento, partículas ni estados que no provengan del backend.
 */
export function StrategyRoom({ rootExecutionId }: { rootExecutionId: string }) {
  const reduce = useReducedMotion();
  const query = useQuery({
    queryKey: ["execution-events", rootExecutionId],
    queryFn: () => api.executionEvents(rootExecutionId),
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return 2000;
      const root = data.executions.find((e) => e.id === rootExecutionId);
      return root && ["COMPLETED", "FAILED", "CANCELLED"].includes(root.status) ? false : 2000;
    },
  });

  const { nodes, edges } = useMemo(() => {
    const graph = query.data?.graph;
    if (!graph) return { nodes: [] as Node[], edges: [] as Edge[] };
    const execById = new Map(query.data?.executions.map((e) => [e.id, e]) ?? []);

    const flowNodes: Node[] = graph.nodes.map((n, i) => {
      const status = n.status as ExecutionStatus;
      const p = EXECUTION_STATUS_PRESENTATION[status];
      const exec = execById.get(n.execution_id);
      const active = status === "RUNNING" || status === "WAITING";
      return {
        id: n.agent_id,
        position: { x: 40 + i * 250, y: 70 + (i % 2) * 110 },
        data: {
          label: (
            <div className="min-w-[188px] text-left">
              <div className="flex items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: p.color, boxShadow: active ? `0 0 0 3px ${p.color}22` : undefined }}
                />
                <span className="truncate text-[13px] font-semibold text-iusia-navy">
                  {shortName(n.agent_id)}
                </span>
              </div>
              <p className="mt-1 text-[11.5px]" style={{ color: p.color }}>
                {p.label}
              </p>
              <p className="mt-1 text-[10.5px] text-iusia-mist">
                {exec?.model ?? "—"}
                {exec?.creditsConsumed ? ` · ${exec.creditsConsumed} cr` : ""}
              </p>
            </div>
          ),
        },
        style: {
          background: "#FFFFFF",
          border: `1.5px solid ${p.color}`,
          borderRadius: 12,
          padding: 11,
          boxShadow: active ? `0 4px 18px -6px ${p.color}55` : "0 1px 2px rgba(11,29,58,0.06)",
        },
      };
    });

    // El estado vivo del nodo destino decide si su arista se anima: un pulso sólo
    // representa trabajo en curso, nunca decoración tras completar (criterio Emil).
    const statusByAgent = new Map(graph.nodes.map((n) => [n.agent_id, n.status]));
    const edgeMap = new Map<string, Edge>();
    for (const e of graph.edges) {
      const key = `${e.from_agent_id}->${e.to_agent_id}`;
      const targetStatus = statusByAgent.get(e.to_agent_id);
      const live = targetStatus === "RUNNING" || targetStatus === "WAITING";
      edgeMap.set(key, {
        id: key,
        source: e.from_agent_id,
        target: e.to_agent_id,
        label: e.event_type,
        animated: live && e.event_type === "work_package.sent",
        style: { stroke: "#22C7E8", strokeWidth: 1.5 },
        labelStyle: { fontSize: 10.5, fill: "#0c7d95" },
        labelBgStyle: { fill: "#EAF9FC" },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#22C7E8" },
      });
    }
    return { nodes: flowNodes, edges: [...edgeMap.values()] };
  }, [query.data]);

  const events = query.data?.events ?? [];
  const rootExec = query.data?.executions.find((e) => e.id === rootExecutionId);
  const running = rootExec && !["COMPLETED", "FAILED", "CANCELLED"].includes(rootExec.status);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <Card className="overflow-hidden lg:col-span-2">
        <CardHeader
          title="Strategy Room"
          subtitle="Cada nodo y cada pulso corresponden a un evento real"
          action={
            <span className="flex items-center gap-2 text-[12.5px] text-iusia-mist">
              {running ? (
                <motion.span
                  className="h-2 w-2 rounded-full bg-iusia-intel"
                  animate={reduce ? {} : { opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                />
              ) : null}
              {nodes.length} ejec · {edges.length} transf
            </span>
          }
        />
        <div className="h-[440px] bg-[linear-gradient(180deg,#FBFCFE,#F4F6FA)]">
          {nodes.length === 0 ? (
            <StateBlock
              kind={running ? "loading" : "empty"}
              title={running ? "Esperando primeros eventos…" : "Sin eventos todavía"}
              hint="El grafo aparece cuando el Workflow registra la primera ejecución."
            />
          ) : (
            <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}>
              <Background color="#C7CDD6" gap={22} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Execution Ledger" subtitle="Eventos en orden" />
        <div className="max-h-[440px] overflow-y-auto">
          {events.length === 0 ? (
            <StateBlock kind="empty" title="Sin eventos" />
          ) : (
            <ul className="divide-y divide-iusia-mist/15">
              {[...events].reverse().map((e) => (
                <li key={e.event_id} className="px-5 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[11.5px] text-iusia-carbon">{e.type}</span>
                    <span className="text-[10.5px] tabular-nums text-iusia-mist">#{e.sequence}</span>
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-iusia-mist">
                    {e.from_agent_id ? `${shortName(e.from_agent_id)} → ` : ""}
                    {e.to_agent_id ? shortName(e.to_agent_id) : "orquestación"}
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

/** Nombre corto del agente para los nodos (los ids canónicos son largos). */
function shortName(agentId: string): string {
  if (agentId === "pisoso-orquestador-juridico") return "00 Managing Partner";
  const m = agentId.match(/^(\d{2})-(.+)$/);
  if (m) return `${m[1]} ${m[2]!.replaceAll("-", " ")}`.slice(0, 28);
  return agentId.replaceAll("-", " ").slice(0, 28);
}
