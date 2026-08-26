import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, FolderTree, Paperclip, Plus, X } from "lucide-react";
import { Button, Select, SpecialistNetwork, Textarea, useCanAnimate } from "@iusia/ui";
import { api, ApiError } from "../api.js";
import { HERO_SPECIALISTS } from "./IusiaHero.js";

/**
 * Convocatoria de IUSIA.
 *
 * Puerta de entrada al análisis desde la portada. Deliberadamente NO es una
 * arquitectura nueva: reutiliza `startOrchestration`, el mismo flujo que se dispara
 * desde el expediente, y al arrancar entrega el control a la experiencia de
 * análisis que ya existe —modal con constelación real, cerrar ≠ cancelar,
 * continuación en segundo plano y reapertura desde el indicador global—. Un
 * segundo camino paralelo habría duplicado semántica que costó validar en vivo.
 *
 * Tres estados, no tres pantallas: convocar → convocando → entregar. La red del
 * centro cambia con el estado, así que el movimiento cuenta lo que ocurre.
 */
export function ConvocationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const still = !useCanAnimate();
  const dialogRef = useRef<HTMLDivElement>(null);

  const matters = useQuery({ queryKey: ["matters"], queryFn: api.listMatters, enabled: open });
  const [matterId, setMatterId] = useState("");
  const [objective, setObjective] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => matters.data?.matters ?? [], [matters.data]);
  const hasMatters = rows.length > 0;

  // Con un solo expediente no hay nada que elegir: se preselecciona.
  useEffect(() => {
    if (!matterId && rows.length > 0) setMatterId(rows[0]!.id);
  }, [rows, matterId]);

  const start = useMutation({
    mutationFn: async () => {
      // Los adjuntos se incorporan ANTES de convocar: se suben a "01 Documentos
      // aportados" y quedan encolados para ingestión. El análisis trabaja sobre lo
      // que ya está en el expediente; los recién subidos se procesan en paralelo.
      if (files.length > 0) {
        await api.uploadDocuments(matterId, files);
      }
      return api.startOrchestration(matterId, objective.trim());
    },
    onSuccess: (res) => {
      // Se entrega a la experiencia de análisis existente, que ya sabe continuar en
      // segundo plano y reabrirse. Un respiro antes de navegar para que la red
      // termine de encenderse y el cambio no se sienta como un corte.
      const go = () => {
        onClose();
        navigate(`/casos/${matterId}?analisis=${res.root_execution_id}`);
      };
      if (still) go();
      else setTimeout(go, 900);
    },
  });

  const convoking = start.isPending || start.isSuccess;

  // Escape cierra; el foco queda dentro y vuelve a su origen al salir.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !convoking) onClose();
      if (e.key !== "Tab") return;
      const el = dialogRef.current;
      if (!el) return;
      const f = el.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (f.length === 0) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
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
  }, [open, onClose, convoking]);

  const tooShort = objective.trim().length < 10;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-iusia-navy/45 p-4 backdrop-blur-sm"
          initial={still ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !convoking) onClose();
          }}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Convocar a IUSIA"
            tabIndex={-1}
            initial={still ? false : { opacity: 0, scale: 0.985, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={still ? { opacity: 0 } : { opacity: 0, scale: 0.99 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[var(--radius-xl)] bg-iusia-paper shadow-[var(--shadow-floating)] focus:outline-none"
          >
            {/* La red vive arriba, sobre navy: es el retrato de lo que se convoca. */}
            <div className="on-navy relative overflow-hidden bg-iusia-navy-deep px-6 pb-2 pt-5">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_100%_at_50%_20%,rgba(34,199,232,0.18),transparent_65%)]"
              />
              <div className="relative flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-iusia-intel">
                    {convoking ? "Convocando" : "Equipo jurídico"}
                  </p>
                  <h2 className="mt-1 text-[20px] font-semibold tracking-[-0.02em] text-white">
                    {convoking ? "IUSIA está reuniendo al equipo" : "Convoca a IUSIA"}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={convoking}
                  aria-label="Cerrar"
                  className="rounded-[8px] p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
                >
                  <X size={17} aria-hidden />
                </button>
              </div>
              <SpecialistNetwork
                nodes={HERO_SPECIALISTS}
                state={convoking ? "convoking" : "idle"}
                className="relative -mt-1 w-full"
              />
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {!hasMatters && !matters.isLoading ? (
                // Sin expedientes no hay nada que analizar: salida, no callejón.
                <div>
                  <p className="text-[14.5px] text-iusia-carbon">
                    IUSIA trabaja sobre un expediente concreto, y todavía no tienes ninguno.
                  </p>
                  <p className="mt-1 text-[13px] text-iusia-mist-text">
                    Abre uno y podrás convocar al equipo sobre él.
                  </p>
                  <div className="mt-4">
                    <Button
                      onClick={() => {
                        onClose();
                        navigate("/casos");
                      }}
                    >
                      <Plus size={15} aria-hidden />
                      Crear expediente primero
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-[minmax(0,240px)_1fr]">
                    <label className="block">
                      <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[0.07em] text-iusia-mist-text">
                        Expediente
                      </span>
                      <Select
                        value={matterId}
                        onChange={(e) => setMatterId(e.target.value)}
                        disabled={convoking}
                        aria-label="Expediente sobre el que trabajará IUSIA"
                        className="h-10 w-full min-w-0 truncate rounded-[10px] text-[13.5px]"
                      >
                        {rows.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.title}
                          </option>
                        ))}
                      </Select>
                      <p className="mt-1.5 text-[12px] leading-snug text-iusia-mist-text">
                        IUSIA trabajará sobre los documentos y hechos de este expediente.
                      </p>
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[0.07em] text-iusia-mist-text">
                        Qué necesitas
                      </span>
                      <Textarea
                        value={objective}
                        onChange={(e) => setObjective(e.target.value)}
                        disabled={convoking}
                        rows={3}
                        className="rounded-[10px] text-[14px] leading-relaxed"
                        placeholder="Ej.: Determina qué plazo de preaviso sostiene la contraparte y cita la evidencia del expediente."
                      />
                    </label>
                  </div>

                  {/*
                    Adjuntos. La UI está lista y el contrato es explícito, pero el
                    envío todavía NO existe: el Document Pipeline —carpeta del
                    expediente en Drive, subcarpeta de documentos aportados,
                    subcarpeta de documentos generados por IUSIA, cola, R2 e
                    indexación— es el sprint siguiente. Se dice aquí, en la
                    interfaz, en lugar de aceptar archivos que se perderían.
                  */}
                  <div className="mt-4">
                    <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[0.07em] text-iusia-mist-text">
                      Documentos del caso
                    </span>

                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (convoking) return;
                        setFiles((f) => [...f, ...Array.from(e.dataTransfer.files)].slice(0, 10));
                      }}
                      className="rounded-[var(--radius-md)] border border-dashed border-iusia-line-strong bg-iusia-ice/50 px-4 py-3.5"
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        {/* Arrastrar no puede ser la única vía: siempre hay botón. */}
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => fileInput.current?.click()}
                          disabled={convoking}
                        >
                          <Paperclip size={14} aria-hidden />
                          Adjuntar documentos
                        </Button>
                        <span className="text-[12.5px] text-iusia-mist-text">
                          o arrástralos aquí
                        </span>
                      </div>
                      <input
                        ref={fileInput}
                        type="file"
                        multiple
                        className="sr-only"
                        aria-label="Adjuntar documentos al expediente"
                        onChange={(e) =>
                          setFiles((f) =>
                            [...f, ...Array.from(e.target.files ?? [])].slice(0, 10),
                          )
                        }
                      />

                      {files.length > 0 ? (
                        <ul className="mt-3 flex flex-col gap-1">
                          {files.map((f, i) => (
                            <li
                              key={`${f.name}-${i}`}
                              className="flex items-center justify-between gap-3 rounded-[8px] bg-iusia-paper px-2.5 py-1.5"
                            >
                              <span className="min-w-0 truncate text-[12.5px] text-iusia-carbon">
                                {f.name}
                              </span>
                              <button
                                type="button"
                                onClick={() => setFiles((c) => c.filter((_, j) => j !== i))}
                                className="shrink-0 text-[11.5px] font-medium text-iusia-mist-text transition-colors hover:text-iusia-critical"
                              >
                                Quitar
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      {/* El destino de esos archivos, dicho antes de adjuntarlos. */}
                      <p className="mt-3 flex items-start gap-2 text-[12px] leading-snug text-iusia-mist-text">
                        <FolderTree size={13} className="mt-0.5 shrink-0" aria-hidden />
                        <span>
                          Se guardarán en la carpeta del expediente en Drive, separando lo
                          que aportas tú de lo que genere IUSIA, y quedarán disponibles para
                          el análisis.
                        </span>
                      </p>
                    </div>
                  </div>

                  {start.error ? (
                    <p role="alert" className="mt-3 text-[13px] text-iusia-critical">
                      {start.error instanceof ApiError
                        ? start.error.message
                        : "No fue posible convocar al equipo."}
                    </p>
                  ) : null}
                </>
              )}
            </div>

            {hasMatters ? (
              <footer className="flex items-center justify-between gap-3 border-t border-iusia-line bg-iusia-surface/50 px-6 py-4">
                <p className="text-[12.5px] text-iusia-mist-text">
                  {convoking
                    ? "Puedes cerrar en cuanto empiece: seguirá trabajando."
                    : "IUSIA elegirá por sí misma qué especialistas intervienen."}
                </p>
                <Button
                  onClick={() => start.mutate()}
                  disabled={convoking || tooShort || !matterId}
                >
                  {start.isPending ? "Convocando…" : start.isSuccess ? "En marcha" : "Iniciar análisis"}
                  {!convoking ? <ArrowRight size={15} aria-hidden /> : null}
                </Button>
              </footer>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
