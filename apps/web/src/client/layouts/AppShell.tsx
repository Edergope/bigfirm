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
      <aside className="fixed inset-y-0 left-0 flex w-[236px] flex-col border-r border-black/10 bg-iusia-navy text-white/85">
        <div className="px-6 pb-5 pt-6">
          <p className="text-[19px] font-bold tracking-[0.18em] text-white">IUSIA</p>
          <p className="mt-1 text-[10.5px] font-medium tracking-[0.14em] text-white/55">
            INTELLIGENCE · LAW · ADVANTAGE
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-2">
          <NavGroup items={WORK_NAV} />
          {administersFirm ? <NavGroup label="Administración" items={FIRM_NAV} /> : null}
          {controlsSystem ? <NavGroup label="Sistema" items={SYSTEM_NAV} /> : null}
        </nav>

        <div className="border-t border-white/10 px-4 py-4">
          <p className="truncate text-[14px] font-medium text-white">
            {me.data?.user.name ?? "…"}
          </p>
          <p className="mt-0.5 text-[12px] text-white/55">
            {firmRoleLabel(role)}
            {controlsSystem ? " · Sistema" : ""}
          </p>
          <button
            type="button"
            onClick={() => void signOut().then(() => window.location.assign("/entrar"))}
            className="mt-3 flex items-center gap-2 text-[13px] text-white/55 transition-colors hover:text-white"
          >
            <LogOut size={14} aria-hidden />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col pl-[236px]">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-iusia-mist/30 bg-iusia-paper/85 px-8 backdrop-blur">
          {/* Búsqueda global prevista por el Design System pero aún no implementada:
              se muestra como control honesto y deshabilitado, no como affordance falso. */}
          <button
            type="button"
            disabled
            aria-label="Búsqueda global (próximamente)"
            title="Búsqueda global — próximamente"
            className="flex h-9 max-w-md flex-1 cursor-not-allowed items-center gap-2 rounded-[10px] border border-iusia-mist/40 bg-iusia-surface px-3 text-left text-iusia-mist-text"
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
                      ? `/casos/${analyses[0].matter_id}`
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
                IUSIA · {activeCount} {activeCount === 1 ? "análisis" : "análisis"} en curso
              </button>
            ) : null}
            {me.data ? <CreditBadge balance={me.data.credits} /> : null}
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1360px] flex-1 px-8 py-7">
          <Outlet />
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
        <p className="mb-1.5 px-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/40">
          {label}
        </p>
      ) : null}
      {items.map(({ to, label: itemLabel, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            clsx(
              "mb-0.5 flex items-center gap-3 rounded-[10px] px-3 py-2 text-[14px] transition-colors",
              isActive
                ? "bg-white/[0.10] font-medium text-white"
                : "text-white/65 hover:bg-white/[0.05] hover:text-white",
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon
                size={17}
                strokeWidth={isActive ? 2.2 : 1.8}
                className={isActive ? "text-iusia-intel" : ""}
                aria-hidden
              />
              {itemLabel}
            </>
          )}
        </NavLink>
      ))}
    </div>
  );
}

function firmRoleLabel(role: string | undefined): string {
  const map: Record<string, string> = {
    FIRM_DIRECTOR: "Dirección",
    PARTNER: "Socio",
    LAWYER: "Abogado",
    EXTERNAL_LAWYER: "Abogado externo",
    ASSISTANT: "Asistente",
    PARALEGAL: "Paralegal",
    READ_ONLY: "Solo lectura",
  };
  return role ? (map[role] ?? role) : "";
}
