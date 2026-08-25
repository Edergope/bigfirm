import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, Skeleton, StateBlock } from "@iusia/ui";
import { api } from "../api.js";
import { useActiveAnalyses } from "../hooks/use-active-analyses.js";

/**
 * IUSIA — qué está haciendo la inteligencia jurídica y qué ha producido.
 *
 * Concentra la experiencia de IA para el trabajo jurídico: análisis en curso,
 * expedientes analizados y el equipo de especialistas disponible. El detalle técnico
 * de cada ejecución pertenece a Control IUSIA, no a esta vista.
 */
export function Iusia() {
  const { analyses, count, isLoading } = useActiveAnalyses();
  const matters = useQuery({ queryKey: ["matters"], queryFn: api.listMatters });
  const agents = useQuery({ queryKey: ["agents"], queryFn: api.agents });

  // El equipo se presenta por especialidad, no por código de nodo.
  const team = (agents.data?.agents ?? []).filter((a) => a.enabled);

  return (
    <div className="flex flex-col gap-6">
      {/* Única banda navy en el contenido del producto. IUSIA no es una pantalla
          administrativa más: se distingue por materia y peso, no por animaciones. */}
      <header className="on-navy overflow-hidden rounded-[16px] bg-iusia-navy px-6 py-6 shadow-[var(--shadow-panel)]">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-white">
              Inteligencia jurídica
            </h1>
            <p className="mt-1.5 max-w-xl text-[14px] leading-relaxed text-white/60">
              IUSIA orquesta un equipo de especialistas sobre tus expedientes. Los análisis
              se inician desde cada caso y siguen trabajando aunque cierres la vista.
            </p>
          </div>
          <dl className="flex gap-8">
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/40">
                En curso
              </dt>
              <dd className="mt-1 flex items-center gap-2 text-[24px] font-semibold leading-none tnum text-white">
                {count}
                {count > 0 ? (
                  <span className="relative flex h-2 w-2" aria-hidden>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-iusia-intel opacity-70 motion-reduce:animate-none" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-iusia-intel" />
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/40">
                Especialistas
              </dt>
              <dd className="mt-1 text-[24px] font-semibold leading-none tnum text-white">
                {team.length}
              </dd>
            </div>
          </dl>
        </div>
      </header>

      <Card>
        <CardHeader
          title="Análisis en curso"
          subtitle="Puedes seguir trabajando: el análisis continúa aunque cierres la vista"
        />
        {isLoading ? (
          <div className="p-5"><Skeleton className="h-20" /></div>
        ) : count === 0 ? (
          <StateBlock
            kind="empty"
            title="Ningún análisis en curso"
            hint="Los análisis se inician desde el expediente, en la pestaña Análisis IUSIA."
          />
        ) : (
          <ul className="divide-y divide-iusia-line">
            {analyses.map((a) => (
              <li key={a.root_execution_id}>
                <Link
                  to={`/casos/${a.matter_id}?analisis=${a.root_execution_id}`}
                  className="flex items-center justify-between gap-3 px-6 py-3.5 transition-colors hover:bg-iusia-surface"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-iusia-intel opacity-60 motion-reduce:animate-none" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-iusia-intel" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[14.5px] text-iusia-carbon">{a.matter_title}</span>
                      <span className="block text-[12.5px] text-iusia-mist-text">
                        Iniciado {new Date(a.started_at).toLocaleString("es-CO")}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 text-[13px] font-medium text-iusia-action">Abrir</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Expedientes" subtitle="Inicia un análisis desde cualquier caso" />
          {matters.isLoading ? (
            <div className="p-5"><Skeleton className="h-24" /></div>
          ) : (matters.data?.matters.length ?? 0) === 0 ? (
            <StateBlock kind="empty" title="Sin expedientes" />
          ) : (
            <ul className="divide-y divide-iusia-line">
              {matters.data?.matters.slice(0, 6).map((m) => (
                <li key={m.id}>
                  <Link
                    to={`/casos/${m.id}`}
                    className="flex items-center justify-between gap-3 px-6 py-3 transition-colors hover:bg-iusia-surface"
                  >
                    <span className="min-w-0 truncate text-[14.5px] text-iusia-carbon">{m.title}</span>
                    <span className="shrink-0 text-[13px] text-iusia-action">Analizar</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Equipo de especialistas"
            subtitle="IUSIA elige por sí misma quién interviene en cada asunto"
          />
          {agents.isLoading ? (
            <div className="p-5"><Skeleton className="h-24" /></div>
          ) : (
            <>
              <ul className="max-h-[280px] divide-y divide-iusia-mist/15 overflow-y-auto">
                {team.map((a) => (
                  <li key={a.agent_id} className="px-6 py-2.5">
                    <span className="block truncate text-[13.5px] text-iusia-carbon">{a.name}</span>
                    <span className="block truncate text-[12px] text-iusia-mist-text">{a.domain}</span>
                  </li>
                ))}
              </ul>
              <p className="border-t border-iusia-mist/20 px-6 py-3 text-[12.5px] text-iusia-mist-text">
                {team.length} especialistas disponibles. Tú describes el encargo; IUSIA compone el equipo.
              </p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
