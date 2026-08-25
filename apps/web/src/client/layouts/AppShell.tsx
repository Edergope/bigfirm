import { NavLink, Outlet, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BrainCircuit,
  Briefcase,
  CalendarClock,
  Files,
  Home,
  LayoutTemplate,
  LogOut,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { CreditBadge, SelectionPill, firmRoleLabel } from "@iusia/ui";
import { api } from "../api.js";
import { authClient } from "../auth-client.js";
import { useActiveAnalyses } from "../hooks/use-active-analyses.js";
import { AnalysisToasts } from "../components/AnalysisToasts.js";

/**
 * Marco de la aplicación.
 *
 * IUSIA es UNA pieza, no un muro de navegación con contenido pegado al lado. Todo
 * —navegación, cabecera y trabajo— vive dentro de un mismo contenedor redondeado
 * que flota sobre un fondo ambiental. La navegación es clara y tonal, del mismo
 * material que el contenido: un panel navy de borde a borde partía el producto en
 * dos objetos y era lo que lo hacía leer como panel de administración.
 *
 * El navy no desaparece, se redistribuye: marca, tipografía de títulos, el estado
 * activo de la navegación y los módulos donde IUSIA habla en primera persona.
 */

const { signOut } = authClient;

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

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
    <div className="h-screen p-0 lg:p-4">
      {/* El contenedor de la aplicación. Una sola superficie, un solo objeto. */}
      <div className="flex h-full overflow-hidden bg-iusia-paper shadow-[var(--shadow-floating)] lg:rounded-[var(--radius-xl)]">
        <aside className="flex h-full w-[68px] shrink-0 flex-col bg-iusia-ice/70 lg:w-[218px]">
          <div className="px-4 pb-6 pt-6 lg:px-6">
            <p className="text-[17px] font-semibold tracking-[0.16em] text-iusia-navy">
              <span className="lg:hidden">IA</span>
              <span className="hidden lg:inline">IUSIA</span>
            </p>
            <p className="mt-1 hidden text-[9px] font-semibold tracking-[0.14em] text-iusia-mist-text lg:block">
              LEGAL INTELLIGENCE
            </p>
          </div>

          <nav className="flex-1 overflow-y-auto px-2.5 pb-2 lg:px-3.5">
            <NavGroup items={WORK_NAV} />
            {administersFirm ? <NavGroup label="Firma" items={FIRM_NAV} /> : null}
            {controlsSystem ? <NavGroup label="Sistema" items={SYSTEM_NAV} /> : null}
          </nav>

          <div className="px-2.5 pb-4 lg:px-3.5">
            <div className="rounded-[var(--radius-md)] bg-iusia-paper/80 px-3 py-3 shadow-[var(--shadow-surface)]">
              <p className="hidden truncate text-[13px] font-semibold text-iusia-navy lg:block">
                {me.data?.user.name ?? "…"}
              </p>
              <p className="mt-0.5 hidden truncate text-[11.5px] text-iusia-mist-text lg:block">
                {firmRoleLabel(role ?? "")}
                {controlsSystem ? " · Sistema" : ""}
              </p>
              <button
                type="button"
                onClick={() => void signOut().then(() => window.location.assign("/entrar"))}
                title="Cerrar sesión"
                className="mt-2.5 flex items-center gap-2 text-[12.5px] text-iusia-mist-text transition-colors hover:text-iusia-critical"
              >
                <LogOut size={14} aria-hidden />
                <span className="sr-only lg:not-sr-only">Cerrar sesión</span>
              </button>
            </div>
          </div>
        </aside>

        {/* Zona de trabajo. Un lavado frío la separa de la navegación sin una línea. */}
        <div className="flex h-full min-w-0 flex-1 flex-col bg-[radial-gradient(90%_60%_at_0%_0%,#F7FAFD_0%,transparent_55%),radial-gradient(70%_50%_at_100%_100%,#EDF5F6_0%,transparent_60%)]">
          <header className="flex h-[58px] shrink-0 items-center gap-3 px-4 lg:px-7">
            <p className="hidden text-[12.5px] text-iusia-mist-text sm:block">
              {me.data ? `${me.data.user.name} · ${firmRoleLabel(role ?? "")}` : ""}
            </p>
            <div className="ml-auto flex items-center gap-3">
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
                  className="flex items-center gap-2 rounded-full bg-iusia-intel/12 px-3 py-1.5 text-[12.5px] font-medium text-iusia-intel-text shadow-[var(--shadow-surface)] transition-colors hover:bg-iusia-intel/20"
                >
                  {/* El punto no es decorativo: sólo late mientras hay trabajo real. */}
                  <span className="relative flex h-2 w-2" aria-hidden>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-iusia-intel opacity-60 motion-reduce:animate-none" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-iusia-intel" />
                  </span>
                  <span className="hidden sm:inline">IUSIA · {activeCount} en curso</span>
                  <span className="sr-only sm:hidden">
                    IUSIA: {activeCount} análisis en curso
                  </span>
                </button>
              ) : null}
              {me.data ? <CreditBadge balance={me.data.credits} /> : null}
            </div>
          </header>

          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-6 lg:px-7 lg:pb-7">
            <Outlet />
            <AnalysisToasts />
          </main>
        </div>
      </div>
    </div>
  );
}

/** Grupo de navegación con etiqueta opcional: separa planos de autoridad. */
function NavGroup({ label, items }: { label?: string; items: NavItem[] }) {
  return (
    <div className={label ? "mt-6" : ""}>
      {label ? (
        <p className="mb-2 hidden px-3 text-[10px] font-semibold uppercase tracking-[0.11em] text-iusia-mist-text/80 lg:block">
          {label}
        </p>
      ) : null}
      {items.map(({ to, label: itemLabel, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          title={itemLabel}
          className={({ isActive }) =>
            clsx(
              "group relative isolate mb-1 flex items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2 text-[13.5px] max-lg:justify-center max-lg:px-2",
              "transition-colors duration-[var(--motion-fast)]",
              isActive
                ? "font-medium text-white"
                : "text-iusia-carbon/70 hover:bg-iusia-paper/80 hover:text-iusia-navy",
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive ? (
                <SelectionPill
                  layoutId="nav-active"
                  className="bg-iusia-navy shadow-[0_3px_10px_-3px_rgba(11,29,58,0.5)]"
                />
              ) : null}
              <Icon
                size={16}
                strokeWidth={isActive ? 2.1 : 1.7}
                className={clsx(
                  "shrink-0 transition-transform duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
                  "group-hover:scale-110 motion-reduce:translate-none",
                  isActive ? "text-iusia-intel" : "text-iusia-mist-text",
                )}
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
