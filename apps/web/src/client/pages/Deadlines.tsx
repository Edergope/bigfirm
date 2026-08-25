import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { CalendarClock, Scale } from "lucide-react";
import { Module, ScreenTitle, Skeleton, StatusChip } from "@iusia/ui";
import { api, type IntelDeadline, type IntelTask } from "../api.js";

/**
 * Trabajo — lo que este abogado tiene delante hoy.
 *
 * Eran dos cajas ("Vencidos", "Próximos 90 días") con medio viewport vacío cuando
 * no había nada: una pantalla que dice "no tienes trabajo" ocupando toda la
 * pantalla no es un espacio de trabajo, es un cartel. Ahora lo vencido y lo
 * inminente comparten una sola lectura cronológica, y el espacio que sobra lo
 * ocupan los expedientes en los que la persona trabaja, que es lo que de verdad
 * quiere abrir cuando no hay términos que atender.
 */
export function Deadlines() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const firm = me.data?.firm_role === "FIRM_DIRECTOR";
  const overdue = useQuery({
    queryKey: ["intel", "overdue", firm],
    queryFn: () => api.intelligence.overdue(firm),
    enabled: me.isSuccess,
  });
  const upcoming = useQuery({
    queryKey: ["intel", "upcoming90", firm],
    queryFn: () => api.intelligence.upcoming(firm, 90),
    enabled: me.isSuccess,
  });
  const matters = useQuery({ queryKey: ["matters"], queryFn: api.listMatters });

  const loading = overdue.isLoading || upcoming.isLoading;
  const overdueRows = overdue.data?.tasks ?? [];
  const upcomingRows = upcoming.data?.deadlines ?? [];
  const nothing = !loading && overdueRows.length === 0 && upcomingRows.length === 0;

  return (
    <div className="pb-2">
      <ScreenTitle
        eyebrow={firm ? "Alcance de firma" : "Tu agenda"}
        title="Trabajo"
        description="Los términos procesales se calculan con regla y fuente; nunca son fechas sueltas."
      />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <Module
          className="lg:col-span-2"
          eyebrow="Ordenado por urgencia"
          title="Términos y tareas"
          padded={false}
          action={
            overdueRows.length > 0 ? (
              <StatusChip
                label={`${overdueRows.length} ${overdueRows.length === 1 ? "vencido" : "vencidos"}`}
                tone="critical"
                dot
              />
            ) : null
          }
        >
          {loading ? (
            <div className="space-y-2 px-5 pb-5">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : nothing ? (
            <div className="px-5 pb-5">
              <p className="text-[13.5px] text-iusia-carbon">
                No tienes términos ni tareas pendientes.
              </p>
              <p className="mt-1 text-[12.5px] text-iusia-mist-text">
                Los términos se crean dentro de cada expediente, con su regla de cómputo.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-iusia-line/70">
              {overdueRows.map((t) => (
                <WorkRow key={t.task_id} row={t} overdue />
              ))}
              {upcomingRows.map((d) => (
                <WorkRow key={d.task_id} row={d} />
              ))}
            </ul>
          )}
        </Module>

        <Module title="Tus expedientes" eyebrow="Acceso rápido" padded={false}>
          {matters.isLoading ? (
            <div className="px-5 pb-5">
              <Skeleton className="h-16" />
            </div>
          ) : (matters.data?.matters.length ?? 0) === 0 ? (
            <p className="px-5 pb-5 text-[13px] text-iusia-mist-text">
              Todavía no tienes expedientes asignados.
            </p>
          ) : (
            <ul className="divide-y divide-iusia-line/70">
              {(matters.data?.matters ?? []).slice(0, 6).map((m) => (
                <li key={m.id}>
                  <Link
                    to={`/casos/${m.id}`}
                    className="block px-5 py-2.5 transition-colors hover:bg-iusia-ice/70"
                  >
                    <span className="block truncate text-[13.5px] font-medium text-iusia-navy">
                      {m.title}
                    </span>
                    <span className="block truncate text-[12px] text-iusia-mist-text">
                      {m.clientName}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Module>
      </div>
    </div>
  );
}

/**
 * Una obligación del abogado. Lo vencido y lo próximo comparten estructura porque
 * son la misma clase de cosa; lo que cambia es la urgencia, y eso lo dice la fecha
 * y el color, no una caja distinta.
 */
function WorkRow({ row, overdue = false }: { row: IntelTask | IntelDeadline; overdue?: boolean }) {
  const due = row.due_at ? new Date(row.due_at) : null;
  const days = due ? Math.ceil((due.getTime() - Date.now()) / 86_400_000) : null;
  const rule = "rule" in row ? row.rule : null;

  return (
    <li>
      <Link
        to={`/casos/${row.matter_id}`}
        className="flex items-center gap-3.5 px-5 py-3 transition-colors hover:bg-iusia-ice/70"
      >
        <span
          className={
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] " +
            (overdue ? "bg-iusia-critical/10 text-iusia-critical" : "bg-iusia-navy/8 text-iusia-navy")
          }
          aria-hidden
        >
          {rule ? <Scale size={15} /> : <CalendarClock size={15} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-iusia-navy">
            {row.title}
          </span>
          {rule ? (
            <span className="block truncate text-[12px] text-iusia-mist-text">
              Término procesal · {rule}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-right">
          <span
            className={
              "block text-[12.5px] tnum " +
              (overdue ? "font-medium text-iusia-critical" : "text-iusia-carbon")
            }
          >
            {due ? due.toLocaleDateString("es-CO") : "Sin fecha"}
          </span>
          {days !== null ? (
            <span className="block text-[11.5px] text-iusia-mist-text">
              {days < 0
                ? `${Math.abs(days)} d de retraso`
                : days === 0
                  ? "vence hoy"
                  : `en ${days} d`}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}
