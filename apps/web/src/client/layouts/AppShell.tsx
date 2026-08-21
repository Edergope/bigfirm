import { NavLink, Outlet } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Home,
  Briefcase,
  CalendarClock,
  Files,
  LayoutTemplate,
  BrainCircuit,
  Users,
  Settings,
  LogOut,
} from "lucide-react";
import { CreditBadge } from "@iusia/ui";
import clsx from "clsx";
import { api } from "../api.js";
import { signOut } from "../auth-client.js";

/**
 * Shell de IUSIA. Sobrio y estable: la expresividad se reserva para la
 * orquestación (Design System §01, "regla de oro visual").
 */

const NAV = [
  { to: "/", label: "Inicio", icon: Home, ready: true },
  { to: "/casos", label: "Casos", icon: Briefcase, ready: true },
  { to: "/tareas", label: "Tareas y términos", icon: CalendarClock, ready: false },
  { to: "/documentos", label: "Documentos", icon: Files, ready: false },
  { to: "/plantillas", label: "Plantillas", icon: LayoutTemplate, ready: false },
  { to: "/inteligencia", label: "Inteligencia", icon: BrainCircuit, ready: false },
  { to: "/equipo", label: "Equipo", icon: Users, ready: false },
  { to: "/administracion", label: "Administración", icon: Settings, ready: false },
];

export function AppShell() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 flex w-[232px] flex-col bg-iusia-navy text-white/90">
        <div className="px-6 py-5">
          <p className="text-lg font-bold tracking-[0.14em] text-white">IUSIA</p>
          <p className="mt-0.5 text-[12px] tracking-wide text-white/50">
            INTELLIGENCE. LAW. ADVANTAGE.
          </p>
        </div>

        <nav className="flex-1 px-3 py-2">
          {NAV.map(({ to, label, icon: Icon, ready }) =>
            ready ? (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  clsx(
                    "mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition",
                    isActive
                      ? "bg-white/12 font-medium text-white"
                      : "text-white/70 hover:bg-white/6 hover:text-white",
                  )
                }
              >
                <Icon size={17} aria-hidden />
                {label}
              </NavLink>
            ) : (
              // Ruta prevista pero no construida. No se finge una vista con datos falsos.
              <span
                key={to}
                title="Módulo previsto para una vertical posterior"
                className="mb-0.5 flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-[14px] text-white/35"
              >
                <Icon size={17} aria-hidden />
                {label}
                <span className="ml-auto text-[11px] uppercase tracking-wide">pend.</span>
              </span>
            ),
          )}
        </nav>

        <div className="border-t border-white/10 px-4 py-4">
          <p className="text-[14px] font-medium text-white">{me.data?.user.name ?? "…"}</p>
          <p className="text-[12px] text-white/50">{me.data?.firm_role ?? ""}</p>
          <button
            type="button"
            onClick={() => void signOut().then(() => window.location.assign("/entrar"))}
            className="mt-3 flex items-center gap-2 text-[13px] text-white/60 hover:text-white"
          >
            <LogOut size={14} aria-hidden />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="ml-[232px] flex min-h-screen flex-1 flex-col">
        <header className="flex h-16 items-center justify-end gap-4 border-b border-iusia-mist/30 bg-iusia-paper px-8">
          {me.data ? <CreditBadge balance={me.data.credits} /> : null}
        </header>
        <main className="flex-1 px-8 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
