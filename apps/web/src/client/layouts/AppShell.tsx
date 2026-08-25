import { NavLink, Outlet, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Home,
  Briefcase,
  CalendarClock,
  Files,
  LayoutTemplate,
  BrainCircuit,
  Search,
  LogOut,
  Users,
  SlidersHorizontal,
} from "lucide-react";
import { CreditBadge } from "@iusia/ui";
import clsx from "clsx";
import { api } from "../api.js";
import { signOut } from "../auth-client.js";
import { useActiveAnalyses } from "../hooks/use-active-analyses.js";
import { AnalysisToasts } from "../components/AnalysisToasts.js";
import { firmRoleLabel } from "@iusia/ui";

/**
 * Shell de IUSIA.
 *
 * La navegación se organiza por INTENCIÓN, no por módulo técnico, y se adapta al
 * alcance real del usuario: el trabajo jurídico, la administración de la firma y el
 * control del sistema son planos distintos y no se mezclan en una lista plana.
 *
 * Lo que la UI decide mostrar nunca autoriza nada: cada ruta revalida en el servidor.
 */

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  end?: boolean;
}

/** Trabajo jurídico: lo que usa cualquier miembro de la firma. */
const WORK_NAV: NavItem[] = [
  { to: "/", label: "Inicio", icon: Home, end: true },
  { to: "/casos", label: "Casos", icon: Briefcase },
  { to: "/tareas", label: "Trabajo", icon: CalendarClock },
  { to: "/documentos", label: "Documentos", icon: Files },
  { to: "/iusia", label: "IUSIA", icon: BrainCircuit },
  { to: "/plantillas", label: "Plantillas", icon: LayoutTemplate },
];

/** Administración de la firma: sólo dirección y socios. */
const FIRM_NAV: NavItem[] = [{ to: "/equipo", label: "Equipo", icon: Users }];

/** Control del sistema: exclusivo del superadministrador de IUSIA. */
const SYSTEM_NAV: NavItem[] = [
  { to: "/control", label: "Control IUSIA", icon: SlidersHorizontal },
];

