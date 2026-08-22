import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  Card,
  CardHeader,
  KpiTile,
  MatterStatusChip,
  PageHeader,
  Skeleton,
  StateBlock,
  StatusChip,
} from "@iusia/ui";
import { api } from "../api.js";

/**
 * Inicio / Mi trabajo. Responde "¿qué requiere mi atención?" con datos reales del
 * alcance del usuario. Sin métricas decorativas ni tendencias inventadas.
 */
export function Home() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const firm = me.data?.firm_role === "FIRM_DIRECTOR";

  const matters = useQuery({ queryKey: ["matters"], queryFn: api.listMatters });
  const health = useQuery({
    queryKey: ["intel", "health", firm],
    queryFn: () => api.intelligence.caseHealth(firm),
    enabled: me.isSuccess,
  });
  const overdue = useQuery({
    queryKey: ["intel", "overdue", firm],
    queryFn: () => api.intelligence.overdue(firm),
    enabled: me.isSuccess,
  });
  const upcoming = useQuery({
    queryKey: ["intel", "upcoming", firm],
    queryFn: () => api.intelligence.upcoming(firm, 15),
    enabled: me.isSuccess,
  });

  const rows = matters.data?.matters ?? [];

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        title={me.data ? `Buen día, ${me.data.user.name.split(" ")[0]}` : "Inicio"}
        description={
          firm
            ? "Vista de dirección: cartera completa de la firma."
            : "Tu trabajo y los expedientes que requieren atención."
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {health.isLoading ? (
          <>
            <Skeleton className="h-[92px]" />
            <Skeleton className="h-[92px]" />
            <Skeleton className="h-[92px]" />
            <Skeleton className="h-[92px]" />
          </>
        ) : (
          <>
            <KpiTile label="Expedientes en alcance" value={String(health.data?.total ?? 0)} />
            <KpiTile
              label="Términos y tareas vencidas"
              value={String(overdue.data?.tasks.length ?? 0)}
              tone={(overdue.data?.tasks.length ?? 0) > 0 ? "critical" : "navy"}
            />
            <KpiTile
              label="Próximos 15 días"
              value={String(upcoming.data?.deadlines.length ?? 0)}
              tone={(upcoming.data?.deadlines.length ?? 0) > 0 ? "warning" : "navy"}
            />
            <KpiTile
              label="Riesgo alto o crítico"
              value={String(health.data?.at_risk ?? 0)}
              hint="Sólo casos con metodología registrada"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Expedientes recientes"
            action={
              <Link to="/casos" className="text-[13.5px] font-medium text-iusia-action hover:underline">
                Ver todos
              </Link>
            }
          />
          {matters.isLoading ? (
            <div className="space-y-2 p-5">
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
            </div>
          ) : rows.length === 0 ? (
            <StateBlock
              kind="empty"
              title="Aún no hay expedientes"
              hint="Crea el primer caso para iniciar el flujo de intake."
            />
          ) : (
            <ul className="divide-y divide-iusia-mist/20">
              {rows.slice(0, 7).map((m) => (
                <li key={m.id}>
                  <Link
                    to={`/casos/${m.id}`}
                    className="flex items-center justify-between gap-4 px-6 py-3 transition-colors hover:bg-iusia-surface"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[14.5px] font-medium text-iusia-carbon">
                        {m.title}
                      </span>
                      <span className="block text-[12.5px] text-iusia-mist-text tnum">
                        {m.reference} · {m.clientName}
                      </span>
                    </span>
                    <MatterStatusChip status={m.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Requiere atención" />
          {overdue.isLoading ? (
            <div className="space-y-2 p-5">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          ) : (overdue.data?.tasks.length ?? 0) === 0 && (upcoming.data?.deadlines.length ?? 0) === 0 ? (
            <StateBlock kind="empty" title="Nada urgente" hint="Sin términos vencidos ni próximos." />
          ) : (
            <ul className="divide-y divide-iusia-mist/20">
              {overdue.data?.tasks.slice(0, 4).map((t) => (
                <li key={t.task_id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] text-iusia-carbon">{t.title}</p>
                    <Link to={`/casos/${t.matter_id}`} className="text-[12px] text-iusia-action hover:underline">
                      Abrir expediente
                    </Link>
                  </div>
                  <StatusChip label="Vencida" tone="critical" dot />
                </li>
              ))}
              {upcoming.data?.deadlines.slice(0, 4).map((d) => (
                <li key={d.task_id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] text-iusia-carbon">{d.title}</p>
                    <p className="text-[12px] text-iusia-mist-text tnum">
                      {d.due_at ? new Date(d.due_at).toLocaleDateString("es-CO") : "—"}
                    </p>
                  </div>
                  <StatusChip label="Próximo" tone="warning" dot />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
