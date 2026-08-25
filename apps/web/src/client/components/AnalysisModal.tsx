import { lazy, Suspense, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Skeleton, StatusChip } from "@iusia/ui";
import {
  deriveConstellation,
  deriveProgressStages,
  shouldKeepPolling,
  shouldRefreshHistory,
  type ProgressStage,
  type StageState,
} from "@iusia/domain";
import { X } from "lucide-react";
import { api } from "../api.js";

/**
 * Experiencia de análisis de IUSIA.
 *
 * DOS ACCIONES DISTINTAS, deliberadamente separadas:
 *  - Cerrar (✕): oculta la experiencia. El análisis SIGUE trabajando en el servidor.
 *  - Detener análisis: cancela de verdad, con el circuit breaker del servidor.
 * Confundirlas costaría trabajo jurídico ya pagado, así que ni el copy ni el layout
 * las acercan.
 *
 * La visualización se carga de forma diferida: es acompañamiento, no requisito para
 * entender el progreso, que se lee igual en la lista de fases.
 */

// Se importa por su subruta y no por el barril de @iusia/ui: el barril ya viaja
// en el bundle principal, así que importarlo aquí no separaría nada.
const Constellation = lazy(() =>
  import("@iusia/ui/analysis-constellation").then((m) => ({
    default: m.AnalysisConstellation,
  })),
);

const STAGE_LABEL: Record<string, string> = {
  received: "Entendiendo el encargo",
  evidence: "Analizando documentos y evidencia",
  done: "Análisis completado",
};
const AGENT_STAGE_LABEL: Record<string, string> = {
  "pisoso-orquestador-juridico": "Identificando los especialistas adecuados",
  "01-intake-y-clasificador": "Estableciendo los hechos del expediente",
  "03-investigador-normativo-jurisprudencial": "Contrastando el marco normativo",
  "04-analista-probatorio-y-pericial": "Valorando la prueba disponible",
  "05-analista-procesal-y-procedibilidad": "Evaluando la vía procesal",
  "06-estratega-juridico-convencional": "Construyendo la estrategia",
  "especialista-contractual-y-negocios": "Interpretando el régimen contractual",
};

const DOT: Record<StageState, string> = {
  done: "bg-iusia-success",
  active: "bg-iusia-intel",
  failed: "bg-iusia-critical",
  pending: "bg-iusia-mist",
};

