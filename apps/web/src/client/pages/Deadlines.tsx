import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Card, CardHeader, PageHeader, Skeleton, StateBlock, StatusChip } from "@iusia/ui";
import { api } from "../api.js";

/**
 * Tareas y términos — vista transversal. La lógica jurídica de cálculo vive en el
 * servidor (DeadlineService); aquí sólo se representan las fechas.
 */
export function Deadlines() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const firm = me.data?.firm_role === "FIRM_DIRECTOR";
  const overdue = useQuery({ queryKey: ["intel", "overdue", firm], queryFn: () => api.intelligence.overdue(firm), enabled: me.isSuccess });
  const upcoming = useQuery({ queryKey: ["intel", "upcoming90", firm], queryFn: () => api.intelligence.upcoming(firm, 90), enabled: me.isSuccess });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tareas y términos"
        description="Los términos procesales se calculan con regla y fuente; nunca son fechas sueltas."
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Vencidos" subtitle="Requieren atención inmediata" />
          {overdue.isLoading ? (
            <div className="p-5"><Skeleton className="h-16" /></div>
          ) : (overdue.data?.tasks.length ?? 0) === 0 ? (
            <StateBlock kind="empty" title="Nada vencido" hint="Sin términos ni tareas vencidas." />
          ) : (
            <ul className="divide-y divide-iusia-mist/20">
              {overdue.data?.tasks.map((t) => (
                <li key={t.task_id} className="flex items-center justify-between gap-3 px-6 py-3">
                  <Link to={`/casos/${t.matter_id}`} className="truncate text-[14.5px] text-iusia-carbon hover:text-iusia-action">
                    {t.title}
                  </Link>
                  <span className="flex shrink-0 items-center gap-3">
                    <time className="text-[12.5px] text-iusia-mist-text tnum">
                      {t.due_at ? new Date(t.due_at).toLocaleDateString("es-CO") : "—"}
                    </time>
                    <StatusChip label="Vencido" tone="critical" dot />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Próximos 90 días" subtitle="Términos y tareas por vencer" />
          {upcoming.isLoading ? (
            <div className="p-5"><Skeleton className="h-16" /></div>
          ) : (upcoming.data?.deadlines.length ?? 0) === 0 ? (
            <StateBlock kind="empty" title="Sin próximos" hint="No hay términos en el horizonte cercano." />
          ) : (
            <ul className="divide-y divide-iusia-mist/20">
              {upcoming.data?.deadlines.map((d) => (
                <li key={d.task_id} className="px-6 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <Link to={`/casos/${d.matter_id}`} className="truncate text-[14.5px] text-iusia-carbon hover:text-iusia-action">
                      {d.title}
                    </Link>
                    <time className="shrink-0 text-[12.5px] text-iusia-mist-text tnum">
                      {d.due_at ? new Date(d.due_at).toLocaleDateString("es-CO") : "—"}
                    </time>
                  </div>
                  {d.rule ? <p className="mt-0.5 text-[12px] text-iusia-mist-text">{d.rule} · {d.source}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
