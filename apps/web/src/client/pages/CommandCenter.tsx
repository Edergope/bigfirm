import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardHeader,
  Drawer,
  KpiTile,
  PageHeader,
  Skeleton,
  StateBlock,
  StatusChip,
} from "@iusia/ui";
import { AlertTriangle, CalendarClock, Clock, Scale } from "lucide-react";
import { api, type MeResponse } from "../api.js";
import { useActiveAnalyses } from "../hooks/use-active-analyses.js";

/**
 * Centro de mando de la dirección.
 *
 * Responde a las preguntas que se hace quien dirige la firma: qué está pasando, qué
 * exige decisión y dónde está el riesgo. Cada indicador es una PUERTA, no un adorno:
 * abre el detalle que lo sustenta. No se muestra ninguna métrica que el sistema no
 * pueda respaldar con datos reales.
 */
export function CommandCenter({ me }: { me: MeResponse }) {
  const [drill, setDrill] = useState<null | "matters" | "risk" | "overdue" | "upcoming" | "inactive">(null);
  const firm = true;

  const health = useQuery({ queryKey: ["intel", "health", firm], queryFn: () => api.intelligence.caseHealth(firm) });
  const risks = useQuery({ queryKey: ["intel", "risks", firm], queryFn: () => api.intelligence.risks(firm) });
  const inactive = useQuery({ queryKey: ["intel", "inactive", firm], queryFn: () => api.intelligence.inactive(firm) });
  const overdue = useQuery({ queryKey: ["intel", "overdue", firm], queryFn: () => api.intelligence.overdue(firm) });
  const upcoming = useQuery({ queryKey: ["intel", "upcoming", firm], queryFn: () => api.intelligence.upcoming(firm, 15) });
  const matters = useQuery({ queryKey: ["matters"], queryFn: api.listMatters });
  const workload = useQuery({ queryKey: ["intel", "workload"], queryFn: api.intelligence.workload });
  const { analyses, count: activeCount } = useActiveAnalyses();

  const loading = health.isLoading || matters.isLoading;
  const riskCount = risks.data?.risks.length ?? 0;
  const overdueCount = overdue.data?.tasks.length ?? 0;
  const upcomingCount = upcoming.data?.deadlines.length ?? 0;
  const inactiveCount = inactive.data?.matters.length ?? 0;

  const recommendations = buildRecommendations({
    overdue: overdueCount,
    upcoming: upcomingCount,
    risks: riskCount,
    inactive: inactiveCount,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Buen día, ${me.user.name.split(" ")[0] ?? me.user.name}`}
        description="Dirección de la firma — visión transversal de la cartera."
        actions={<StatusChip label="Alcance: firma" tone="info" dot />}
      />

      {/* Indicadores accionables: cada uno abre la lista que lo sustenta. */}
      {loading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[92px]" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <DrillKpi
            label="Expedientes activos"
            value={health.data?.total ?? 0}
            onOpen={() => setDrill("matters")}
          />
          <DrillKpi
            label="Riesgo alto o crítico"
            value={health.data?.at_risk ?? 0}
            tone={(health.data?.at_risk ?? 0) > 0 ? "critical" : "navy"}
            onOpen={() => setDrill("risk")}
          />
          <DrillKpi
            label="Términos vencidos"
            value={overdueCount}
            tone={overdueCount > 0 ? "critical" : "navy"}
            onOpen={() => setDrill("overdue")}
          />
          <DrillKpi
            label="Vencen en 15 días"
            value={upcomingCount}
            tone={upcomingCount > 0 ? "warning" : "navy"}
            onOpen={() => setDrill("upcoming")}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          {/* IUSIA recomienda: derivación determinista de datos reales, sin LLM. */}
          <Card>
            <CardHeader
              title="IUSIA recomienda revisar"
              subtitle="Derivado de los términos, riesgos y actividad reales del expediente"
            />
            {recommendations.length === 0 ? (
              <StateBlock
                kind="empty"
                title="Nada que reclame tu atención"
                hint="Sin términos vencidos, riesgos abiertos ni expedientes detenidos."
              />
            ) : (
              <ul className="divide-y divide-iusia-mist/20">
                {recommendations.map((r) => (
                  <li key={r.key} className="flex items-center justify-between gap-4 px-6 py-3.5">
                    <span className="flex min-w-0 items-start gap-3">
                      <r.icon size={17} className={r.iconClass} aria-hidden />
                      <span className="min-w-0">
                        <span className="block text-[14.5px] text-iusia-carbon">{r.title}</span>
                        <span className="block text-[12.5px] text-iusia-mist-text">{r.detail}</span>
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setDrill(r.drill)}
                      className="shrink-0 text-[13px] font-medium text-iusia-action hover:underline"
                    >
                      Revisar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Operación: estado real de la cartera. */}
          <Card>
            <CardHeader title="Operación jurídica" subtitle="Distribución de la cartera por estado" />
            <div className="px-6 py-5">
              {Object.keys(health.data?.by_status ?? {}).length === 0 ? (
                <StateBlock kind="empty" title="Sin expedientes" />
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {Object.entries(health.data?.by_status ?? {}).map(([status, n]) => {
                    const total = health.data?.total || 1;
                    const pct = Math.round((n / total) * 100);
                    return (
                      <li key={status} className="flex items-center gap-3">
                        <span className="w-36 shrink-0 truncate text-[13.5px] text-iusia-carbon">
                          {status}
                        </span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-iusia-mist/20">
                          <span
                            className="block h-full rounded-full bg-iusia-action/70"
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                        <span className="w-14 shrink-0 text-right text-[13px] tabular-nums text-iusia-mist-text">
                          {n} · {pct}%
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {inactiveCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setDrill("inactive")}
                  className="mt-4 text-[13px] font-medium text-iusia-action hover:underline"
                >
                  {inactiveCount} expediente{inactiveCount === 1 ? "" : "s"} sin actividad reciente
                </button>
              ) : null}
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          {/* IUSIA: actividad real de la inteligencia artificial. */}
          <Card>
            <CardHeader title="IUSIA" subtitle="Actividad de la inteligencia jurídica" />
            <div className="px-6 py-5">
              <dl className="space-y-2.5 text-[13.5px]">
                <Row label="Análisis en curso" value={String(activeCount)} />
                <Row label="Créditos disponibles" value={me.credits.toLocaleString("es-CO")} />
              </dl>
              {activeCount > 0 ? (
                <ul className="mt-4 space-y-2 border-t border-iusia-mist/20 pt-3">
                  {analyses.slice(0, 3).map((a) => (
                    <li key={a.root_execution_id}>
                      <Link
                        to={`/casos/${a.matter_id}`}
                        className="block truncate text-[13px] text-iusia-action hover:underline"
                      >
                        {a.matter_title}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Link
                to="/iusia"
                className="mt-4 inline-block text-[13px] font-medium text-iusia-action hover:underline"
              >
                Ver toda la actividad de IUSIA
              </Link>
            </div>
          </Card>

          {/* Equipo: carga real por persona (endpoint de dirección). */}
          <Card>
            <CardHeader title="Equipo" subtitle="Carga de trabajo abierta" />
            {workload.isLoading ? (
              <div className="p-5"><Skeleton className="h-20" /></div>
            ) : (workload.data?.workload.length ?? 0) === 0 ? (
              <StateBlock kind="empty" title="Sin tareas asignadas" hint="Nadie tiene trabajo pendiente registrado." />
            ) : (
              <ul className="divide-y divide-iusia-mist/20">
                {workload.data?.workload.slice(0, 6).map((w) => (
                  <li key={w.assignedTo ?? "sin"} className="flex items-center justify-between px-6 py-2.5">
                    <span className="truncate font-mono text-[12px] text-iusia-mist-text">
                      {w.assignedTo ?? "Sin asignar"}
                    </span>
                    <span className="text-[13px] tabular-nums text-iusia-carbon">
                      {w.openTasks} abiertas
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="px-6 pb-4">
              <Link to="/equipo" className="text-[13px] font-medium text-iusia-action hover:underline">
                Administrar equipo
              </Link>
            </div>
          </Card>
        </div>
      </div>

      {/* Drill-downs: el indicador abre exactamente los registros que lo componen. */}
      <Drawer open={drill === "matters"} onClose={() => setDrill(null)} title="Expedientes activos">
        <MatterList rows={(matters.data?.matters ?? []).map((m) => ({ id: m.id, title: m.title, hint: `${m.reference} · ${m.clientName}` }))} />
      </Drawer>
      <Drawer open={drill === "risk"} onClose={() => setDrill(null)} title="Riesgo alto o crítico">
        {riskCount === 0 ? (
          <StateBlock kind="empty" title="Sin riesgos registrados" hint="El riesgo se muestra sólo con metodología registrada." />
        ) : (
          <MatterList
            rows={(risks.data?.risks ?? []).map((r) => ({
              id: r.matter_id,
              title: r.title,
              hint: r.rationale ?? r.risk_level,
              chip: r.risk_level,
            }))}
          />
        )}
      </Drawer>
      <Drawer open={drill === "overdue"} onClose={() => setDrill(null)} title="Términos vencidos">
        <MatterList
          rows={(overdue.data?.tasks ?? []).map((t) => ({
            id: t.matter_id,
            title: t.title,
            hint: t.due_at ? `Venció el ${new Date(t.due_at).toLocaleDateString("es-CO")}` : t.kind,
          }))}
        />
      </Drawer>
      <Drawer open={drill === "upcoming"} onClose={() => setDrill(null)} title="Vencen en los próximos 15 días">
        <MatterList
          rows={(upcoming.data?.deadlines ?? []).map((d) => ({
            id: d.matter_id,
            title: d.title,
            hint: d.due_at ? new Date(d.due_at).toLocaleDateString("es-CO") : (d.rule ?? ""),
          }))}
        />
      </Drawer>
      <Drawer open={drill === "inactive"} onClose={() => setDrill(null)} title="Expedientes sin actividad">
        <MatterList
          rows={(inactive.data?.matters ?? []).map((m) => ({
            id: m.matter_id,
            title: m.title,
            hint: `Última actividad: ${new Date(m.updated_at).toLocaleDateString("es-CO")}`,
          }))}
        />
      </Drawer>
    </div>
  );
}

/** Indicador que abre su propio detalle. Un número sin salida no sirve para decidir. */
function DrillKpi({
  label,
  value,
  tone,
  onOpen,
}: {
  label: string;
  value: number;
  tone?: "success" | "critical" | "navy" | "warning";
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${label}: ${value}. Ver detalle.`}
      className="rounded-[12px] text-left transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iusia-action/50 active:scale-[0.99]"
    >
      <KpiTile label={label} value={String(value)} tone={tone} hint="Ver detalle" />
    </button>
  );
}

