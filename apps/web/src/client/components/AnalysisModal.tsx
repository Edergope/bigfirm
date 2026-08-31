import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, X } from "lucide-react";
import { OrchestrationNetwork, Skeleton, useCanAnimate } from "@iusia/ui";
import {
  deriveConstellation,
  deriveProgressStages,
  planningWaitHint,
  shouldKeepPolling,
  shouldRefreshHistory,
  type ProgressStage,
  type StageState,
} from "@iusia/domain";
import { api } from "../api.js";

/**
 * IUSIA trabajando.
 *
 * Antes era una caja blanca con una lista de pasos: al pulsar "Iniciar análisis"
 * el producto pasaba del universo navy de la convocatoria a algo que parecía otra
 * aplicación. Convocar y trabajar son dos momentos del MISMO gesto, así que
 * comparten materia: navy profundo, atmósfera fría, la red al centro y la misma
 * tipografía. Lo único que cambia es que ahora la red tiene datos reales dentro.
 *
 * DOS ACCIONES DELIBERADAMENTE SEPARADAS, sin cambios respecto a lo ya validado:
 *  · Cerrar (✕, Escape, fondo): oculta. El análisis SIGUE en el servidor.
 *  · Detener análisis: cancela de verdad.
 * Confundirlas costaría trabajo jurídico ya pagado.
 */

