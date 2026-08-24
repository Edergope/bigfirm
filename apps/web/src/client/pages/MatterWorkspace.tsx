import { useState, type FormEvent } from "react";
import { useParams, Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  MatterStatusChip,
  PageHeader,
  RiskIndicator,
  Skeleton,
  StateBlock,
  StatusChip,
} from "@iusia/ui";
import type { RiskLevel } from "@iusia/domain";
import { api, ApiError, type CaseBriefData, type MatterDetail } from "../api.js";
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

export function MatterWorkspace() {
  const { matterId = "" } = useParams();
  const [tab, setTab] = useState<TabId>("resumen");
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

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={<Link to="/casos" className="hover:underline">← Casos</Link>}
        title={m.title}
        description={`${m.reference} · ${m.clientName} · ${m.jurisdiction}`}
        actions={
          <>
            <StatusChip
              label={m.materiality}
              tone={m.materiality === "HIGH_STAKES" ? "warning" : "neutral"}
            />
            <MatterStatusChip status={m.status} />
          </>
        }
      />

      {data.access.via_supervision ? (
        <div className="rounded-[10px] border border-iusia-action/25 bg-iusia-action/5 px-4 py-2.5 text-[13.5px] text-iusia-action">
          Acceso por supervisión de dirección, no por asignación — registrado en la auditoría.
        </div>
      ) : null}

      <div role="tablist" aria-label="Secciones del expediente" className="flex gap-0.5 border-b border-iusia-mist/30">
        {TABS.map((t) => {
          const selected = tab === t.id;
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
                selected
                  ? "-mb-px border-b-2 border-iusia-action px-3.5 py-2.5 text-[14px] font-medium text-iusia-navy"
                  : "px-3.5 py-2.5 text-[14px] text-iusia-mist-text transition-colors hover:text-iusia-carbon"
              }
            >
              {t.label}
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
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="flex flex-col gap-5 lg:col-span-2">
        <Card>
          <CardHeader title="Qué pasa" subtitle="Objetivo del encargo" />
          <div className="px-6 py-5">
            <p className="text-[15px] leading-relaxed text-iusia-carbon">
              {data.matter.objective ?? "Sin objetivo registrado para este expediente."}
            </p>
            {b && b.parties.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {b.parties.map((p, i) => (
                  <StatusChip key={i} label={`${p.kind}: ${p.name}`} tone="neutral" />
                ))}
              </div>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Qué recomienda IUSIA"
            subtitle="Preguntas abiertas derivadas del expediente"
          />
          {brief.isLoading ? (
            <div className="p-5">
              <Skeleton className="h-16" />
            </div>
          ) : (b?.open_questions.length ?? 0) === 0 ? (
            <StateBlock kind="empty" title="Sin preguntas abiertas" hint="No hay hechos por verificar." />
          ) : (
            <ul className="divide-y divide-iusia-mist/20">
              {b?.open_questions.slice(0, 6).map((q, i) => (
                <li key={i} className="px-6 py-3 text-[14px] text-iusia-carbon">
                  {q}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Equipo del caso" />
          {data.members.length === 0 ? (
            <StateBlock kind="empty" title="Sin miembros asignados" />
          ) : (
            <ul className="divide-y divide-iusia-mist/20">
              {data.members.map((member) => (
                <li key={member.userId} className="flex items-center justify-between px-6 py-3 text-[14px]">
                  <span className="font-mono text-[12.5px] text-iusia-mist-text">{member.userId}</span>
                  <span className="flex items-center gap-2">
                    {member.delegatedByUserId ? <StatusChip label="Delegado" tone="info" /> : null}
                    <StatusChip label={member.role} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="flex flex-col gap-5">
        <Card className="px-6 py-5">
          <p className="mb-3 text-[14px] font-semibold text-iusia-navy">Riesgo</p>
          <RiskIndicator
            level={data.matter.riskLevel as RiskLevel}
            rationale={data.matter.riskRationale}
          />
        </Card>

        <Card className="px-6 py-5">
          <p className="mb-3 text-[14px] font-semibold text-iusia-navy">Situación</p>
          <dl className="space-y-2.5 text-[13.5px]">
            <Row label="Documentos" value={String(b?.document_count ?? data.documents.length)} />
            <Row label="Hechos" value={String(b?.facts.length ?? data.facts.length)} />
            <Row label="Autoridades" value={String(b?.authorities.length ?? data.authorities.length)} />
            <Row label="Tareas abiertas" value={String(b?.open_task_count ?? "—")} />
            <Row
              label="Ejecuciones IA"
              value={
                b
                  ? `${b.ai_executions.completed}✓ · ${b.ai_executions.failed}✗ / ${b.ai_executions.total}`
                  : String(data.executions.filter((e) => e.parentExecutionId).length)
              }
            />
          </dl>
        </Card>
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

function Documentos({ data }: { data: MatterDetail }) {
  const integrations = useQuery({ queryKey: ["integrations"], queryFn: api.integrationsStatus });
  return (
    <Card>
      <CardHeader
        title="Expediente documental"
        subtitle="Los archivos viven en Google Drive; IUSIA administra metadata y estado."
        action={
          integrations.data ? (
            <StatusChip
              label={
                integrations.data.storage.status === "CONNECTED" ? "Drive conectado" : "Drive no conectado"
              }
              tone={integrations.data.storage.status === "CONNECTED" ? "success" : "warning"}
              dot
            />
          ) : null
        }
      />
      {data.documents.length === 0 ? (
        <StateBlock
          kind="not_configured"
          title="Sin documentos vinculados"
          hint="La vinculación con Google Drive Picker requiere OAuth aún no aprovisionado."
        />
      ) : (
        <ul className="divide-y divide-iusia-mist/20">
          {data.documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between px-6 py-3">
              <span className="min-w-0">
                <span className="block truncate text-[14.5px]">{d.name}</span>
                <span className="block text-[12.5px] text-iusia-mist-text">{d.classification}</span>
              </span>
              <StatusChip
                label={d.status}
                tone={d.status === "APROBADO" ? "success" : d.status === "CRITICO" ? "critical" : "neutral"}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const CERTAINTY_LABEL: Record<string, string> = {
  "[F]": "Acreditado", "[A]": "Alegado", "[D]": "Documental", "[I]": "Inferido",
  "[C]": "Contradicho", "[U]": "No verificado", "[R]": "Referido", "[X]": "Descartado",
};

function Hechos({ data }: { data: MatterDetail }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="Fact Ledger" subtitle="Base fáctica trazable" />
        {data.facts.length === 0 ? (
          <StateBlock kind="empty" title="Sin hechos" hint="El agente 01 establece la base fáctica." />
        ) : (
          <ul className="divide-y divide-iusia-mist/20">
            {data.facts.map((f) => (
              <li key={f.id} className="px-6 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[14.5px] leading-snug">{f.statement}</p>
                  <StatusChip label={CERTAINTY_LABEL[f.certainty] ?? f.certainty} />
                </div>
                <p className="mt-1 text-[12.5px] text-iusia-mist-text">Fuente: {f.primarySource}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Authority Ledger" subtitle="Normas y jurisprudencia verificables" />
        {data.authorities.length === 0 ? (
          <StateBlock kind="empty" title="Sin autoridades" hint="El agente 03 registra fuentes verificadas." />
        ) : (
          <ul className="divide-y divide-iusia-mist/20">
            {data.authorities.map((a) => (
              <li key={a.id} className="px-6 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[14.5px] font-medium">{a.citation}</p>
                  <StatusChip
                    label={a.status === "VERIFIED_CURRENT" ? "Vigente" : a.status}
                    tone={a.status === "VERIFIED_CURRENT" ? "success" : "warning"}
                  />
                </div>
                <p className="mt-1 text-[12.5px] text-iusia-mist-text">{a.ruleSummary}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Tareas({ matterId }: { matterId: string }) {
  const queryClient = useQueryClient();
  const tasks = useQuery({ queryKey: ["tasks", matterId], queryFn: () => api.listTasks(matterId) });
  const [title, setTitle] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["tasks", matterId] });
  const create = useMutation({
    mutationFn: () => api.createTask(matterId, { title }),
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

  return (
    <Card>
      <CardHeader title="Tareas y términos" subtitle="El cálculo jurídico de términos es propio de IUSIA" />
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (title.trim()) create.mutate();
        }}
        className="flex items-end gap-3 border-b border-iusia-mist/20 px-6 py-4"
      >
        <Field label="Nueva tarea" className="flex-1">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Describe la tarea…" />
        </Field>
        <Button type="submit" disabled={create.isPending || !title.trim()}>
          Añadir
        </Button>
      </form>
      {tasks.isLoading ? (
        <div className="p-5"><Skeleton className="h-10" /></div>
      ) : (tasks.data?.tasks.length ?? 0) === 0 ? (
        <StateBlock kind="empty" title="Sin tareas" hint="Añade una tarea o registra un término procesal." />
      ) : (
        <ul className="divide-y divide-iusia-mist/20">
          {tasks.data?.tasks.map((t) => (
            <li key={t.id} className="flex items-center justify-between px-6 py-3">
              <span className="min-w-0">
                <span className="block truncate text-[14.5px]">{t.title}</span>
                {t.deadlineRule ? (
                  <span className="block text-[12px] text-iusia-mist-text">
                    {t.deadlineRule} · {t.deadlineSource}
                  </span>
                ) : null}
              </span>
              <span className="flex items-center gap-3">
                {t.dueAt ? (
                  <time className="text-[12.5px] text-iusia-mist-text tnum">
                    {new Date(t.dueAt).toLocaleDateString("es-CO")}
                  </time>
                ) : null}
                {t.status === "COMPLETADA" ? (
                  <StatusChip label="Completada" tone="success" />
                ) : (
                  <StatusChip
                    label={t.kind === "PROCEDURAL_DEADLINE" ? "Término" : "Tarea"}
                    tone={t.kind === "PROCEDURAL_DEADLINE" ? "warning" : "neutral"}
                  />
                )}
                <button
                  type="button"
                  onClick={() =>
                    setStatus.mutate({
                      id: t.id,
                      status: t.status === "COMPLETADA" ? "PENDIENTE" : "COMPLETADA",
                    })
                  }
                  disabled={setStatus.isPending}
                  className="text-[13px] text-iusia-action hover:underline disabled:opacity-50"
                >
                  {t.status === "COMPLETADA" ? "Reabrir" : "Completar"}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Estrategia({ matterId, data }: { matterId: string; data: MatterDetail }) {
  return <MatterOrchestration matterId={matterId} data={data} />;
}

function Actividad({ data }: { data: MatterDetail }) {
  return (
    <Card>
      <CardHeader title="Auditoría del expediente" subtitle="Registro jurídico de decisiones y accesos" />
      {data.activity.length === 0 ? (
        <StateBlock kind="empty" title="Sin actividad registrada" />
      ) : (
        <ul className="divide-y divide-iusia-mist/20">
          {data.activity.map((a) => (
            <li key={a.id} className="flex items-center justify-between px-6 py-3">
              <span>
                <span className="block text-[14px]">{a.action}</span>
                <span className="block text-[12.5px] text-iusia-mist-text">
                  {a.resourceType}
                  {a.reason ? ` · ${a.reason}` : ""}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <StatusChip
                  label={a.outcome}
                  tone={a.outcome === "DENIED" || a.outcome === "FAILURE" ? "critical" : "success"}
                />
                <time className="text-[12.5px] tabular-nums text-iusia-mist-text">
                  {new Date(a.occurredAt).toLocaleString("es-CO")}
                </time>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
