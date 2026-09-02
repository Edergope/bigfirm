import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, FileText, Users } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  Module,
  StateBlock,
  StatusChip,
  Skeleton,
  Textarea,
} from "@iusia/ui";
import {
  deriveProgressStages,
  humanizeAgentId,
  convocationReadiness,
  groundingNotice,
  shouldKeepPolling,
  shouldRefreshHistory,
  type ProgressStage,
  type StageState,
} from "@iusia/domain";
import { useSearchParams } from "react-router";
import { api, ApiError, type ExecutionResult, type MatterDetail } from "../api.js";
import { AnalysisModal } from "../components/AnalysisModal.js";
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
  facts: "Analizando los hechos del caso",
  evidence: "Evidencia del expediente recuperada",
  done: "Análisis completado",
  stopped: "Análisis detenido",
  failed: "El análisis no pudo completarse",
};
const AGENT_STAGE_LABEL: Record<string, string> = {
  "pisoso-orquestador-juridico": "Encuadre y conclusión",
  "01-intake-y-clasificador": "Análisis del expediente",
  "03-investigador-normativo-jurisprudencial": "Investigación normativa y jurisprudencial",
};

function stageLabel(stage: ProgressStage, agentNames: Map<string, string>): string {
  if (stage.agentId) {
    return (
      AGENT_STAGE_LABEL[stage.agentId] ??
      agentNames.get(stage.agentId) ??
      humanizeAgentId(stage.agentId)
    );
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
  const [liveRoot, setLiveRoot] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();

  // Enlace profundo `?analisis=`: el indicador global y los avisos reabren aquí la
  // experiencia que el abogado había cerrado. Se consume el parámetro para que
  // recargar o navegar atrás no la resucite.
  const deepLink = params.get("analisis");
  useEffect(() => {
    if (!deepLink) return;
    setSelectedRoot(deepLink);
    setLiveRoot(deepLink);
    const next = new URLSearchParams(params);
    next.delete("analisis");
    setParams(next, { replace: true });
  }, [deepLink, params, setParams]);

  // Si aparece una raíz nueva y aún no hay selección, la adoptamos.
  useEffect(() => {
    if (!selectedRoot && roots[0]) setSelectedRoot(roots[0].rootExecutionId);
  }, [roots, selectedRoot]);

  const start = useMutation({
    mutationFn: () => api.startOrchestration(matterId, objective.trim()),
    onSuccess: (res) => {
      setSelectedRoot(res.root_execution_id);
      // El análisis abre su propia experiencia: el abogado no tiene que buscarla.
      setLiveRoot(res.root_execution_id);
      void queryClient.invalidateQueries({ queryKey: ["matter", matterId] });
      void queryClient.invalidateQueries({ queryKey: ["active-analyses"] });
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
        documentCount={data.documents.length}
        ingestionStatuses={data.documents.map((d) => d.ingestionStatus)}
      />

      {selectedRoot ? (
        <RunView
          key={selectedRoot}
          matterId={matterId}
          rootExecutionId={selectedRoot}
          matterDocuments={data.documents}
          onOpenLive={() => setLiveRoot(selectedRoot)}
        />
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

      {liveRoot ? (
        <AnalysisModal
          rootExecutionId={liveRoot}
          matterId={matterId}
          documentCount={data.documents.length}
          open
          onClose={() => setLiveRoot(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Analysis Brief — el encargo que se le hace a IUSIA.
 *
 * Era un textarea con un botón: el mismo control que se usaría para dejar una nota.
 * Pedirle un análisis a un equipo de especialistas no es escribir una nota, y la
 * pantalla no decía nada de lo que iba a ocurrir después —sobre qué trabaja, quién
 * interviene, si hay que esperar—. Eso lo descubría el abogado ejecutando.
 *
 * Sigue siendo un textarea porque ésa es la capacidad real; lo que cambia es que
 * ahora está enmarcado en lo que IUSIA hará con él. Las tres condiciones que se
 * enuncian son deterministas y verificables en esta misma pantalla: los documentos
 * del expediente, la selección automática de especialistas y la continuación en
 * segundo plano. No hay sugerencias generadas ni prompts automáticos.
 */
function StartCard({
  objective,
  setObjective,
  onStart,
  pending,
  error,
  hasRuns,
  documentCount,
  ingestionStatuses,
}: {
  objective: string;
  setObjective: (v: string) => void;
  onStart: () => void;
  pending: boolean;
  error: unknown;
  hasRuns: boolean;
  documentCount: number;
  /** Estado de ingestión de cada documento del expediente. */
  ingestionStatuses: readonly string[];
}) {
  const insufficient = error instanceof ApiError && error.code === "INSUFFICIENT_CREDITS";
  // Lo calcula el dominio: la UI no decide qué cuenta como preparado.
  const readiness = convocationReadiness(ingestionStatuses);
  const tooShort = objective.trim().length < 10;

  return (
    <Module eyebrow="Encargo a IUSIA" title="Qué necesitas que analice" padded={false}>
      <div className="px-5 pb-5">
        <Textarea
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          rows={3}
          aria-label="Objetivo del encargo"
          className="rounded-[var(--radius-md)] text-[14.5px] leading-relaxed"
          placeholder="Ej.: Determina qué plazo de preaviso sostiene la contraparte y cita la evidencia del expediente."
        />

        {/* Lo que va a ocurrir, dicho antes de ejecutar. Todo verificable aquí. */}
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
          <BriefFact icon={<FileText size={13} />}>
            {documentCount === 0
              ? "Sin documentos incorporados todavía"
              : `Trabajará sobre ${documentCount} ${documentCount === 1 ? "documento" : "documentos"} del expediente`}
          </BriefFact>
          <BriefFact icon={<Users size={13} />}>
            Elegirá por sí misma qué especialistas intervienen
          </BriefFact>
          <BriefFact icon={<Clock size={13} />}>
            Puedes cerrar la ventana: sigue trabajando
          </BriefFact>
        </ul>

        {/*
          Disponibilidad parcial. Nunca se arranca en silencio ignorando archivos que el
          abogado cree incluidos: si alguno sigue subiendo o procesándose, se dice
          cuántos quedarían fuera de la evidencia y se le deja decidir.
        */}
        {!readiness.ready ? (
          <div className="mt-3 rounded-[var(--radius-md)] border border-iusia-warning/35 bg-iusia-warning/10 px-4 py-3 text-[13px] leading-relaxed text-iusia-warning-text">
            {readiness.statement}
          </div>
        ) : null}

        {insufficient ? (
          <div className="mt-3 rounded-[var(--radius-md)] bg-iusia-gold/12 px-4 py-2.5 text-[13px] text-iusia-gold-text">
            No hay créditos suficientes para iniciar el análisis. Contacta con la
            administración del despacho.
          </div>
        ) : error ? (
          <p role="alert" className="mt-3 text-[13px] text-iusia-critical">
            {error instanceof ApiError ? error.message : "No fue posible iniciar el análisis."}
          </p>
        ) : null}

        <div className="mt-4 flex items-center gap-3">
          <Button onClick={onStart} disabled={pending || tooShort}>
            {pending
              ? "Iniciando…"
              : !readiness.ready
                ? `Analizar los ${readiness.usableCount} preparados`
                : hasRuns
                  ? "Iniciar nuevo análisis"
                  : "Iniciar análisis"}
          </Button>
          {tooShort && objective.length > 0 ? (
            <span className="text-[12.5px] text-iusia-mist-text">
              Describe el encargo con algo más de detalle.
            </span>
          ) : null}
        </div>
      </div>
    </Module>
  );
}

function BriefFact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5 text-[12.5px] text-iusia-mist-text">
      <span className="text-iusia-intel-text" aria-hidden>
        {icon}
      </span>
      {children}
    </li>
  );
}

function RunView({
  matterId,
  rootExecutionId,
  matterDocuments,
  onOpenLive,
}: {
  matterId: string;
  rootExecutionId: string;
  matterDocuments: MatterDetail["documents"];
  onOpenLive: () => void;
}) {
  const [showTrace, setShowTrace] = useState(false);
  const queryClient = useQueryClient();

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

  // Al ENTRAR en estado terminal (una sola transición), refresca el historial y el
  // resultado sin recargar la página. El historial se hidrata de ["matter", id], que
  // sólo se invalidaba al iniciar; aquí se sincroniza al cierre. `shouldRefreshHistory`
  // sólo dispara en la transición real no-terminal → terminal, evitando bucles.
  const prevStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (shouldRefreshHistory(prevStatus.current, rootStatus)) {
      void queryClient.invalidateQueries({ queryKey: ["matter", matterId] });
      void queryClient.invalidateQueries({ queryKey: ["execution-result", rootExecutionId] });
    }
    prevStatus.current = rootStatus;
  }, [rootStatus, matterId, rootExecutionId, queryClient]);

  const stages = useMemo(() => {
    if (!eventsQuery.data) return [] as ProgressStage[];
    return deriveProgressStages({
      rootStatus,
      events: eventsQuery.data.events,
      executions: eventsQuery.data.executions,
      rootExecutionId,
      documentCount: matterDocuments.length,
    });
  }, [eventsQuery.data, rootStatus, rootExecutionId, matterDocuments.length]);

  const gatePassed = (eventsQuery.data?.events ?? []).some((e) => e.type === "gate.passed");

  // Circuit breaker: IUSIA detuvo la ejecución por una condición anómala.
  const cbEvent = (eventsQuery.data?.events ?? []).find((e) => e.detail?.circuit_breaker_reason);
  const circuitBreakerReason = cbEvent ? String(cbEvent.detail.circuit_breaker_reason) : null;

  // Justificación por agente (why_selected) desde el evento agent.dispatched.
  const whyByAgent = new Map<string, string>();
  for (const e of eventsQuery.data?.events ?? []) {
    if (e.type === "agent.dispatched" && e.to_agent_id && typeof e.detail?.why_selected === "string") {
      whyByAgent.set(e.to_agent_id, e.detail.why_selected as string);
    }
  }

  const cancel = useMutation({
    mutationFn: () => api.cancelExecution(rootExecutionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["execution-events", rootExecutionId] });
      void queryClient.invalidateQueries({ queryKey: ["matter", matterId] });
    },
  });

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
          action={
            <span className="flex items-center gap-3">
              <OutcomeChip status={rootStatus} />
              {!isTerminal ? (
                <button
                  type="button"
                  onClick={onOpenLive}
                  className="text-[13px] font-medium text-iusia-action hover:underline"
                >
                  Ver en vivo
                </button>
              ) : null}
              {!isTerminal ? (
                <button
                  type="button"
                  onClick={() => cancel.mutate()}
                  disabled={cancel.isPending}
                  className="text-[13px] font-medium text-iusia-critical hover:underline disabled:opacity-50"
                >
                  {cancel.isPending ? "Deteniendo…" : "Detener análisis"}
                </button>
              ) : null}
            </span>
          }
        />
        <div className="px-6 py-5">
          {circuitBreakerReason ? (
            <div className="mb-4 rounded-[10px] border border-iusia-warning/40 bg-iusia-warning/10 px-4 py-3">
              <p className="text-[13.5px] font-medium text-iusia-warning-text">
                IUSIA detuvo automáticamente el análisis para evitar una ejecución anómala.
              </p>
              <p className="mt-1 text-[12px] text-iusia-mist-text">Motivo técnico: {circuitBreakerReason}</p>
            </div>
          ) : null}
          <ol className="flex flex-col gap-3">
            {stages.map((s) => {
              const why = s.agentId ? whyByAgent.get(s.agentId) : undefined;
              return (
                <li key={s.key} className="flex items-start gap-3">
                  <span
                    className={
                      "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full " +
                      DOT[s.state] +
                      (s.state === "active" ? " animate-pulse" : "")
                    }
                  />
                  <span className="min-w-0">
                    <span
                      className={
                        "block text-[14px] " +
                        (s.state === "pending" ? "text-iusia-mist-text" : "text-iusia-carbon") +
                        (s.state === "done" ? " font-medium" : "")
                      }
                    >
                      {stageLabel(s, agentNames)}
                    </span>
                    {why ? <span className="block text-[12px] text-iusia-mist-text">{why}</span> : null}
                  </span>
                  {s.state === "failed" ? <StatusChip label="Falló" tone="critical" /> : null}
                </li>
              );
            })}
          </ol>
          {gatePassed && !circuitBreakerReason ? (
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

  // Un análisis terminado NO se suprime por falta de fundamentación documental: el
  // trabajo de los especialistas se entrega y la fundamentación se declara junto a él.
  const grounding = groundingNotice({
    documentCount: result.evidence.matter_document_count,
    evidenceChunkCount: result.evidence.chunk_count,
  });

  const headline = result.outputs.find((o) => o.node_code === "00") ?? result.outputs[0];
  const specialists = result.outputs.filter((o) => o !== headline);

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title="Conclusión de IUSIA"
          subtitle={headline ? `${headline.agent_name}` : undefined}
          action={<StatusChip label={grounding.label} tone={grounding.tone} dot />}
        />
        <div className="px-6 py-5">
          {grounding.detail ? (
            <p className="mb-4 rounded-[10px] border border-iusia-warning/35 bg-iusia-warning/10 px-4 py-3 text-[13px] leading-relaxed text-iusia-warning-text">
              {grounding.detail}
            </p>
          ) : null}
          {headline ? (
            <>
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-iusia-carbon">
                {headline.summary}
              </p>
              <details className="mt-4">
                <summary className="cursor-pointer text-[13px] text-iusia-mist-text hover:text-iusia-carbon">
                  Ver salida estructurada
                </summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded-[10px] bg-iusia-mist/10 p-3 text-[12px] leading-relaxed text-iusia-carbon">
                  {headline.text}
                </pre>
              </details>
            </>
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
                  {o.summary}
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-[12px] text-iusia-mist-text hover:text-iusia-carbon">
                    Ver salida estructurada
                  </summary>
                  <pre className="mt-2 max-h-72 overflow-auto rounded-[10px] bg-iusia-mist/10 p-3 text-[12px] leading-relaxed text-iusia-carbon">
                    {o.text}
                  </pre>
                </details>
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
