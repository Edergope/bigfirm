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
/**
 * Dominios del motor traducidos a áreas que un abogado reconoce. Sin entrada, el
 * dominio simplemente no se muestra: es preferible una lista corta y cierta que
 * una completa con un enum crudo dentro.
 */
const AGENT_DOMAIN_AREAS: Record<string, string> = {
  ORCHESTRATION: "Dirección del análisis",
  INTAKE: "Encuadre del caso",
  RESEARCH: "Investigación jurídica",
  EVIDENTIARY: "Prueba y peritaje",
  PROCEDURAL: "Vía procesal",
  STRATEGY: "Estrategia",
  CONTRACTUAL: "Contratos y negocios",
  CORPORATE: "Societario",
  LABOR: "Laboral",
  TAX: "Tributario",
  CRIMINAL: "Penal económico",
  ADMINISTRATIVE: "Administrativo",
  COMPLIANCE: "Cumplimiento",
  LITIGATION: "Litigio",
  INSOLVENCY: "Insolvencia",
  IP: "Propiedad intelectual",
  REAL_ESTATE: "Inmobiliario",
  QUALITY: "Control de calidad",
};

export function Iusia() {
  const { analyses, count, isLoading } = useActiveAnalyses();
  const matters = useQuery({ queryKey: ["matters"], queryFn: api.listMatters });
  const agents = useQuery({ queryKey: ["agents"], queryFn: api.agents });

  // El equipo se presenta por especialidad, no por código de nodo.
  const team = (agents.data?.agents ?? []).filter((a) => a.enabled);

  /**
   * Áreas de fortaleza, derivadas del catálogo real de agentes habilitados. Nunca
   * una lista escrita a mano: si mañana se habilita un especialista tributario, la
   * vista lo refleja sola; y si el dominio no tiene traducción, no se inventa.
   */
  const practiceStrengths = [
    ...new Set(
      team
        .map((a) => AGENT_DOMAIN_AREAS[a.domain])
        .filter((x): x is string => typeof x === "string"),
    ),
  ].sort((a, b) => a.localeCompare(b, "es"));

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
            title="En qué es especialista IUSIA"
            subtitle="Tú describes el encargo; IUSIA compone el equipo por sí misma"
          />
          {agents.isLoading ? (
            <div className="p-5"><Skeleton className="h-24" /></div>
          ) : (
            <>
              {/*
                Se muestran ÁREAS, no un inventario de agentes. La lista anterior
                exponía "Managing Partner / Orquestador Jurídico", "ORCHESTRATION" e
                "INTAKE": nombres y enums del motor, que le piden al abogado conocer
                la arquitectura para entender qué puede pedirle a IUSIA. El catálogo
                técnico completo vive en Control IUSIA, que es donde tiene sentido.
              */}
              <ul className="flex flex-wrap gap-2 px-6 py-4">
                {practiceStrengths.map((area) => (
                  <li
                    key={area}
                    className="rounded-full bg-iusia-ice px-3 py-1.5 text-[12.5px] font-medium text-iusia-navy"
                  >
                    {area}
                  </li>
                ))}
              </ul>
              <p className="px-6 pb-4 text-[12.5px] leading-relaxed text-iusia-mist-text">
                {team.length} especialistas disponibles. No eliges quién interviene: IUSIA
                lo decide según lo que pide el encargo y deja registrada la razón.
              </p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