const STAGE_LABEL: Record<string, string> = {
  received: "Entendiendo el encargo",
  facts: "Analizando los hechos del caso",
  evidence: "Analizando documentos y evidencia",
  done: "Análisis completado",
  stopped: "Análisis detenido",
  failed: "El análisis no pudo completarse",
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

export function AnalysisModal({
  rootExecutionId,
  matterId,
  documentCount,
  open,
  onClose,
}: {
  rootExecutionId: string;
  matterId: string;
  documentCount?: number;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDivElement>(null);
  const canAnimate = useCanAnimate();

  const events = useQuery({
    queryKey: ["execution-events", rootExecutionId],
    queryFn: () => api.executionEvents(rootExecutionId),
    refetchInterval: (q) => {
      const rows = q.state.data?.executions ?? [];
      const root = rows.find((e) => e.id === rootExecutionId);
      return shouldKeepPolling(root?.status) ? 2500 : false;
    },
    // Si el abogado se va a otra pestaña, al volver debe encontrar el análisis
    // donde está de verdad, no una foto congelada que luego salta.
    refetchIntervalInBackground: true,
  });
  const agents = useQuery({ queryKey: ["agents"], queryFn: api.agents });

  const rootStatus =
    events.data?.executions.find((e) => e.id === rootExecutionId)?.status ?? "RUNNING";
  const finished = !shouldKeepPolling(rootStatus);
  const ending = terminalCopy(rootStatus);

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
      documentCount,
    });
  }, [events.data, rootStatus, rootExecutionId, documentCount]);

  const network = useMemo(() => {
    if (!events.data) return { nodes: [], links: [], integrating: false };
    return deriveConstellation({
      executions: events.data.executions,
      events: events.data.events,
      rootExecutionId,
      agentNames,
    });
  }, [events.data, rootExecutionId, agentNames]);

  const prevStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (shouldRefreshHistory(prevStatus.current, rootStatus)) {
      void queryClient.invalidateQueries({ queryKey: ["matter", matterId] });
      void queryClient.invalidateQueries({ queryKey: ["execution-result", rootExecutionId] });
      void queryClient.invalidateQueries({ queryKey: ["active-analyses"] });
    }
    prevStatus.current = rootStatus;
  }, [rootStatus, matterId, rootExecutionId, queryClient]);

  // Escape cierra la vista, nunca cancela el trabajo. Foco atrapado y devuelto.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const f = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (f.length === 0) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [open, onClose]);

  const cancel = useMutation({
    mutationFn: () => api.cancelExecution(rootExecutionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["execution-events", rootExecutionId] });
      void queryClient.invalidateQueries({ queryKey: ["active-analyses"] });
    },
  });

  const cbEvent = (events.data?.events ?? []).find((e) => e.detail?.circuit_breaker_reason);
  // Espera declarada durante la planificación: la fase 00 PLAN es una única llamada
  // de razonamiento y, mientras dura, no hay avance que enseñar. Callarlo hizo que la
  // primera prueba real terminara en una cancelación humana de un análisis sano.
  const planningHint = planningWaitHint({
    events: events.data?.events ?? [],
    rootStatus,
  });
  const doneCount = stages.filter((s) => s.state === "done").length;
  const progress = stages.length > 0 ? Math.round((doneCount / stages.length) * 100) : 0;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-iusia-navy/45 p-4 backdrop-blur-sm"
          initial={canAnimate ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={finished ? ending.title : "IUSIA está analizando el expediente"}
            tabIndex={-1}
            initial={canAnimate ? { opacity: 0, scale: 0.985, y: 8 } : false}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={canAnimate ? { opacity: 0, scale: 0.99 } : { opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="on-navy flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[var(--radius-xl)] bg-iusia-navy-deep shadow-[var(--shadow-floating)] focus:outline-none"
          >
            {/* Misma atmósfera que la convocatoria: el sistema no cambia de universo
                al pasar de convocar a trabajar. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(58%_70%_at_50%_28%,rgba(34,199,232,0.15),transparent_66%)]"
            />

            <header className="relative flex items-start justify-between gap-4 px-6 pt-5">
              <div className="min-w-0">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-iusia-intel">
                  {finished ? "Resultado" : "Equipo jurídico en trabajo"}
                </p>
                <h2 className="mt-1 text-[20px] font-semibold tracking-[-0.02em] text-white">
                  {finished ? ending.title : "IUSIA está analizando el expediente"}
                </h2>
                <p className="mt-1 text-[13px] text-white/55">{finished ? ending.hint : ending.live}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar. El análisis continúa en segundo plano."
                title="Cerrar — el análisis continúa"
                className="shrink-0 rounded-[8px] p-1.5 text-white/50 transition-colors duration-[var(--motion-fast)] hover:bg-white/10 hover:text-white"
              >
                <X size={17} aria-hidden />
              </button>
            </header>

            <div className="relative flex-1 overflow-y-auto">
              {/* La red con datos reales: quién trabaja y hacia dónde va el trabajo. */}
              <OrchestrationNetwork
                nodes={network.nodes}
                links={network.links}
                integrating={network.integrating && !finished}
                className="w-full"
              />

              <div className="px-6 pb-5">
                {/* Progreso real, no un porcentaje inventado: fases cerradas sobre
                    fases conocidas. */}
                <div className="mb-4 flex items-center gap-3">
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                    <motion.span
                      className="block h-full origin-left rounded-full bg-iusia-intel"
                      style={{ width: `${progress}%` }}
                      initial={canAnimate ? { scaleX: 0 } : false}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
                    />
                  </span>
                  <span className="shrink-0 text-[11.5px] tnum text-white/45">
                    {doneCount} de {stages.length || "—"}
                  </span>
                </div>

                {events.isLoading && stages.length === 0 ? (
                  <Skeleton className="h-20 bg-white/5" />
                ) : (
                  <ol className="flex flex-col gap-1">
                    {stages.map((s, i) => (
                      <StageRow
                        key={s.key}
                        stage={s}
                        label={stageLabel(s, agentNames)}
                        index={i}
                        animate={canAnimate}
                      />
                    ))}
                  </ol>
                )}

                {planningHint ? (
                  <p className="mt-3 text-[12.5px] leading-relaxed text-white/55">
                    {planningHint}
                  </p>
                ) : null}

                {cbEvent ? (
                  <div className="mt-4 rounded-[var(--radius-md)] bg-iusia-warning/12 px-4 py-3">
                    <p className="text-[13px] font-medium text-[#F3C879]">
                      IUSIA detuvo automáticamente el análisis para evitar una ejecución
                      anómala.
                    </p>
                  </div>
                ) : null}
              </div>
            </div>

            <footer className="relative flex items-center justify-between gap-3 border-t border-white/[0.08] bg-black/20 px-6 py-3.5">
              {!finished ? (
                <button
                  type="button"
                  onClick={() => cancel.mutate()}
                  disabled={cancel.isPending}
                  className="rounded-[8px] px-2 py-1 text-[12.5px] font-medium text-[#FCA5A5] transition-colors duration-[var(--motion-fast)] hover:bg-white/[0.06] hover:text-[#FECACA] disabled:opacity-50"
                >
                  {cancel.isPending ? "Deteniendo…" : "Detener análisis"}
                </button>
              ) : (
                <span className="text-[12.5px] text-white/45">{ending.footer}</span>
              )}

              <motion.button
                type="button"
                onClick={onClose}
                initial={false}
                animate={{ y: 0, scale: 1, boxShadow: "0 4px 14px -4px rgba(37,99,235,0.55)" }}
                whileHover={
                  canAnimate ? { y: -2, boxShadow: "0 14px 30px -8px rgba(37,99,235,0.7)" } : undefined
                }
                whileTap={canAnimate ? { y: 0, scale: 0.985 } : undefined}
                transition={{ type: "spring", stiffness: 480, damping: 34, mass: 0.7 }}
                className="group inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-[var(--radius-md)] bg-iusia-action px-4 py-2.5 text-[13.5px] font-semibold text-white transition-colors duration-[var(--motion-fast)] hover:bg-[#1d4fd0]"
              >
                {finished ? ending.action : "Seguir trabajando"}
                <ArrowRight
                  size={14}
                  aria-hidden
                  className="transition-transform duration-[var(--motion-fast)] group-hover:translate-x-1 motion-reduce:transition-none"
                />
              </motion.button>
            </footer>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Una fase del encargo. El estado activo se distingue por materia, no por un punto. */
function StageRow({
  stage,
  label,
  index,
  animate,
}: {
  stage: ProgressStage;
  label: string;
  index: number;
  animate: boolean;
}) {
  const tone: Record<StageState, string> = {
    done: "text-white/75",
    active: "text-white",
    failed: "text-[#FCA5A5]",
    pending: "text-white/35",
  };
  return (
    <motion.li
      initial={animate ? { opacity: 0, y: 4 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.04, 0.24) }}
      className={
        "flex items-center gap-3 rounded-[10px] px-2.5 py-1.5 text-[13.5px] " +
        (stage.state === "active" ? "bg-white/[0.06] font-medium" : "") +
        " " +
        tone[stage.state]
      }
    >
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        {stage.state === "done" ? (
          <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
            <circle cx="8" cy="8" r="7" fill="none" stroke="#34D399" strokeOpacity="0.5" />
            <path
              d="M5 8.2 l2 2 l4 -4.4"
              fill="none"
              stroke="#34D399"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : stage.state === "failed" ? (
          <span className="h-2 w-2 rounded-full bg-[#F87171]" />
        ) : stage.state === "active" ? (
          <>
            <motion.span
              className="absolute h-4 w-4 rounded-full bg-iusia-intel"
              animate={animate ? { opacity: [0.35, 0, 0.35], scale: [0.8, 1.6, 0.8] } : { opacity: 0.25 }}
              transition={animate ? { duration: 1.8, repeat: Infinity } : { duration: 0 }}
            />
            <span className="relative h-2 w-2 rounded-full bg-iusia-intel" />
          </>
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-white/25" />
        )}
      </span>
      {label}
    </motion.li>
  );
}

/** Copy de cierre según CÓMO terminó, no sólo si terminó. */
function terminalCopy(status: string): {
  title: string;
  hint: string;
  live: string;
  footer: string;
  action: string;
} {
  const live = "Puedes cerrar esta ventana: el análisis continúa.";
  if (status === "CANCELLED") {
    return {
      title: "Análisis detenido",
      hint: "Lo detuviste antes de que IUSIA concluyera. No hay dictamen para este intento.",
      live,
      footer: "El expediente conserva el registro de lo que alcanzó a ejecutarse.",
      action: "Volver al expediente",
    };
  }
  if (status === "FAILED" || status === "BLOCKED") {
    return {
      title: "El análisis no pudo completarse",
      hint: "IUSIA se detuvo antes de emitir una conclusión. Puedes intentarlo de nuevo.",
      live,
      footer: "El expediente conserva la trazabilidad de lo ocurrido.",
      action: "Ver detalle",
    };
  }
  return {
    title: "Análisis completado",
    hint: "El resultado ya está disponible en el expediente.",
    live,
    footer: "El expediente conserva el resultado y su trazabilidad.",
    action: "Ver resultado",
  };
}

function stageLabel(stage: ProgressStage, agentNames: Map<string, string>): string {
  if (stage.agentId) {
    return AGENT_STAGE_LABEL[stage.agentId] ?? agentNames.get(stage.agentId) ?? stage.agentId;
  }
  return STAGE_LABEL[stage.key] ?? stage.key;
}
