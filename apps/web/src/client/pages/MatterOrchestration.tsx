import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  CardHeader,
  StateBlock,
  StatusChip,
  Skeleton,
  Textarea,
} from "@iusia/ui";
import {
  deriveProgressStages,
  shouldKeepPolling,
  type ProgressStage,
  type StageState,
} from "@iusia/domain";
import { api, ApiError, type ExecutionResult, type MatterDetail } from "../api.js";
import { StrategyRoom } from "./StrategyRoom.js";

/**
 * Análisis con IUSIA — experiencia de producto de la orquestación.
 *
 * El abogado expresa QUÉ necesita, IUSIA orquesta, y aquí ve el PROGRESO en
 * lenguaje de negocio y el RESULTADO fundamentado. Los agentes son un equipo, no
 * interruptores. El grafo del motor, los eventos crudos y la trazabilidad técnica
 * quedan detrás de "Ver actividad de IUSIA": presentes, pero secundarios.
 */

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED", "BLOCKED"]);

/** Copy de producto por etapa. Traduce nodos del motor a fases del encargo. */
const STAGE_LABEL: Record<string, string> = {
  received: "Encargo recibido",
  evidence: "Evidencia del expediente recuperada",
  done: "Análisis completado",
};
const AGENT_STAGE_LABEL: Record<string, string> = {
  "pisoso-orquestador-juridico": "Encuadre y conclusión",
  "01-intake-y-clasificador": "Análisis del expediente",
  "03-investigador-normativo-jurisprudencial": "Investigación normativa y jurisprudencial",
};

function stageLabel(stage: ProgressStage, agentNames: Map<string, string>): string {
  if (stage.agentId) {
    return AGENT_STAGE_LABEL[stage.agentId] ?? agentNames.get(stage.agentId) ?? stage.agentId;
  }
  return STAGE_LABEL[stage.key] ?? stage.key;
}

const DOT: Record<StageState, string> = {
  done: "bg-iusia-success",
  active: "bg-iusia-intel",
  failed: "bg-iusia-critical",
  pending: "bg-iusia-mist",
};

