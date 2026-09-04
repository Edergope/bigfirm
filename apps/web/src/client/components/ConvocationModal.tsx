import { useEffect, useMemo, useRef, useState } from "react";
import { uploadAccountingStatement, type UploadAccounting } from "@iusia/domain";
import { useFileSelection } from "../hooks/use-file-selection";
import { FileSelectionSummary } from "./FileSelectionSummary";
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
import {
  convocationErrorCopy,
  documentsReadyForAnalysis,
  type ConvocationStage,
  type DuplicateCandidateView,
} from "@iusia/domain";
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
  // Mismo contrato de selección que el formulario de alta y el workspace: un solo
  // límite, un solo aviso, ningún recorte mudo.
  const {
    files,
    add: addFiles,
    remove: removeFile,
    clear: clearFiles,
    limitNotice,
    formatNotices,
    totalBytes,
  } = useFileSelection();
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [uploadAccounting, setUploadAccounting] = useState<UploadAccounting | null>(null);
  const [continueTo, setContinueTo] = useState<string | null>(null);
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

  /**
   * Identidad de ESTA convocatoria. Se genera una vez por intento lógico y sobrevive
   * a reintentos, dobles clics y respuestas inciertas: el servidor devuelve el mismo
   * expediente en lugar de abrir otro. Sólo cambia cuando el abogado decide
   * deliberadamente abrir un asunto distinto.
   */
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  // Expediente ya creado por esta convocatoria. Si algo falla después, se reanuda
  // sobre él en lugar de volver a empezar.
  const [createdMatterId, setCreatedMatterId] = useState("");
  const [duplicate, setDuplicate] = useState<DuplicateCandidateView | null>(null);
  const [stage, setStage] = useState<ConvocationStage | null>(null);

  const start = useMutation({
    mutationFn: async (opts: { confirmDifferent?: boolean } = {}) => {
      setStage(null);
      // Modo nuevo: crear el expediente ANTES de nada. El resto del flujo se liga
      // inequívocamente a ese matterId, nunca a otro seleccionado.
      let targetId = createdMatterId || matterId;
      let accepted: number | null = null;
      if (isNew && !createdMatterId) {
        try {
          const created = await api.createMatter({
            title: title.trim(),
            client_name: clientName.trim(),
            materiality,
            practice_areas: [area],
            jurisdiction: jurisdiction.trim(),
            objective: objective.trim() || undefined,
            request_key: requestKey,
            confirm_different: opts.confirmDifferent,
          });
          targetId = created.matter.id;
          setCreatedMatterId(targetId);
        } catch (error) {
          const candidate =
            error instanceof ApiError && error.details?.reason === "POSSIBLE_DUPLICATE_MATTER"
              ? (error.details.candidate as DuplicateCandidateView)
              : null;
          if (candidate) {
            setDuplicate(candidate);
            setStage("POSSIBLE_DUPLICATE_MATTER");
            throw error;
          }
          setStage("MATTER_CREATION_FAILED");
          throw error;
        }
      }

      // Adjuntos → carpeta de documentos aportados del expediente → cola de ingestión.
      // Un reintento con el mismo archivo NO lo incorpora dos veces: el servidor lo
      // reconoce por su contenido.
      if (files.length > 0) {
        try {
          const upload = await api.uploadDocuments(targetId, files);
          accepted = upload.accounting?.accepted ?? upload.uploaded.length;
          // Que la petición devuelva 201 NO significa que entraran todos: hay archivos
          // que el servidor rechaza por formato y otros que unifica con uno idéntico,
          // y ninguno de los dos casos es un fallo de subida. Se guarda el recuento
          // para decirlo, en vez de dar por buena la carga entera.
          setUploadAccounting(upload.accounting ?? null);
          clearFiles();
        } catch (error) {
          setStage("DOCUMENT_UPLOAD_FAILED");
          throw error;
        }
      }

      // La creación NO espera a la indexación. Si los documentos siguen procesándose,
      // se entrega el expediente y el análisis se inicia desde él cuando estén listos.
      const workspace = await api.matterWorkspace(targetId).catch(() => null);
      // Se espera por los archivos que el servidor ACEPTÓ, no por los que se
      // seleccionaron. Contra el número seleccionado, un lote con un duplicado o un
      // formato no admitido nunca alcanza la cuenta y el expediente se queda esperando
      // a un documento que nadie creó.
      const expected = accepted ?? files.length;
      const ready =
        expected === 0
        || (workspace !== null && documentsReadyForAnalysis(workspace.uploaded, expected));
      if (!ready) return { targetId, root: null, pending: true };

      try {
        const res = await api.startOrchestration(targetId, objective.trim());
        return { targetId, root: res.root_execution_id, pending: false };
      } catch (error) {
        setStage("ORCHESTRATION_START_FAILED");
        throw error;
      }
    },
    onSuccess: ({ targetId, root, pending }) => {
      const go = () => {
        onClose();
        // Sin análisis todavía: se abre el expediente, que es donde el abogado ve el
        // estado real de sus documentos y puede iniciar el análisis cuando estén listos.
        navigate(
          root ? `/casos/${targetId}?analisis=${root}` : `/casos/${targetId}?documentos=procesando`,
        );
      };
      /*
        SI FALTA ALGO, NO SE PASA DE PANTALLA.

        Cerrar el modal y navegar al expediente es exactamente lo que convirtió la
        pérdida de siete documentos en algo que el abogado descubrió al llegar a la
        vista y contar filas. Cuando el servidor aceptó menos de lo que se le mandó, la
        navegación espera a que lo haya leído.
      */
      if (uploadAccounting !== null && uploadAccounting.accepted < uploadAccounting.requested) {
        setContinueTo(root ? `/casos/${targetId}?analisis=${root}` : `/casos/${targetId}?documentos=procesando`);
        return;
      }
      if (still || pending) go();
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
                          ? "Se creará el expediente antes de analizar."
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
                    Adjuntos. Se incorporan al expediente y entran al pipeline
                    documental. El almacenamiento es infraestructura de IUSIA y no se
                    nombra en la experiencia del abogado.
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
                        addFiles(e.dataTransfer.files);
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
                        onChange={(e) => {
                          addFiles(e.target.files);
                          e.target.value = "";
                        }}
                      />

                      {limitNotice ? (
                        <p
                          role="alert"
                          className="mt-2.5 rounded-[8px] border border-iusia-warning/35 bg-iusia-warning/10 px-3 py-2 text-[12.5px] leading-relaxed text-iusia-warning-text"
                        >
                          {limitNotice}
                        </p>
                      ) : null}
                      {formatNotices.map((notice) => (
                        <p
                          key={notice}
                          role="alert"
                          className="mt-2.5 rounded-[8px] border border-iusia-warning/35 bg-iusia-warning/10 px-3 py-2 text-[12.5px] leading-relaxed text-iusia-warning-text"
                        >
                          {notice}
                        </p>
                      ))}
                      <FileSelectionSummary
                        files={files}
                        totalBytes={totalBytes}
                        expanded={showAllFiles}
                        onToggle={() => setShowAllFiles((v) => !v)}
                        onRemove={removeFile}
                      />

                      {/* El destino de esos archivos, dicho antes de adjuntarlos. */}
                      <p className="mt-3 flex items-start gap-2 text-[12px] leading-snug text-iusia-mist-text">
                        <FolderTree size={13} className="mt-0.5 shrink-0" aria-hidden />
                        <span>
                          Se incorporarán al expediente, separados de lo que genere
                          IUSIA, y quedarán disponibles para el análisis en cuanto
                          terminen de procesarse.
                        </span>
                      </p>
                    </div>
                  </div>

                  {duplicate ? (
                    <div
                      role="alert"
                      className="mt-3 rounded-[10px] border border-iusia-gold/40 bg-iusia-gold/8 px-3.5 py-3"
                    >
                      <p className="text-[13px] font-medium text-iusia-navy">
                        Ya existe un expediente que parece corresponder a este asunto:
                      </p>
                      <p className="mt-1 text-[12.5px] text-iusia-mist-text">
                        <span className="tnum">{duplicate.reference}</span> — {duplicate.title}
                      </p>
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => {
                            onClose();
                            navigate(`/casos/${duplicate.matter_id}`);
                          }}
                        >
                          Abrir expediente existente
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setDuplicate(null);
                            // Otro asunto es otra convocatoria: identidad nueva.
                            setRequestKey(crypto.randomUUID());
                            start.mutate({ confirmDifferent: true });
                          }}
                        >
                          Es un asunto diferente
                        </Button>
                      </div>
                    </div>
                  ) : continueTo !== null && uploadAccounting !== null ? (
                    /*
                      No todo lo que se mandó entró. Se dice aquí, con nombres, antes de
                      pasar de pantalla: el expediente ya existe y los documentos que sí
                      entraron están a salvo, pero la diferencia no puede quedar en que
                      el abogado cuente filas y saque conclusiones.
                    */
                    <div role="status" className="mt-3">
                      <p className="text-[13px] leading-relaxed text-iusia-carbon">
                        {uploadAccountingStatement(uploadAccounting)}
                      </p>
                      <div className="mt-2.5">
                        <Button
                          onClick={() => {
                            onClose();
                            navigate(continueTo);
                          }}
                        >
                          Abrir expediente
                        </Button>
                      </div>
                    </div>
                  ) : start.error ? (
                    <div role="alert" className="mt-3">
                      <p className="text-[13px] text-iusia-critical">
                        {convocationErrorCopy(stage ?? "TEMPORARY_SERVICE_FAILURE", Boolean(createdMatterId)).message}
                      </p>
                      {createdMatterId ? (
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          <Button variant="secondary" onClick={() => start.mutate({})}>
                            Reintentar
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              onClose();
                              navigate(`/casos/${createdMatterId}`);
                            }}
                          >
                            Abrir expediente
                          </Button>
                        </div>
                      ) : null}
                    </div>
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
                <Button onClick={() => start.mutate({})} disabled={!canStart}>
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
