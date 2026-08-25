import { NavLink, Outlet } from "react-router";
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
} from "lucide-react";
import { CreditBadge } from "@iusia/ui";
import clsx from "clsx";
import { api } from "../api.js";
import { signOut } from "../auth-client.js";

/**
 * Shell de IUSIA. Institucional y estable: la expresividad se reserva para la
 * orquestación (Design System §01). Navegación MVP de seis vistas.
 */
const NAV = [
  { to: "/", label: "Inicio", icon: Home },
  { to: "/casos", label: "Casos", icon: Briefcase },
  { to: "/tareas", label: "Tareas y términos", icon: CalendarClock },
  { to: "/documentos", label: "Documentos", icon: Files },
  { to: "/plantillas", label: "Plantillas", icon: LayoutTemplate },
  { to: "/inteligencia", label: "Inteligencia", icon: BrainCircuit },
];

/** Sólo la administración de la firma ve la gestión del equipo. */
const ADMIN_NAV = [{ to: "/equipo", label: "Equipo", icon: Users }];

export function AppShell() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 flex w-[236px] flex-col border-r border-black/10 bg-iusia-navy text-white/85">
        <div className="px-6 pb-5 pt-6">
          <p className="text-[19px] font-bold tracking-[0.18em] text-white">IUSIA</p>
          <p className="mt-1 text-[10.5px] font-medium tracking-[0.14em] text-white/55">
            INTELLIGENCE · LAW · ADVANTAGE
          </p>
        </div>

        <nav className="flex-1 px-3 py-2">
          {[
            ...NAV,
            // La administración del equipo sólo se ofrece a quien puede ejercerla;
            // la autorización real la revalida el servidor en cada ruta.
            ...(me.data?.firm_role === "FIRM_DIRECTOR" || me.data?.firm_role === "PARTNER"
              ? ADMIN_NAV
              : []),
          ].map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
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
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/10 px-4 py-4">
          <p className="truncate text-[14px] font-medium text-white">
            {me.data?.user.name ?? "…"}
          </p>
          <p className="mt-0.5 text-[12px] text-white/55">{firmRoleLabel(me.data?.firm_role)}</p>
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