function MatterList({
  rows,
}: {
  rows: Array<{ id: string; title: string; hint?: string; chip?: string }>;
}) {
  if (rows.length === 0) {
    return <StateBlock kind="empty" title="Nada que mostrar" />;
  }
  return (
    <ul className="divide-y divide-iusia-mist/20">
      {rows.map((r, i) => (
        <li key={`${r.id}-${i}`} className="px-1 py-3">
          <Link to={`/casos/${r.id}`} className="flex items-start justify-between gap-3 hover:underline">
            <span className="min-w-0">
              <span className="block truncate text-[14.5px] text-iusia-carbon">{r.title}</span>
              {r.hint ? (
                <span className="block truncate text-[12.5px] text-iusia-mist-text">{r.hint}</span>
              ) : null}
            </span>
            {r.chip ? <StatusChip label={r.chip} tone="critical" /> : null}
          </Link>
        </li>
      ))}
    </ul>
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

interface Recommendation {
  key: string;
  title: string;
  detail: string;
  drill: "risk" | "overdue" | "upcoming" | "inactive";
  icon: typeof AlertTriangle;
  iconClass: string;
}

/**
 * Recomendaciones DERIVADAS de datos reales, por reglas explícitas.
 * No se ejecuta ningún modelo para poblar el panel: lo que se muestra ya ocurrió.
 */
function buildRecommendations(counts: {
  overdue: number;
  upcoming: number;
  risks: number;
  inactive: number;
}): Recommendation[] {
  const out: Recommendation[] = [];
  if (counts.overdue > 0) {
    out.push({
      key: "overdue",
      title: `${counts.overdue} término${counts.overdue === 1 ? "" : "s"} vencido${counts.overdue === 1 ? "" : "s"}`,
      detail: "Un término vencido puede precluir el derecho: revísalos primero.",
      drill: "overdue",
      icon: AlertTriangle,
      iconClass: "mt-0.5 text-iusia-critical",
    });
  }
  if (counts.upcoming > 0) {
    out.push({
      key: "upcoming",
      title: `${counts.upcoming} término${counts.upcoming === 1 ? "" : "s"} en los próximos 15 días`,
      detail: "Conviene confirmar responsable y estado de preparación.",
      drill: "upcoming",
      icon: CalendarClock,
      iconClass: "mt-0.5 text-iusia-warning",
    });
  }
  if (counts.risks > 0) {
    out.push({
      key: "risk",
      title: `${counts.risks} expediente${counts.risks === 1 ? "" : "s"} con riesgo registrado`,
      detail: "Riesgo alto o crítico con justificación documentada.",
      drill: "risk",
      icon: Scale,
      iconClass: "mt-0.5 text-iusia-critical",
    });
  }
  if (counts.inactive > 0) {
    out.push({
      key: "inactive",
      title: `${counts.inactive} expediente${counts.inactive === 1 ? "" : "s"} sin actividad`,
      detail: "Sin movimiento en 30 días: puede haber trabajo detenido.",
      drill: "inactive",
      icon: Clock,
      iconClass: "mt-0.5 text-iusia-mist-text",
    });
  }
  return out;
}