export function AppShell() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const navigate = useNavigate();
  const { count: activeCount, analyses } = useActiveAnalyses();

  const role = me.data?.firm_role;
  const administersFirm = role === "FIRM_DIRECTOR" || role === "PARTNER";
  const controlsSystem = me.data?.is_system_superadmin === true;

  return (
    <div className="min-h-screen">
      <aside className="on-navy fixed inset-y-0 left-0 z-40 flex w-[60px] flex-col bg-iusia-navy text-white/85 lg:w-[212px]">
        <div className="px-4 pb-5 pt-5 lg:px-5">
          <p className="text-[16px] font-semibold tracking-[0.2em] text-white">
            <span className="lg:hidden">IA</span>
            <span className="hidden lg:inline">IUSIA</span>
          </p>
          <p className="mt-1 hidden whitespace-nowrap text-[8.5px] font-medium tracking-[0.09em] text-white/40 lg:block">
            INTELLIGENCE · LAW · ADVANTAGE
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-2 lg:px-3">
          <NavGroup items={WORK_NAV} />
          {administersFirm ? <NavGroup label="Administración" items={FIRM_NAV} /> : null}
          {controlsSystem ? <NavGroup label="Sistema" items={SYSTEM_NAV} /> : null}
        </nav>

        <div className="on-navy border-t border-white/[0.08] px-3 py-3.5 lg:px-4">
          <p className="hidden truncate text-[13.5px] font-medium text-white/90 lg:block">
            {me.data?.user.name ?? "…"}
          </p>
          <p className="mt-0.5 hidden text-[11.5px] text-white/45 lg:block">
            {firmRoleLabel(role ?? "")}
            {controlsSystem ? " · Sistema" : ""}
          </p>
          <button
            type="button"
            onClick={() => void signOut().then(() => window.location.assign("/entrar"))}
            title="Cerrar sesión"
            className="mt-3 flex items-center gap-2 text-[13px] text-white/55 transition-colors hover:text-white"
          >
            <LogOut size={14} aria-hidden />
            <span className="sr-only lg:not-sr-only">Cerrar sesión</span>
          </button>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col pl-[60px] lg:pl-[212px]">
        <header className="sticky top-0 z-30 flex h-[58px] items-center gap-4 border-b border-iusia-line bg-iusia-canvas/85 px-4 backdrop-blur-md lg:px-7">
          {/* Búsqueda global prevista por el Design System pero aún no implementada:
              se muestra como control honesto y deshabilitado, no como affordance falso. */}
          <button
            type="button"
            disabled
            aria-label="Búsqueda global (próximamente)"
            title="Búsqueda global — próximamente"
            className="hidden h-9 max-w-md flex-1 cursor-not-allowed items-center gap-2 rounded-[10px] border border-iusia-mist/40 bg-iusia-surface px-3 text-left text-iusia-mist-text md:flex"
          >
            <Search size={16} aria-hidden />
            <span className="text-[14px]">Buscar expedientes, documentos…</span>
            <span className="ml-auto rounded-full bg-iusia-mist/15 px-2 py-0.5 text-[13px] font-medium">
              Pronto
            </span>
          </button>

          <div className="ml-auto flex items-center gap-4">
            {activeCount > 0 ? (
              <button
                type="button"
                onClick={() =>
                  navigate(
                    activeCount === 1 && analyses[0]
                      ? `/casos/${analyses[0].matter_id}?analisis=${analyses[0].root_execution_id}`
                      : "/iusia",
                  )
                }
                aria-label={`IUSIA: ${activeCount} análisis en curso. Abrir.`}
                className="flex items-center gap-2 rounded-full border border-iusia-intel/40 bg-iusia-intel/10 px-3 py-1.5 text-[13px] font-medium text-iusia-intel-text transition-colors hover:bg-iusia-intel/20"
              >
                {/* El punto no es decorativo: sólo late mientras hay trabajo real. */}
                <span className="relative flex h-2 w-2" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-iusia-intel opacity-60 motion-reduce:animate-none" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-iusia-intel" />
                </span>
                <span className="hidden sm:inline">
                  IUSIA · {activeCount} en curso
                </span>
                <span className="sr-only sm:hidden">
                  IUSIA: {activeCount} análisis en curso
                </span>
              </button>
            ) : null}
            {me.data ? <CreditBadge balance={me.data.credits} /> : null}
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 lg:px-7 lg:py-6">
          <Outlet />
          <AnalysisToasts />
        </main>
      </div>
    </div>
  );
}

/** Grupo de navegación con etiqueta opcional: separa planos de autoridad. */
function NavGroup({ label, items }: { label?: string; items: NavItem[] }) {
  return (
    <div className={label ? "mt-5" : ""}>
      {label ? (
        <>
          <p className="mb-1.5 hidden px-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/40 lg:block">
            {label}
          </p>
          {/* En el riel la separación entre planos de autoridad la lleva una regla,
              no un rótulo que no cabría. */}
          <hr className="mx-2 mb-2 border-white/10 lg:hidden" />
        </>
      ) : null}
      {items.map(({ to, label: itemLabel, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          title={itemLabel}
          className={({ isActive }) =>
            clsx(
              "relative mb-px flex items-center gap-3 rounded-[8px] px-3 py-[7px] text-[13.5px] transition-colors max-lg:justify-center max-lg:px-2",
              isActive
                ? "bg-white/[0.07] font-medium text-white"
                : "text-white/60 hover:bg-white/[0.04] hover:text-white/90",
            )
          }
        >
          {({ isActive }) => (
            <>
              {/* Línea de acento en el borde: señala sin encender el bloque entero. */}
              {isActive ? (
                <span
                  aria-hidden
                  className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-iusia-intel"
                />
              ) : null}
              <Icon
                size={16}
                strokeWidth={isActive ? 2 : 1.6}
                className={clsx("shrink-0", isActive ? "text-iusia-intel" : "text-white/45")}
                aria-hidden
              />
              <span className="sr-only lg:not-sr-only">{itemLabel}</span>
            </>
          )}
        </NavLink>
      ))}
    </div>
  );
}

