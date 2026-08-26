import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, FolderTree, Paperclip, X } from "lucide-react";
import {
  Button,
  Input,
  Select,
  SpecialistNetwork,
  Textarea,
  materialityTerm,
  practiceAreaLabel,
  useCanAnimate,
} from "@iusia/ui";
import { api, ApiError } from "../api.js";
import { HERO_SPECIALISTS } from "./IusiaHero.js";

/** Centinela del selector: crear un expediente nuevo en el mismo flujo. */
const NEW_MATTER = "__new__";
const PRACTICE_AREAS = [
  "CIVIL", "COMERCIAL_CONTRACTUAL", "SOCIETARIO_MA", "LABORAL", "TRIBUTARIO",
  "PENAL_ECONOMICO", "ADMINISTRATIVO", "CONSTITUCIONAL", "FAMILIA", "INMOBILIARIO",
  "PROPIEDAD_INTELECTUAL", "INSOLVENCIA", "MIGRATORIO", "FINANCIERO", "COMPLIANCE", "OTRO",
];
const MATERIALITIES = ["SIMPLE", "MATERIAL", "HIGH_STAKES"];

/**
 * Espera determinista a que los documentos aportados estén disponibles para el
 * análisis: mientras alguno siga PENDIENTE/PROCESSING, el RAG no los vería. Se
 * consulta el workspace real (no sleeps) con un tope de intentos; si al cabo del
 * tope siguen sin indexar, se continúa —el análisis usa lo que ya esté disponible—.
 */
async function waitForIngestion(matterId: string, expected: number): Promise<void> {
  const NOT_READY = new Set(["PENDIENTE", "PROCESSING"]);
  for (let i = 0; i < 12; i++) {
    const ws = await api.matterWorkspace(matterId).catch(() => null);
    const uploaded = ws?.uploaded ?? [];
    const ready = uploaded.filter((d) => !NOT_READY.has(d.status)).length;
    if (uploaded.length >= expected && ready >= expected) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

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
  // Campos del expediente nuevo (sólo se muestran en modo NEW_MATTER).
  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [jurisdiction, setJurisdiction] = useState("Colombia");
  const [area, setArea] = useState("COMERCIAL_CONTRACTUAL");
  const [materiality, setMateriality] = useState("MATERIAL");

  const rows = useMemo(() => matters.data?.matters ?? [], [matters.data]);
  const isNew = matterId === NEW_MATTER;

  // Con un solo expediente se preselecciona; sin ninguno, se arranca en modo nuevo.
  useEffect(() => {
    if (matterId) return;
    if (rows.length > 0) setMatterId(rows[0]!.id);
    else if (matters.isSuccess) setMatterId(NEW_MATTER);
  }, [rows, matterId, matters.isSuccess]);

  const start = useMutation({
    mutationFn: async () => {
      // Modo nuevo: crear el expediente ANTES de nada. El resto del flujo se liga
      // inequívocamente a ese matterId, nunca a otro seleccionado.
      let targetId = matterId;
      if (isNew) {
        const created = await api.createMatter({
          title: title.trim(),
          client_name: clientName.trim(),
          materiality,
          practice_areas: [area],
          jurisdiction: jurisdiction.trim(),
          objective: objective.trim() || undefined,
        });
        targetId = created.matter.id;
      }

      // Adjuntos → "01 Documentos aportados" → cola de ingestión.
      if (files.length > 0) {
        await api.uploadDocuments(targetId, files);
        // No analizar antes de que los documentos estén disponibles para el RAG.
        await waitForIngestion(targetId, files.length);
      }
      const res = await api.startOrchestration(targetId, objective.trim());
      return { targetId, root: res.root_execution_id };
    },
    onSuccess: ({ targetId, root }) => {
      const go = () => {
        onClose();
        navigate(`/casos/${targetId}?analisis=${root}`);
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
  const newMatterIncomplete = isNew && (title.trim().length < 3 || clientName.trim().length < 2);
  const canStart = !convoking && !tooShort && !!matterId && !newMatterIncomplete;

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
              {matters.isLoading ? null : (
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
                        {/* Un caso nuevo nunca se cuela en un expediente existente:
                            la opción está separada y arriba. */}
                        <option value={NEW_MATTER}>+ Nuevo expediente</option>
                        {rows.length > 0 ? (
                          <optgroup label="Expedientes existentes">
                            {rows.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.title}
                              </option>
                            ))}
                          </optgroup>
                        ) : null}
                      </Select>
                      <p className="mt-1.5 text-[12px] leading-snug text-iusia-mist-text">
                        {isNew
                          ? "Se creará el expediente y su carpeta en Drive antes de analizar."
                          : "IUSIA trabajará sobre los documentos y hechos de este expediente."}
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

                  {/* Campos mínimos del expediente nuevo, reutilizando el modelo de
                      "Nuevo expediente". No se inventa ningún campo. */}
                  {isNew ? (
                    <div className="mt-4 grid grid-cols-1 gap-3 rounded-[var(--radius-md)] bg-iusia-ice/50 p-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-[12px] font-medium text-iusia-carbon">Asunto</span>
                        <Input
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          disabled={convoking}
                          className="h-9 rounded-[10px] text-[13.5px]"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[12px] font-medium text-iusia-carbon">Cliente</span>
                        <Input
                          value={clientName}
                          onChange={(e) => setClientName(e.target.value)}
                          disabled={convoking}
                          className="h-9 rounded-[10px] text-[13.5px]"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[12px] font-medium text-iusia-carbon">
                          Jurisdicción
                        </span>
                        <Input
                          value={jurisdiction}
                          onChange={(e) => setJurisdiction(e.target.value)}
                          disabled={convoking}
                          className="h-9 rounded-[10px] text-[13.5px]"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[12px] font-medium text-iusia-carbon">
                          Área de práctica
                        </span>
                        <Select
                          value={area}
                          onChange={(e) => setArea(e.target.value)}
                          disabled={convoking}
                          className="h-9 w-full rounded-[10px] text-[13px]"
                        >
                          {PRACTICE_AREAS.map((a) => (
                            <option key={a} value={a}>
                              {practiceAreaLabel(a)}
                            </option>
                          ))}
                        </Select>
                      </label>
                      <label className="block sm:col-span-2">
                        <span className="mb-1 block text-[12px] font-medium text-iusia-carbon">
                          Criticidad del encargo
                        </span>
                        <Select
                          value={materiality}
                          onChange={(e) => setMateriality(e.target.value)}
                          disabled={convoking}
                          className="h-9 w-full rounded-[10px] text-[13px]"
                        >
                          {MATERIALITIES.map((mt) => (
                            <option key={mt} value={mt}>
                              {materialityTerm(mt).label}
                            </option>
                          ))}
                        </Select>
                      </label>
                    </div>
                  ) : null}

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

            {!matters.isLoading ? (
              <footer className="flex items-center justify-between gap-3 border-t border-iusia-line bg-iusia-surface/50 px-6 py-4">
                <p className="text-[12.5px] text-iusia-mist-text">
                  {convoking
                    ? isNew
                      ? "Creando el expediente e incorporando documentos…"
                      : "Puedes cerrar en cuanto empiece: seguirá trabajando."
                    : "IUSIA elegirá por sí misma qué especialistas intervienen."}
                </p>
                <Button onClick={() => start.mutate()} disabled={!canStart}>
                  {start.isPending
                    ? isNew
                      ? "Creando…"
                      : "Convocando…"
                    : start.isSuccess
                      ? "En marcha"
                      : isNew
                        ? "Crear expediente y convocar IUSIA"
                        : "Iniciar análisis"}
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