export function MatterOrchestration({
  matterId,
  data,
}: {
  matterId: string;
  data: MatterDetail;
}) {
  const queryClient = useQueryClient();

  // Raíces de grafo = ejecuciones sin padre, ordenadas de más reciente a más antigua.
  const roots = useMemo(
    () =>
      data.executions
        .filter((e) => e.parentExecutionId === null)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [data.executions],
  );

  const [selectedRoot, setSelectedRoot] = useState<string | null>(roots[0]?.rootExecutionId ?? null);
  const [objective, setObjective] = useState(data.matter.objective ?? "");

  // Si aparece una raíz nueva y aún no hay selección, la adoptamos.
  useEffect(() => {
    if (!selectedRoot && roots[0]) setSelectedRoot(roots[0].rootExecutionId);
  }, [roots, selectedRoot]);

  const start = useMutation({
    mutationFn: () => api.startOrchestration(matterId, objective.trim()),
    onSuccess: (res) => {
      setSelectedRoot(res.root_execution_id);
      void queryClient.invalidateQueries({ queryKey: ["matter", matterId] });
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <StartCard
        objective={objective}
        setObjective={setObjective}
        onStart={() => start.mutate()}
        pending={start.isPending}
        error={start.error}
        hasRuns={roots.length > 0}
      />

      {selectedRoot ? (
        <RunView key={selectedRoot} rootExecutionId={selectedRoot} matterDocuments={data.documents} />
      ) : (
        <Card>
          <CardHeader title="Análisis de IUSIA" />
          <StateBlock
            kind="empty"
            title="Aún no has iniciado un análisis"
            hint="Describe el objetivo del encargo y deja que IUSIA orqueste al equipo."
          />
        </Card>
      )}

      {roots.length > 1 ? (
        <Card>
          <CardHeader title="Análisis anteriores" subtitle="Historial de este expediente" />
          <ul className="divide-y divide-iusia-mist/20">
            {roots.map((r) => {
              const selected = r.rootExecutionId === selectedRoot;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedRoot(r.rootExecutionId)}
                    className={
                      "flex w-full items-center justify-between px-6 py-3 text-left text-[14px] transition-colors hover:bg-iusia-mist/5" +
                      (selected ? " bg-iusia-action/5" : "")
                    }
                  >
                    <time className="text-iusia-carbon tnum">
                      {new Date(r.createdAt).toLocaleString("es-CO")}
                    </time>
                    <OutcomeChip status={r.status} />
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function StartCard({
  objective,
  setObjective,
  onStart,
  pending,
  error,
  hasRuns,
}: {
  objective: string;
  setObjective: (v: string) => void;
  onStart: () => void;
  pending: boolean;
  error: unknown;
  hasRuns: boolean;
}) {
  const insufficient = error instanceof ApiError && error.code === "INSUFFICIENT_CREDITS";
  return (
    <Card>
      <CardHeader
        title="Iniciar análisis con IUSIA"
        subtitle="Describe qué necesitas; IUSIA activa al equipo adecuado y trabaja sobre el expediente."
      />
      <div className="px-6 py-5">
        <Textarea
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          rows={3}
          aria-label="Objetivo del encargo"
          placeholder="Ej.: Analiza el documento del expediente y determina qué plazo de preaviso sostiene la contraparte, citando la evidencia."
        />
        {insufficient ? (
          <div className="mt-2 rounded-[10px] border border-iusia-gold/40 bg-iusia-gold/10 px-4 py-2.5 text-[13.5px] text-iusia-gold-text">
            No hay créditos suficientes para iniciar el análisis. Contacta con la administración del despacho.
          </div>
        ) : error ? (
          <p role="alert" className="mt-2 text-[13.5px] text-iusia-critical">
            {error instanceof ApiError ? error.message : "No fue posible iniciar el análisis."}
          </p>
        ) : null}
        <div className="mt-3">
          <Button onClick={onStart} disabled={pending || objective.trim().length < 10}>
            {pending ? "Iniciando…" : hasRuns ? "Iniciar nuevo análisis" : "Iniciar análisis con IUSIA"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function RunView({
  rootExecutionId,
  matterDocuments,
}: {
  rootExecutionId: string;
  matterDocuments: MatterDetail["documents"];
}) {
  const [showTrace, setShowTrace] = useState(false);

  const eventsQuery = useQuery({
    queryKey: ["execution-events", rootExecutionId],
    queryFn: () => api.executionEvents(rootExecutionId),
    refetchInterval: (q) => {
      const rows = q.state.data?.executions ?? [];
      const root = rows.find((e) => e.id === rootExecutionId);
      return shouldKeepPolling(root?.status) ? 2000 : false;
    },
  });

  const agentsQuery = useQuery({ queryKey: ["agents"], queryFn: api.agents });
  const agentNames = useMemo(
    () => new Map((agentsQuery.data?.agents ?? []).map((a) => [a.agent_id, a.name])),
    [agentsQuery.data],
  );

  const rootStatus =
    eventsQuery.data?.executions.find((e) => e.id === rootExecutionId)?.status ?? "RUNNING";
  const isTerminal = TERMINAL.has(rootStatus);

  const resultQuery = useQuery({
    queryKey: ["execution-result", rootExecutionId],
    queryFn: () => api.executionResult(rootExecutionId),
    enabled: isTerminal,
  });

  const stages = useMemo(() => {
    if (!eventsQuery.data) return [] as ProgressStage[];
    return deriveProgressStages({
      rootStatus,
      events: eventsQuery.data.events,
      executions: eventsQuery.data.executions,
      rootExecutionId,
    });
  }, [eventsQuery.data, rootStatus, rootExecutionId]);

  const gatePassed = (eventsQuery.data?.events ?? []).some((e) => e.type === "gate.passed");

  if (eventsQuery.isLoading) {
    return (
      <Card>
        <div className="p-6">
          <Skeleton className="h-40" />
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title="Progreso del análisis"
          subtitle="IUSIA trabaja sobre el expediente en fases"
          action={<OutcomeChip status={rootStatus} />}
        />
        <div className="px-6 py-5">
          <ol className="flex flex-col gap-3">
            {stages.map((s) => (
              <li key={s.key} className="flex items-center gap-3">
                <span
                  className={
                    "h-2.5 w-2.5 shrink-0 rounded-full " +
                    DOT[s.state] +
                    (s.state === "active" ? " animate-pulse" : "")
                  }
                />
                <span
                  className={
                    "text-[14px] " +
                    (s.state === "pending" ? "text-iusia-mist-text" : "text-iusia-carbon") +
                    (s.state === "done" ? " font-medium" : "")
                  }
                >
                  {stageLabel(s, agentNames)}
                </span>
                {s.state === "failed" ? <StatusChip label="Falló" tone="critical" /> : null}
              </li>
            ))}
          </ol>
          {gatePassed ? (
            <p className="mt-4 text-[13px] text-iusia-success-text">
              ✓ Validación completada — IUSIA verificó que el análisis puede avanzar.
            </p>
          ) : null}
        </div>
      </Card>

      {isTerminal ? (
        <ResultView query={resultQuery} matterDocuments={matterDocuments} />
      ) : null}

      <div>
        <button
          type="button"
          onClick={() => setShowTrace((v) => !v)}
          className="text-[13.5px] font-medium text-iusia-action hover:underline"
          aria-expanded={showTrace}
        >
          {showTrace ? "Ocultar actividad de IUSIA" : "Ver actividad de IUSIA (trazabilidad técnica)"}
        </button>
        {showTrace ? (
          <div className="mt-4">
            <StrategyRoom rootExecutionId={rootExecutionId} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ResultView({
  query,
  matterDocuments,
}: {
  query: { data?: ExecutionResult; isLoading: boolean; error: unknown };
  matterDocuments: MatterDetail["documents"];
}) {
  if (query.isLoading) {
    return (
      <Card>
        <div className="p-6">
          <Skeleton className="h-24" />
        </div>
      </Card>
    );
  }
  const result = query.data;
  if (!result) {
    return (
      <Card>
        <StateBlock
          kind="error"
          title="Resultado no disponible"
          hint={query.error instanceof ApiError ? query.error.message : "No fue posible cargar el resultado."}
        />
      </Card>
    );
  }

  if (result.outcome === "FAILED" || result.outcome === "CANCELLED") {
    return (
      <Card>
        <CardHeader title="Resultado del análisis" action={<OutcomeChip status={result.status} />} />
        <StateBlock
          kind="error"
          title={result.outcome === "CANCELLED" ? "Análisis cancelado" : "El análisis no pudo completarse"}
          hint="Revisa la actividad de IUSIA para ver en qué fase se detuvo, o inicia un nuevo análisis."
        />
      </Card>
    );
  }

  if (result.outcome === "INSUFFICIENT_EVIDENCE") {
    return (
      <Card>
        <CardHeader title="Resultado del análisis" />
        <StateBlock
          kind="not_configured"
          title="Sin evidencia suficiente en el expediente"
          hint="IUSIA no recuperó documentos indexados para fundamentar una conclusión. Vincula o sincroniza documentos y vuelve a intentarlo."
        />
      </Card>
    );
  }

  const headline = result.outputs.find((o) => o.node_code === "00") ?? result.outputs[0];
  const specialists = result.outputs.filter((o) => o !== headline);

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title="Conclusión de IUSIA"
          subtitle={headline ? `${headline.agent_name}` : undefined}
          action={<StatusChip label="Fundamentado en el expediente" tone="success" dot />}
        />
        <div className="px-6 py-5">
          {headline ? (
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-iusia-carbon">
              {headline.text}
            </p>
          ) : (
            <StateBlock kind="empty" title="Sin salida integrada" />
          )}
        </div>
      </Card>

      {result.evidence.documents.length > 0 ? (
        <Card>
          <CardHeader
            title="Evidencia del expediente"
            subtitle={`${result.evidence.chunk_count} fragmento(s) recuperados y citados`}
          />
          <ul className="divide-y divide-iusia-mist/20">
            {result.evidence.documents.map((d) => {
              const doc = matterDocuments.find((m) => m.id === d.document_id);
              return (
                <li key={d.document_id} className="flex items-center justify-between px-6 py-3">
                  <span className="text-[14.5px] text-iusia-carbon">{d.document_name}</span>
                  {doc ? <StatusChip label={doc.classification} tone="neutral" /> : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {specialists.length > 0 ? (
        <details className="rounded-[12px] border border-iusia-mist/25 bg-white">
          <summary className="cursor-pointer px-6 py-4 text-[14px] font-medium text-iusia-navy">
            Detalle por especialista ({specialists.length})
          </summary>
          <div className="flex flex-col gap-4 px-6 pb-5">
            {specialists.map((o) => (
              <div key={o.execution_id}>
                <p className="mb-1 text-[13px] font-semibold text-iusia-navy">{o.agent_name}</p>
                <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-iusia-carbon">
                  {o.text}
                </p>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function OutcomeChip({ status }: { status: string }) {
  if (status === "COMPLETED") return <StatusChip label="Completado" tone="success" dot />;
  if (status === "FAILED") return <StatusChip label="Con incidencias" tone="critical" dot />;
  if (status === "CANCELLED") return <StatusChip label="Cancelado" tone="neutral" />;
  if (status === "BLOCKED") return <StatusChip label="En validación" tone="warning" dot />;
  return <StatusChip label="En curso" tone="info" dot />;
}
