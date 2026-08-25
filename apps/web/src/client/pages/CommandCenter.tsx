import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CountUp,
  DataBar,
  Drawer,
  Module,
  ScreenTitle,
  Skeleton,
  StateBlock,
  StatusChip,
  matterStatusTerm,
  riskTerm,
} from "@iusia/ui";
import { motion } from "motion/react";
import { AlertTriangle, CalendarClock, ChevronRight, Clock, Scale } from "lucide-react";
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
/** Bandas de la barra de operación. Tonos del ADN navy, no una paleta nueva. */
const STATUS_BAND = [
  "bg-iusia-navy",
  "bg-iusia-navy/65",
  "bg-iusia-intel/70",
  "bg-iusia-mist/70",
  "bg-iusia-gold/70",
];

/** Listas que sustentan cada indicador; abrir una es abrir sus registros reales. */
type Drill = null | "matters" | "risk" | "overdue" | "upcoming" | "inactive";

export function CommandCenter({ me }: { me: MeResponse }) {
  const [drill, setDrill] = useState<Drill>(null);
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
    <div className="pb-2">
      <ScreenTitle
        eyebrow="Dirección de la firma"
        title={`Buen día, ${me.user.name.split(" ")[0] ?? me.user.name}`}
        description="Visión transversal de la cartera, el riesgo y el trabajo de IUSIA."
      />

      {/*
        Composición asimétrica. La decisión pendiente ocupa el doble de ancho y todo
        el alto de la primera banda porque es lo único que puede cambiar el día de
        quien dirige; IUSIA la acompaña como módulo firma. Debajo, tres módulos de
        peso decreciente. Nada de rejillas de bloques idénticos.
      */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DecisionModule
            loading={loading}
            recommendations={recommendations}
            onDrill={setDrill}
            metrics={{
              total: health.data?.total ?? 0,
              risk: health.data?.at_risk ?? 0,
              overdue: overdueCount,
              upcoming: upcomingCount,
            }}
          />
        </div>

        <Module
          tone="signature"
          eyebrow="Inteligencia jurídica"
          title="IUSIA"
        >
          <p className="text-[13px] leading-relaxed text-white/55">
            Orquesta un equipo de especialistas sobre tus expedientes y sigue trabajando
            aunque cierres la vista.
          </p>
          <div className="mt-4 flex items-end gap-7">
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-white/40">
                En curso
              </p>
              <p className="mt-1 flex items-center gap-2 text-[28px] font-semibold leading-none tracking-[-0.02em] tnum text-white">
                <CountUp value={activeCount} />
                {activeCount > 0 ? (
                  <span className="relative flex h-2 w-2" aria-hidden>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-iusia-intel opacity-70 motion-reduce:animate-none" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-iusia-intel" />
                  </span>
                ) : null}
              </p>
            </div>
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-white/40">
                Créditos
              </p>
              <p className="mt-1 text-[28px] font-semibold leading-none tracking-[-0.02em] tnum text-white">
                <CountUp value={me.credits} />
              </p>
            </div>
          </div>

          {activeCount > 0 ? (
            <ul className="mt-4 space-y-1.5">
              {analyses.slice(0, 2).map((a) => (
                <li key={a.root_execution_id}>
                  <Link
                    to={`/casos/${a.matter_id}?analisis=${a.root_execution_id}`}
                    className="block truncate rounded-[8px] bg-white/[0.06] px-2.5 py-1.5 text-[12.5px] text-white/85 transition-colors hover:bg-white/[0.12]"
                  >
                    {a.matter_title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}

          <Link
            to="/iusia"
            className="mt-4 inline-block text-[12.5px] font-medium text-iusia-intel transition-opacity hover:opacity-80"
          >
            Ver actividad de IUSIA →
          </Link>
        </Module>
      </div>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-7">
        <Module title="Operación jurídica" eyebrow="Cartera por estado" className="lg:col-span-3">
          {Object.keys(health.data?.by_status ?? {}).length === 0 ? (
            <p className="py-4 text-[13.5px] text-iusia-mist-text">Sin expedientes todavía.</p>
          ) : (
            <>
              {/* Una sola barra apilada: la cartera se entiende por la PROPORCIÓN
                  entre estados, y tres barras independientes al 100 % cada una no
                  dejan verla. */}
              <div className="flex h-2.5 overflow-hidden rounded-full bg-iusia-ice">
                {Object.entries(health.data?.by_status ?? {}).map(([status, n], i) => (
                  <motion.span
                    key={status}
                    className={"origin-left " + STATUS_BAND[i % STATUS_BAND.length]}
                    style={{ width: `${(n / (health.data?.total || 1)) * 100}%` }}
                    title={`${matterStatusTerm(status).label}: ${n}`}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.62, ease: [0.22, 0.61, 0.36, 1], delay: i * 0.07 }}
                  />
                ))}
              </div>
              <ul className="mt-3.5 flex flex-col gap-2">
                {Object.entries(health.data?.by_status ?? {}).map(([status, n], i) => (
                  <li key={status} className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className={"h-2 w-2 shrink-0 rounded-full " + STATUS_BAND[i % STATUS_BAND.length]}
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-iusia-carbon">
                      {matterStatusTerm(status).label}
                    </span>
                    <span className="shrink-0 text-[12.5px] tnum text-iusia-mist-text">
                      {n} · {Math.round((n / (health.data?.total || 1)) * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {inactiveCount > 0 ? (
            <button
              type="button"
              onClick={() => setDrill("inactive")}
              className="mt-4 text-[12.5px] font-medium text-iusia-action hover:underline"
            >
              {inactiveCount} sin actividad reciente →
            </button>
          ) : null}
        </Module>

        <Module title="Riesgo" eyebrow="Expedientes expuestos" className="lg:col-span-2">
          {riskCount === 0 ? (
            <div className="flex h-full flex-col justify-center py-2">
              <p className="text-[13.5px] font-medium text-iusia-success-text">
                Ningún expediente con riesgo abierto.
              </p>
              <p className="mt-1 text-[12.5px] text-iusia-mist-text">
                El riesgo sólo se muestra con metodología registrada; sin ella el
                expediente aparece como no evaluado.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {(risks.data?.risks ?? []).slice(0, 4).map((r) => (
                <li key={r.matter_id}>
                  <Link
                    to={`/casos/${r.matter_id}`}
                    className="flex items-center justify-between gap-3 rounded-[10px] px-2.5 py-2 transition-colors hover:bg-iusia-ice"
                  >
                    <span className="min-w-0 truncate text-[13.5px] text-iusia-carbon">
                      {r.title}
                    </span>
                    <StatusChip
                      label={riskTerm(r.risk_level).label}
                      tone={riskTerm(r.risk_level).tone}
                      title={r.rationale ?? undefined}
                      dot
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Module>

        {/* Equipo pesa menos cuando no hay trabajo repartido: el espacio es finito y
            un panel vacío del tamaño de uno lleno miente sobre su importancia. */}
        <Module title="Equipo" eyebrow="Carga abierta" tone="ice" className="lg:col-span-2">
          {workload.isLoading ? (
            <Skeleton className="h-16" />
          ) : (workload.data?.workload.length ?? 0) === 0 ? (
            <p className="text-[13px] text-iusia-mist-text">
              Nadie tiene trabajo pendiente registrado.
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {(() => {
                const rows = workload.data?.workload.slice(0, 5) ?? [];
                const max = Math.max(...rows.map((r) => r.openTasks), 1);
                return rows.map((w) => (
                  <li key={w.assignedTo ?? "sin"}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] text-iusia-carbon">
                        {w.name ?? "Sin asignar"}
                      </span>
                      <span className="shrink-0 text-[12.5px] tnum text-iusia-mist-text">
                        {w.openTasks}
                      </span>
                    </div>
                    {/* La carga se compara entre personas, así que la barra se mide
                        contra quien más tiene, no contra un total inventado. */}
                    <DataBar
                      value={(w.openTasks / max) * 100}
                      className="bg-iusia-navy/45"
                      trackClassName="mt-1 h-1 bg-iusia-paper"
                      delay={0.05}
                    />
                  </li>
                ));
              })()}
            </ul>
          )}
          <Link
            to="/equipo"
            className="mt-3 inline-block text-[12.5px] font-medium text-iusia-action hover:underline"
          >
            Administrar →
          </Link>
        </Module>
      </div>

      <Module
        title="Movimiento reciente"
        eyebrow="Cartera"
        className="mt-4"
        padded={false}
        action={
          <Link to="/casos" className="text-[12.5px] font-medium text-iusia-action hover:underline">
            Ver toda la cartera →
          </Link>
        }
      >
        {(matters.data?.matters ?? []).length === 0 ? (
          <p className="px-5 pb-5 text-[13.5px] text-iusia-mist-text">
            Todavía no hay expedientes en la firma.
          </p>
        ) : (
          <ul className="divide-y divide-iusia-line/70">
            {(matters.data?.matters ?? []).slice(0, 4).map((m) => (
              <li key={m.id}>
                <Link
                  to={`/casos/${m.id}`}
                  className="flex items-center gap-4 px-5 py-2.5 transition-colors hover:bg-iusia-ice"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-iusia-navy">
                      {m.title}
                    </span>
                    <span className="block truncate text-[11.5px] text-iusia-mist-text">
                      {m.reference} · {m.clientName}
                    </span>
                  </span>
                  <StatusChip
                    label={matterStatusTerm(m.status).label}
                    tone={matterStatusTerm(m.status).tone}
                    title={matterStatusTerm(m.status).hint}
                  />
                  <span className="hidden w-24 shrink-0 text-right text-[11.5px] tnum text-iusia-mist-text sm:block">
                    {new Date(m.updatedAt).toLocaleDateString("es-CO")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Module>

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


/**
 * Pieza protagonista del centro de mando.
 *
 * Integra los indicadores accionables Y lo que exige decisión en un solo módulo: eran
 * dos bloques separados, y separarlos obligaba a leer un número arriba y su
 * consecuencia abajo. Sin nada pendiente no se muestra una caja vacía de 250px: se
 * muestra el estado de control, que también es información.
 */
function DecisionModule({
  loading,
  recommendations,
  onDrill,
  metrics,
}: {
  loading: boolean;
  recommendations: ReturnType<typeof buildRecommendations>;
  onDrill: (d: Drill) => void;
  metrics: { total: number; risk: number; overdue: number; upcoming: number };
}) {
  return (
    <Module
      eyebrow="Atención de dirección"
      title={recommendations.length > 0 ? "Requiere tu decisión" : "Cartera bajo control"}
      action={
        recommendations.length > 0 ? (
          <StatusChip
            label={`${recommendations.length} ${recommendations.length === 1 ? "asunto" : "asuntos"}`}
            tone={metrics.overdue > 0 || metrics.risk > 0 ? "critical" : "warning"}
          />
        ) : (
          <StatusChip label="Sin intervención inmediata" tone="success" dot />
        )
      }
      padded={false}
    >
      <div className="px-5 pb-5">
        {loading ? (
          <Skeleton className="h-24" />
        ) : recommendations.length === 0 ? (
          <p className="text-[13.5px] leading-relaxed text-iusia-mist-text">
            Ningún término vencido, ningún riesgo abierto y ningún expediente detenido.
            Los indicadores de abajo siguen siendo accionables.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {recommendations.map((r) => (
              <li key={r.key}>
                <button
                  type="button"
                  onClick={() => onDrill(r.drill)}
                  className="flex w-full items-start justify-between gap-4 rounded-[10px] px-2.5 py-2.5 text-left transition-colors hover:bg-iusia-ice"
                >
                  <span className="flex min-w-0 items-start gap-3">
                    <r.icon size={16} className={r.iconClass} aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium text-iusia-navy">
                        {r.title}
                      </span>
                      <span className="block text-[12.5px] text-iusia-mist-text">{r.detail}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-[12.5px] font-medium text-iusia-action">
                    Revisar →
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Los indicadores viven DENTRO del módulo protagonista: son las puertas a lo
          que acaba de leerse, no una fila de tarjetas independiente. */}
      <div className="grid grid-cols-2 gap-px bg-iusia-line sm:grid-cols-4">
        <IndicatorCell label="Activos" value={metrics.total} onClick={() => onDrill("matters")} />
        <IndicatorCell
          label="Riesgo alto"
          value={metrics.risk}
          tone="critical"
          onClick={() => onDrill("risk")}
        />
        <IndicatorCell
          label="Vencidos"
          value={metrics.overdue}
          tone="critical"
          onClick={() => onDrill("overdue")}
        />
        <IndicatorCell
          label="Vencen pronto"
          value={metrics.upcoming}
          tone="warning"
          hint="15 d"
          onClick={() => onDrill("upcoming")}
        />
      </div>
    </Module>
  );
}

function IndicatorCell({
  label,
  value,
  tone = "navy",
  hint,
  onClick,
}: {
  label: string;
  value: number;
  tone?: "navy" | "critical" | "warning";
  hint?: string;
  onClick: () => void;
}) {
  const empty = value === 0;
  const color =
    empty || tone === "navy"
      ? "text-iusia-navy"
      : tone === "critical"
        ? "text-iusia-critical"
        : "text-iusia-warning-text";
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative bg-iusia-paper px-4 py-3 text-left transition-[background-color,box-shadow] duration-[var(--motion-normal)] ease-[var(--ease-standard)] hover:z-10 hover:bg-iusia-ice hover:shadow-[var(--shadow-panel)]"
    >
      <span className="flex items-center gap-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-iusia-mist-text">
          {label}
        </span>
        {/* La flecha aparece al pasar por encima: dice "esto se abre" sin ocupar
            sitio permanente en una rejilla densa. */}
        <ChevronRight
          size={12}
          aria-hidden
          className="-translate-x-1 text-iusia-action opacity-0 transition-all duration-[var(--motion-fast)] ease-[var(--ease-standard)] group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:transition-none"
        />
      </span>
      <span className="mt-1 flex items-baseline gap-1.5">
        <span
          className={
            "text-[22px] font-semibold leading-none tracking-[-0.02em] tnum " +
            (empty ? "text-iusia-mist-text" : color)
          }
        >
          <CountUp value={value} />
        </span>
        {hint ? <span className="text-[11px] text-iusia-mist-text">{hint}</span> : null}
      </span>
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