export function AnalysisModal({
  rootExecutionId,
  matterId,
  open,
  onClose,
}: {
  rootExecutionId: string;
  matterId: string;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDivElement>(null);

  const events = useQuery({
    queryKey: ["execution-events", rootExecutionId],
    queryFn: () => api.executionEvents(rootExecutionId),
    refetchInterval: (q) => {
      const rows = q.state.data?.executions ?? [];
      const root = rows.find((e) => e.id === rootExecutionId);
      return shouldKeepPolling(root?.status) ? 2500 : false;
    },
  });
  const agents = useQuery({ queryKey: ["agents"], queryFn: api.agents });

  const rootStatus =
    events.data?.executions.find((e) => e.id === rootExecutionId)?.status ?? "RUNNING";
  const finished = !shouldKeepPolling(rootStatus);

  const agentNames = useMemo(
    () => new Map((agents.data?.agents ?? []).map((a) => [a.agent_id, a.name])),
    [agents.data],
  );

  const stages: ProgressStage[] = useMemo(() => {
    if (!events.data) return [];
    return deriveProgressStages({
      rootStatus,
      events: events.data.events,
      executions: events.data.executions,
      rootExecutionId,
    });
  }, [events.data, rootStatus, rootExecutionId]);

  const constellation = useMemo(() => {
    if (!events.data) return { nodes: [], links: [], integrating: false };
    return deriveConstellation({
      executions: events.data.executions,
      events: events.data.events,
      rootExecutionId,
      agentNames,
    });
  }, [events.data, rootExecutionId, agentNames]);

  // Al terminar, el historial y el resultado del expediente dejan de estar al día.
  const prevStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (shouldRefreshHistory(prevStatus.current, rootStatus)) {
      void queryClient.invalidateQueries({ queryKey: ["matter", matterId] });
      void queryClient.invalidateQueries({ queryKey: ["execution-result", rootExecutionId] });
      void queryClient.invalidateQueries({ queryKey: ["active-analyses"] });
    }
    prevStatus.current = rootStatus;
  }, [rootStatus, matterId, rootExecutionId, queryClient]);

  // Cerrar con Escape es cerrar la vista, nunca cancelar el trabajo.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const cancel = useMutation({
    mutationFn: () => api.cancelExecution(rootExecutionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["execution-events", rootExecutionId] });
      void queryClient.invalidateQueries({ queryKey: ["active-analyses"] });
    },
  });

  if (!open) return null;

  const cbEvent = (events.data?.events ?? []).find((e) => e.detail?.circuit_breaker_reason);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-iusia-navy/40 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Análisis de IUSIA en curso"
        tabIndex={-1}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[14px] bg-iusia-paper shadow-[0_24px_64px_-12px_rgba(11,29,58,0.45)] focus:outline-none"
      >
        <header className="flex items-start justify-between gap-4 border-b border-iusia-mist/25 px-6 py-4">
          <div>
            <p className="text-[15.5px] font-semibold text-iusia-navy">
              {finished ? "Análisis completado" : "IUSIA está analizando el expediente"}
            </p>
            <p className="mt-0.5 text-[13px] text-iusia-mist-text">
              {finished
                ? "El resultado ya está disponible en el expediente."
                : "Puedes cerrar esta ventana: el análisis continúa."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar. El análisis continúa en segundo plano."
            title="Cerrar — el análisis continúa"
            className="rounded-[8px] p-1.5 text-iusia-mist-text transition-colors hover:bg-iusia-mist/15 hover:text-iusia-carbon"
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="bg-[linear-gradient(180deg,#FBFCFE,#F4F6FA)] px-6 py-4">
            <Suspense fallback={<Skeleton className="h-[240px]" />}>
              <Constellation
                nodes={constellation.nodes}
                links={constellation.links}
                integrating={constellation.integrating && !finished}
                height={240}
              />
            </Suspense>
          </div>

          <ol className="flex flex-col gap-2.5 px-6 py-5">
            {events.isLoading && stages.length === 0 ? (
              <Skeleton className="h-24" />
            ) : (
              stages.map((s) => (
                <li key={s.key} className="flex items-start gap-3">
                  <span
                    className={
                      "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full " +
                      DOT[s.state] +
                      (s.state === "active" ? " animate-pulse motion-reduce:animate-none" : "")
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
              ))
            )}
          </ol>

          {cbEvent ? (
            <div className="mx-6 mb-5 rounded-[10px] border border-iusia-warning/40 bg-iusia-warning/10 px-4 py-3">
              <p className="text-[13.5px] font-medium text-iusia-warning-text">
                IUSIA detuvo automáticamente el análisis para evitar una ejecución anómala.
              </p>
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-iusia-mist/25 px-6 py-4">
          {/* Acción destructiva a la izquierda y con nombre explícito: no se confunde
              con cerrar la ventana, que está arriba y no interrumpe nada. */}
          {!finished ? (
            <button
              type="button"
              onClick={() => cancel.mutate()}
              disabled={cancel.isPending}
              className="text-[13.5px] font-medium text-iusia-critical hover:underline disabled:opacity-50"
            >
              {cancel.isPending ? "Deteniendo…" : "Detener análisis"}
            </button>
          ) : (
            <span className="text-[13px] text-iusia-mist-text">
              El expediente conserva el resultado y su trazabilidad.
            </span>
          )}
          <Button type="button" onClick={onClose}>
            {finished ? "Ver resultado" : "Seguir trabajando"}
          </Button>
        </footer>
      </div>
    </div>
  );
}

function stageLabel(stage: ProgressStage, agentNames: Map<string, string>): string {
  if (stage.agentId) {
    return (
      AGENT_STAGE_LABEL[stage.agentId] ?? agentNames.get(stage.agentId) ?? stage.agentId
    );
  }
  return STAGE_LABEL[stage.key] ?? stage.key;
}
