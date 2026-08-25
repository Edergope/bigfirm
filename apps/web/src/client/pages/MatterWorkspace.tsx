import { useState, type FormEvent, type ReactNode } from "react";
import { useParams, useSearchParams, Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  Select,
  Input,
  MatterStatusChip,
  RiskIndicator,
  Skeleton,
  StateBlock,
  StatusChip,
} from "@iusia/ui";
import {
  Module,
  activityEvent,
  activityOutcome,
  documentClassLabel,
  documentStatusTerm,
  isLegalActivity,
  materialityTerm,
  riskTerm,
} from "@iusia/ui";
import { motion } from "motion/react";
import {
  Brain,
  Check,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  Scale,
  ShieldAlert,
  Users,
} from "lucide-react";
import type { RiskLevel } from "@iusia/domain";
import {
  api,
  ApiError,
  type CaseBriefData,
  type MatterDetail,
  type TaskRow as TaskRow_,
} from "../api.js";
import { authClient } from "../auth-client.js";
import { MatterOrchestration } from "./MatterOrchestration.js";

const TABS = [
  { id: "resumen", label: "Resumen" },
  { id: "documentos", label: "Documentos" },
  { id: "hechos", label: "Hechos y fuentes" },
  { id: "tareas", label: "Tareas y términos" },
  { id: "estrategia", label: "Análisis IUSIA" },
  { id: "actividad", label: "Actividad" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/**
 * Cuántos elementos hay detrás de cada pestaña.
 *
 * Sin esto, saber si un expediente tiene prueba cargada o hechos establecidos
 * obliga a abrir pestañas una por una. Sólo se cuentan las secciones cuyo
 * contenido ya viene en el detalle: "Tareas y términos" se carga aparte y no se
 * anota con un número que podría estar desactualizado.
 */
function tabCount(id: TabId, data: MatterDetail): number | null {
  switch (id) {
    case "documentos":
      return data.documents.length;
    case "hechos":
      return data.facts.length + data.authorities.length;
    case "actividad":
      return data.activity.length;
    default:
      return null;
  }
}

const TERMINAL_EXECUTION = new Set(["COMPLETED", "FAILED", "CANCELLED", "BLOCKED"]);

/** Icono por naturaleza del hecho: clasifica de un vistazo sin leer la etiqueta. */
const ACTIVITY_ICON = {
  analysis: Brain,
  document: FileText,
  matter: Scale,
  people: Users,
  access: ShieldAlert,
  system: ShieldAlert,
} as const;

const ACTIVITY_CHIP: Record<string, string> = {
  analysis: "bg-iusia-intel/15 text-iusia-intel-text",
  document: "bg-iusia-navy/8 text-iusia-navy",
  matter: "bg-iusia-gold/15 text-iusia-gold-text",
  people: "bg-iusia-success/12 text-iusia-success-text",
  access: "bg-iusia-mist/20 text-iusia-mist-text",
  system: "bg-iusia-mist/20 text-iusia-mist-text",
};

/** Dato de cabecera: rótulo pequeño arriba, valor debajo. */
function MatterFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.07em] text-iusia-mist-text">
        {label}
      </dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

/** El papel de cada persona EN ESTE expediente, en el idioma del despacho. */
const MATTER_ROLE_LABELS: Record<string, string> = {
  OWNER: "Responsable",
  COLLABORATOR: "Colabora",
  REVIEWER: "Revisa",
  ASSISTANT: "Apoya",
  EXTERNAL: "Externo",
  READ_ONLY: "Sólo lectura",
};
function matterRoleLabel(role: string): string {
  return MATTER_ROLE_LABELS[role] ?? role;
}

export function MatterWorkspace() {
  const { matterId = "" } = useParams();
  // Llegar con `?analisis=` significa "llévame a esa experiencia": abrir el
  // expediente en Resumen obligaría a buscarla a mano.
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<TabId>(
    searchParams.has("analisis") ? "estrategia" : "resumen",
  );
  const detail = useQuery({
    queryKey: ["matter", matterId],
    queryFn: () => api.getMatter(matterId),
    enabled: matterId.length > 0,
  });

  if (detail.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <Card>
        <StateBlock
          kind="error"
          title="Expediente no disponible"
          hint={detail.error instanceof ApiError ? detail.error.message : "No fue posible cargar."}
        />
      </Card>
    );
  }
  const data = detail.data;
  const m = data.matter;
  // Una ejecución raíz no terminal significa que IUSIA sigue trabajando aquí.
  const runningAnalysis = data.executions.some(
    (e) => e.parentExecutionId === null && !TERMINAL_EXECUTION.has(e.status),
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="rounded-[16px] border border-iusia-line bg-iusia-paper px-5 py-4 shadow-[0_1px_2px_rgba(11,29,58,0.05)]">
        <Link
          to="/casos"
          className="text-[12.5px] text-iusia-mist-text transition-colors hover:text-iusia-action"
        >
          ← Cartera de casos
        </Link>
        <div className="mt-1.5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-iusia-navy">
              {m.title}
            </h1>
            <p className="mt-1 text-[13.5px] text-iusia-mist-text">
              <span className="tnum">{m.reference}</span>
              <span aria-hidden className="px-1.5">·</span>
              {m.clientName}
              <span aria-hidden className="px-1.5">·</span>
              {m.jurisdiction}
            </p>
          </div>
          {/* Lo que decide cómo se trata este caso, junto y a la vista. */}
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <MatterFact label="Estado">
              <MatterStatusChip status={m.status} />
            </MatterFact>
            <MatterFact label="Criticidad">
              <StatusChip
                label={materialityTerm(m.materiality).label}
                tone={materialityTerm(m.materiality).tone}
                title={materialityTerm(m.materiality).hint}
              />
            </MatterFact>
            <MatterFact label="Riesgo">
              {m.riskLevel === "UNASSESSED" || !m.riskRationale ? (
                <span className="text-[13px] text-iusia-mist-text">Sin evaluar</span>
              ) : (
                <StatusChip
                  label={riskTerm(m.riskLevel).label}
                  tone={riskTerm(m.riskLevel).tone}
                  title={m.riskRationale}
                  dot
                />
              )}
            </MatterFact>
            <MatterFact label="Responsable">
              <span className="text-[13.5px] text-iusia-carbon">
                {data.members.find((x) => x.role === "OWNER")?.name ?? "Sin asignar"}
              </span>
            </MatterFact>
          </dl>
        </div>
      </header>

      {data.access.via_supervision ? (
        <div className="rounded-[10px] border border-iusia-action/25 bg-iusia-action/5 px-4 py-2.5 text-[13.5px] text-iusia-action">
          Acceso por supervisión de dirección, no por asignación — registrado en la auditoría.
        </div>
      ) : null}

      <div role="tablist" aria-label="Secciones del expediente" className="flex gap-0.5 border-b border-iusia-line">
        {TABS.map((t) => {
          const selected = tab === t.id;
          const count = tabCount(t.id, data);
          const live = t.id === "estrategia" && runningAnalysis;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                e.preventDefault();
                const i = TABS.findIndex((x) => x.id === tab);
                const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : (i - 1 + TABS.length) % TABS.length;
                setTab(TABS[next]!.id);
              }}
              className={
                "relative px-3.5 py-2.5 text-[13.5px] transition-colors duration-[var(--motion-fast)] " +
                (selected
                  ? "font-medium text-iusia-navy"
                  : "text-iusia-mist-text hover:text-iusia-carbon")
              }
            >
              {selected ? (
                <motion.span
                  layoutId="matter-tab"
                  aria-hidden
                  className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-iusia-action"
                  transition={{ type: "spring", stiffness: 420, damping: 38 }}
                />
              ) : null}
              <span className="flex items-center gap-1.5">
                {t.label}
                {count !== null && count > 0 ? (
                  <span className="rounded-full bg-iusia-mist/20 px-1.5 py-px text-[12px] font-medium tabular-nums text-iusia-mist-text">
                    {count}
                  </span>
                ) : null}
                {live ? (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-iusia-intel motion-safe:animate-pulse"
                    title="IUSIA está analizando este expediente"
                    aria-label="IUSIA está analizando este expediente"
                  />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "resumen" ? <Resumen matterId={matterId} data={data} /> : null}
        {tab === "documentos" ? <Documentos data={data} /> : null}
        {tab === "hechos" ? <Hechos data={data} /> : null}
        {tab === "tareas" ? <Tareas matterId={matterId} /> : null}
        {tab === "estrategia" ? <Estrategia matterId={matterId} data={data} /> : null}
        {tab === "actividad" ? <Actividad data={data} /> : null}
      </div>
    </div>
  );
}

function Resumen({ matterId, data }: { matterId: string; data: MatterDetail }) {
  const brief = useQuery({
    queryKey: ["brief", matterId],
    queryFn: () => api.caseBrief(matterId),
  });
  const b: CaseBriefData | undefined = brief.data?.brief;

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-2">
        {/* El encargo es la pieza narrativa del expediente: lo primero que alguien
            necesita leer para entender de qué va este caso. */}
        <Module eyebrow="El encargo" title="Qué se nos pide">
          <p className="max-w-prose text-[15px] leading-relaxed text-iusia-carbon">
            {data.matter.objective ?? "Todavía no se ha registrado el objetivo de este encargo."}
          </p>
          {b && b.parties.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {b.parties.map((p, i) => (
                <StatusChip key={i} label={`${p.kind}: ${p.name}`} tone="neutral" />
              ))}
            </div>
          ) : null}
        </Module>

        <Module
          eyebrow="Preguntas abiertas"
          title="Qué queda por verificar"
          padded={false}
          action={
            (b?.open_questions.length ?? 0) > 0 ? (
              <StatusChip label={String(b?.open_questions.length)} tone="warning" />
            ) : null
          }
        >
          {brief.isLoading ? (
            <div className="px-5 pb-5">
              <Skeleton className="h-12" />
            </div>
          ) : (b?.open_questions.length ?? 0) === 0 ? (
            <p className="px-5 pb-5 text-[13.5px] text-iusia-mist-text">
              No hay hechos pendientes de verificar en este expediente.
            </p>
          ) : (
            <ul className="divide-y divide-iusia-line/70">
              {b?.open_questions.slice(0, 6).map((q, i) => (
                <li key={i} className="px-5 py-2.5 text-[13.5px] leading-snug text-iusia-carbon">
                  {q}
                </li>
              ))}
            </ul>
          )}
        </Module>
      </div>

      <div className="flex flex-col gap-4">
        <Module eyebrow="Exposición" title="Riesgo">
          <RiskIndicator
            level={data.matter.riskLevel as RiskLevel}
            rationale={data.matter.riskRationale}
          />
        </Module>

        <Module eyebrow="Situación" title="El expediente hoy" tone="ice">
          <dl className="space-y-2 text-[13px]">
            <Row label="Documentos" value={String(b?.document_count ?? data.documents.length)} />
            <Row label="Hechos establecidos" value={String(b?.facts.length ?? data.facts.length)} />
            <Row
              label="Fuentes jurídicas"
              value={String(b?.authorities.length ?? data.authorities.length)}
            />
            <Row label="Tareas abiertas" value={String(b?.open_task_count ?? "—")} />
            {/* "Ejecuciones IA 25✓ · 3✗ / 32" contaba el motor. Al abogado le importa
                cuántos análisis tiene disponibles, no la tasa de reintentos. */}
            <Row
              label="Análisis completados"
              value={String(
                b?.ai_executions.completed ?? data.executions.filter((e) => e.parentExecutionId).length,
              )}
            />
          </dl>
        </Module>

        <Module eyebrow="Quién trabaja aquí" title="Equipo del caso" padded={false}>
          {data.members.length === 0 ? (
            <p className="px-5 pb-5 text-[13px] text-iusia-mist-text">
              Nadie tiene acceso todavía.
            </p>
          ) : (
            <ul className="divide-y divide-iusia-line/70">
              {data.members.map((member) => (
                <li key={member.userId} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] text-iusia-carbon">
                      {member.name}
                    </span>
                    <span className="block truncate text-[12px] text-iusia-mist-text">
                      {member.email}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {member.delegatedByUserId ? <StatusChip label="Delegado" tone="info" /> : null}
                    <StatusChip label={matterRoleLabel(member.role)} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Module>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-iusia-mist-text">{label}</dt>
      <dd className="font-medium text-iusia-carbon tnum">{value}</dd>
    </div>
  );
}

/** Scope de SÓLO LECTURA de Drive. Se solicita aparte del inicio de sesión. */
const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

function Documentos({ data }: { data: MatterDetail }) {
  const integrations = useQuery({ queryKey: ["integrations"], queryFn: api.integrationsStatus });
  const driveStatus = useQuery({ queryKey: ["drive-status"], queryFn: api.driveStatus });
  const connected = driveStatus.data?.connected === true;

  /**
   * Autorización INCREMENTAL de Google Drive, separada del login: reutiliza
   * `linkSocial` de Better Auth pidiendo el scope adicional. El navegador va a
   * Google y vuelve; el frontend nunca ve tokens.
   */
  async function connectDrive() {
    await authClient.linkSocial({
      provider: "google",
      scopes: [DRIVE_READONLY_SCOPE],
      callbackURL: window.location.pathname,
    });
  }

  return (
    <Module
      title="Documentos del expediente"
      eyebrow={`${data.documents.length} ${data.documents.length === 1 ? "documento" : "documentos"}`}
      padded={false}
      action={
        driveStatus.isSuccess && !connected ? (
          <button
            type="button"
            onClick={() => void connectDrive()}
            className="text-[12.5px] font-medium text-iusia-action transition-colors hover:underline"
          >
            Autorizar acceso a Drive
          </button>
        ) : integrations.data ? (
          <StatusChip label="Drive autorizado" tone="success" dot />
        ) : null
      }
    >
      {data.documents.length === 0 ? (
        <div className="px-5 pb-5">
          <p className="text-[13.5px] text-iusia-carbon">
            Este expediente aún no tiene documentos.
          </p>
          <p className="mt-1 text-[12.5px] text-iusia-mist-text">
            IUSIA sólo cita como evidencia lo que esté incorporado al expediente.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-iusia-line/70">
          {data.documents.map((d) => {
            const st = documentStatusTerm(d.status);
            const Icon = documentIcon(d.mimeType, d.name);
            return (
              <li
                key={d.id}
                className="flex items-center gap-3.5 px-5 py-3 transition-colors hover:bg-iusia-ice/60"
              >
                {/* Icono por tipo real de archivo: el mismo glifo para todo obliga a
                    leer la extensión para saber qué se está mirando. */}
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-iusia-navy/8 text-iusia-navy"
                  aria-hidden
                >
                  <Icon size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-iusia-navy">
                    {d.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-iusia-mist-text">
                    {documentClassLabel(d.classification)}
                    <span aria-hidden className="px-1.5 text-iusia-mist">·</span>
                    Actualizado {new Date(d.updatedAt).toLocaleDateString("es-CO")}
                  </span>
                </span>
                <StatusChip label={st.label} tone={st.tone} title={st.hint} />
              </li>
            );
          })}
        </ul>
      )}
    </Module>
  );
}

/**
 * Icono por naturaleza del archivo. Se deriva del MIME y, si falta, de la
 * extensión: un documento sin MIME registrado sigue siendo un PDF para quien lo
 * mira. Del set que ya usa el producto; no se añade ninguna librería.
 */
function documentIcon(mimeType: string, name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const m = (mimeType || "").toLowerCase();
  if (m.includes("pdf") || ext === "pdf") return FileType;
  if (m.includes("image") || ["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return FileImage;
  if (m.includes("sheet") || m.includes("excel") || ["xlsx", "xls", "csv"].includes(ext))
    return FileSpreadsheet;
  if (m.includes("word") || m.includes("document") || ["docx", "doc"].includes(ext))
    return FileText;
  return File;
}

const CERTAINTY_LABEL: Record<string, string> = {
  "[F]": "Acreditado", "[A]": "Alegado", "[D]": "Documental", "[I]": "Inferido",
  "[C]": "Contradicho", "[U]": "No verificado", "[R]": "Referido", "[X]": "Descartado",
};

/** El grado de certeza no es decorativo: un hecho contradicho exige atención. */
const CERTAINTY_TONE: Record<string, string> = {
  "[F]": "success",
  "[D]": "success",
  "[A]": "info",
  "[R]": "neutral",
  "[I]": "warning",
  "[U]": "warning",
  "[C]": "critical",
  "[X]": "neutral",
};

/**
 * Hechos y fuentes del expediente.
 *
 * Se llamaban "Fact Ledger" y "Authority Ledger", y sus estados vacíos citaban al
 * "agente 01" y al "agente 03". Ese es el vocabulario del motor: le pide al abogado
 * conocer la arquitectura para entender su propio caso. IUSIA se presenta por lo
 * que hace —establecer hechos, contrastar normas—, nunca por el identificador de
 * quién lo hace.
 */
function Hechos({ data }: { data: MatterDetail }) {
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      <Module
        title="Hechos del expediente"
        eyebrow={`${data.facts.length} ${data.facts.length === 1 ? "hecho" : "hechos"}`}
        padded={false}
      >
        {data.facts.length === 0 ? (
          <div className="px-5 pb-5">
            <p className="text-[13.5px] text-iusia-carbon">Todavía no hay hechos establecidos.</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-iusia-mist-text">
              IUSIA extrae los hechos de los documentos del expediente y marca cuáles
              quedan acreditados y cuáles siguen siendo alegaciones.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-iusia-line/70">
            {data.facts.map((f) => (
              <li key={f.id} className="px-5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[14px] leading-snug text-iusia-carbon">{f.statement}</p>
                  <StatusChip
                    label={CERTAINTY_LABEL[f.certainty] ?? f.certainty}
                    tone={CERTAINTY_TONE[f.certainty] ?? "neutral"}
                  />
                </div>
                <p className="mt-1 text-[12px] text-iusia-mist-text">
                  Consta en {f.primarySource}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Module>

      <Module
        title="Fuentes jurídicas"
        eyebrow={`${data.authorities.length} ${data.authorities.length === 1 ? "fuente" : "fuentes"}`}
        padded={false}
      >
        {data.authorities.length === 0 ? (
          <div className="px-5 pb-5">
            <p className="text-[13.5px] text-iusia-carbon">
              Todavía no hay normas ni jurisprudencia registradas.
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-iusia-mist-text">
              IUSIA contrasta el marco normativo aplicable y sólo registra fuentes cuya
              vigencia puede verificar.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-iusia-line/70">
            {data.authorities.map((a) => (
              <li key={a.id} className="px-5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[14px] font-medium leading-snug text-iusia-navy">
                    {a.citation}
                  </p>
                  <StatusChip
                    label={a.status === "VERIFIED_CURRENT" ? "Vigente" : "Por verificar"}
                    tone={a.status === "VERIFIED_CURRENT" ? "success" : "warning"}
                    title={
                      a.status === "VERIFIED_CURRENT"
                        ? "IUSIA verificó que sigue vigente."
                        : "Su vigencia no ha podido confirmarse."
                    }
                  />
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-iusia-mist-text">
                  {a.ruleSummary}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Module>
    </div>
  );
}

/**
 * Tareas y términos del expediente.
 *
 * Era un formulario con un input, un botón "Añadir" y un vacío. El backend ya
 * distingue tarea de término procesal y calcula el vencimiento con su regla, pero
 * la vista no lo mostraba: presentaba lo mismo que un gestor de listas genérico.
 *
 * Aquí lo abierto y lo cerrado se separan —una tarea cerrada ya no compite por la
 * atención pero sigue siendo trazable—, y lo pendiente se ordena por urgencia. El
 * compositor es una sola línea integrada: crear una tarea es un gesto frecuente y
 * no merece un formulario que ocupe media pantalla.
 *
 * No se inventa ningún campo: sólo se muestran los que el servidor ya devuelve.
 */
function Tareas({ matterId }: { matterId: string }) {
  const queryClient = useQueryClient();
  const tasks = useQuery({ queryKey: ["tasks", matterId], queryFn: () => api.listTasks(matterId) });
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"TASK" | "PROCEDURAL_DEADLINE">("TASK");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["tasks", matterId] });
  const create = useMutation({
    mutationFn: () => api.createTask(matterId, { title, kind }),
    onSuccess: () => {
      setTitle("");
      void invalidate();
    },
  });
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: "COMPLETADA" | "PENDIENTE" }) =>
      api.setTaskStatus(matterId, v.id, v.status),
    onSuccess: () => void invalidate(),
  });

  const all = tasks.data?.tasks ?? [];
  const open = all
    .filter((t) => t.status !== "COMPLETADA" && t.status !== "CANCELADA")
    .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
  const done = all.filter((t) => t.status === "COMPLETADA");

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
      <Module
        className="lg:col-span-2"
        eyebrow={open.length === 0 ? "Nada pendiente" : `${open.length} pendientes`}
        title="Tareas y términos"
        padded={false}
      >
        {/* Compositor de una línea: crear es frecuente, no ceremonial. */}
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (title.trim()) create.mutate();
          }}
          className="flex flex-wrap items-center gap-2 px-5 pb-3"
        >
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Describe la tarea o el término…"
            aria-label="Nueva tarea o término"
            className="h-9 min-w-0 flex-1 rounded-[10px] text-[13.5px]"
          />
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            aria-label="Tipo"
            className="h-9 rounded-[10px] text-[13px]"
          >
            <option value="TASK">Tarea</option>
            <option value="PROCEDURAL_DEADLINE">Término procesal</option>
          </Select>
          <Button type="submit" size="sm" disabled={create.isPending || !title.trim()}>
            {create.isPending ? "Añadiendo…" : "Añadir"}
          </Button>
        </form>

        {tasks.isLoading ? (
          <div className="px-5 pb-5">
            <Skeleton className="h-12" />
          </div>
        ) : open.length === 0 ? (
          <p className="px-5 pb-5 text-[13px] text-iusia-mist-text">
            No hay nada pendiente en este expediente.
          </p>
        ) : (
          <ul className="divide-y divide-iusia-line/70">
            {open.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                onToggle={() => setStatus.mutate({ id: t.id, status: "COMPLETADA" })}
                pending={setStatus.isPending}
              />
            ))}
          </ul>
        )}
      </Module>

      <Module
        tone="ice"
        eyebrow={`${done.length} ${done.length === 1 ? "cerrada" : "cerradas"}`}
        title="Completadas"
        padded={false}
      >
        {done.length === 0 ? (
          <p className="px-5 pb-5 text-[13px] text-iusia-mist-text">
            Lo que cierres queda aquí, con su registro.
          </p>
        ) : (
          <ul className="divide-y divide-iusia-line/60">
            {done.slice(0, 8).map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <span className="min-w-0 truncate text-[13px] text-iusia-mist-text line-through decoration-iusia-mist/60">
                  {t.title}
                </span>
                <button
                  type="button"
                  onClick={() => setStatus.mutate({ id: t.id, status: "PENDIENTE" })}
                  disabled={setStatus.isPending}
                  className="shrink-0 text-[12px] font-medium text-iusia-action transition-colors hover:underline disabled:opacity-50"
                >
                  Reabrir
                </button>
              </li>
            ))}
          </ul>
        )}
      </Module>
    </div>
  );
}

/**
 * Una obligación abierta. El término procesal se distingue de la tarea porque su
 * incumplimiento tiene consecuencia jurídica, y por eso lleva su regla de cómputo a
 * la vista: una fecha sin regla no es un término, es un recordatorio.
 */
function TaskRow({
  task: t,
  onToggle,
  pending,
}: {
  task: TaskRow_;
  onToggle: () => void;
  pending: boolean;
}) {
  const due = t.dueAt ? new Date(t.dueAt) : null;
  const days = due ? Math.ceil((due.getTime() - Date.now()) / 86_400_000) : null;
  const overdue = days !== null && days < 0;
  const isDeadline = t.kind === "PROCEDURAL_DEADLINE";

  return (
    <li className="group flex items-center gap-3.5 px-5 py-3 transition-colors duration-[var(--motion-fast)] hover:bg-iusia-ice/70">
      <button
        type="button"
        onClick={onToggle}
        disabled={pending}
        aria-label={`Marcar "${t.title}" como completada`}
        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-iusia-mist-strong transition-all duration-[var(--motion-fast)] hover:border-iusia-success hover:bg-iusia-success/10 disabled:opacity-50"
      >
        <Check
          size={11}
          strokeWidth={3}
          aria-hidden
          className="text-iusia-success opacity-0 transition-opacity duration-[var(--motion-fast)] group-hover:opacity-60"
        />
      </button>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] text-iusia-carbon">{t.title}</span>
        {isDeadline && t.deadlineRule ? (
          <span className="block truncate text-[12px] text-iusia-mist-text">
            {t.deadlineRule}
            {t.deadlineSource ? ` · ${t.deadlineSource}` : ""}
          </span>
        ) : null}
      </span>

      {isDeadline ? <StatusChip label="Término" tone="warning" /> : null}

      {due ? (
        <span className="shrink-0 text-right">
          <span
            className={
              "block text-[12.5px] tnum " +
              (overdue ? "font-medium text-iusia-critical" : "text-iusia-carbon")
            }
          >
            {due.toLocaleDateString("es-CO")}
          </span>
          <span className="block text-[11px] text-iusia-mist-text">
            {days !== null && days < 0
              ? `${Math.abs(days)} d de retraso`
              : days === 0
                ? "vence hoy"
                : `en ${days} d`}
          </span>
        </span>
      ) : (
        <span className="shrink-0 text-[12px] text-iusia-mist-text">Sin fecha</span>
      )}
    </li>
  );
}

function Estrategia({ matterId, data }: { matterId: string; data: MatterDetail }) {
  return <MatterOrchestration matterId={matterId} data={data} />;
}

/**
 * Actividad del expediente como línea de tiempo jurídica.
 *
 * Antes era un log: `agent.execution.completed / execution / SUCCESS`. Eso es el
 * registro de auditoría —correcto como registro, ilegible como historia—. Aquí se
 * cuenta QUÉ pasó en el caso, agrupado por día, con un icono que clasifica el hecho
 * y el desenlace en lenguaje jurídico.
 *
 * La telemetría de acceso (consultas de cartera, alcance de dirección) se excluye:
 * son miles de registros frente a decenas de hechos reales, y mezclarlos entierra
 * la actividad del expediente. Siguen en el ledger y en la auditoría de sistema.
 */
function Actividad({ data }: { data: MatterDetail }) {
  const [showAccess, setShowAccess] = useState(false);

  const all = data.activity;
  const legal = all.filter((a) => isLegalActivity(a.action));
  const rows = showAccess ? all : legal;
  const hidden = all.length - legal.length;

  // Agrupación por día: una fecha repetida en cada fila es ruido; como encabezado
  // da estructura a la lectura.
  const byDay = new Map<string, typeof rows>();
  for (const a of rows) {
    const day = new Date(a.occurredAt).toLocaleDateString("es-CO", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    byDay.set(day, [...(byDay.get(day) ?? []), a]);
  }

  return (
    <Module
      title="Actividad del expediente"
      eyebrow="Qué ha ocurrido"
      padded={false}
      action={
        hidden > 0 ? (
          <button
            type="button"
            onClick={() => setShowAccess((v) => !v)}
            className="text-[12.5px] font-medium text-iusia-action transition-colors hover:underline"
          >
            {showAccess ? "Ocultar consultas" : `Incluir ${hidden} consultas de acceso`}
          </button>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <p className="px-5 pb-5 text-[13.5px] text-iusia-mist-text">
          Todavía no hay actividad registrada en este expediente.
        </p>
      ) : (
        <div className="max-w-3xl px-5 pb-5">
          {[...byDay.entries()].map(([day, events]) => (
            <section key={day} className="mt-4 first:mt-0">
              <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-iusia-mist-text">
                {day}
              </h3>
              <ul className="relative">
                {/* Hilo temporal: una línea continua detrás de los puntos. */}
                <span
                  aria-hidden
                  className="absolute bottom-3 left-[9px] top-3 w-px bg-iusia-line"
                />
                {events.map((a) => {
                  const ev = activityEvent(a.action);
                  const outcome = activityOutcome(a.outcome);
                  const Icon = ACTIVITY_ICON[ev.kind];
                  return (
                    <li key={a.id} className="relative flex items-start gap-3 py-2 pl-0">
                      <span
                        className={
                          "relative z-10 mt-0.5 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full " +
                          ACTIVITY_CHIP[ev.kind]
                        }
                        aria-hidden
                      >
                        <Icon size={11} strokeWidth={2.2} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] text-iusia-carbon">{ev.label}</span>
                        {a.reason ? (
                          <span className="block truncate text-[12px] text-iusia-mist-text">
                            {a.reason}
                          </span>
                        ) : null}
                      </span>
                      {/* Un desenlace que sólo confirma lo obvio no se pinta: "Análisis
                          completado · Completado" es redundancia, no información. */}
                      {a.outcome !== "SUCCESS" && a.outcome !== "ALLOWED" ? (
                        <StatusChip label={outcome.label} tone={outcome.tone} />
                      ) : null}
                      <time
                        className="shrink-0 text-[12px] tnum text-iusia-mist-text"
                        dateTime={a.occurredAt}
                        title={new Date(a.occurredAt).toLocaleString("es-CO")}
                      >
                        {new Date(a.occurredAt).toLocaleTimeString("es-CO", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Module>
  );
}

