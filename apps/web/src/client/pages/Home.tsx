import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Card, CardHeader, EmptyState, KpiTile, MatterStatusChip } from "@iusia/ui";
import { api } from "../api.js";

/**
 * Inicio / Mi trabajo.
 *
 * Sólo muestra métricas derivables de datos reales del alcance del usuario.
 * No hay KPIs decorativos ni tendencias inventadas (Design System §02).
 */
export function Home() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const matters = useQuery({ queryKey: ["matters"], queryFn: api.listMatters });

  const rows = matters.data?.matters ?? [];
  const active = rows.filter((m) => m.status === "ACTIVE" || m.status === "INTAKE").length;
  const atRisk = rows.filter(
    (m) => (m.riskLevel === "HIGH" || m.riskLevel === "CRITICAL") && m.riskRationale,
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-iusia-navy">
          {me.data ? `Buen día, ${me.data.user.name}` : "Inicio"}
        </h1>
        <p className="mt-1 text-[14px] text-iusia-mist">
          {matters.data?.scope === "FIRM"
            ? "Vista de dirección: cartera completa de la firma."
            : "Expedientes en los que participas."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile label="Expedientes en tu alcance" value={String(rows.length)} />
        <KpiTile label="Activos o en intake" value={String(active)} />
        <KpiTile
          label="Riesgo alto o crítico"
          value={String(atRisk)}
          trend="Sólo casos con metodología registrada"
        />
        <KpiTile label="Créditos disponibles" value={String(me.data?.credits ?? 0)} />
      </div>

      <Card>
        <CardHeader
          title="Actividad reciente de expedientes"
          action={
            <Link to="/casos" className="text-[14px] text-iusia-action hover:underline">
              Ver todos
            </Link>
          }
        />
        {rows.length === 0 ? (
          <EmptyState
            title="Aún no hay expedientes"
            hint="Crea el primer caso desde la vista de Casos para iniciar el flujo de intake."
          />
        ) : (
          <ul className="divide-y divide-iusia-mist/25">
            {rows.slice(0, 6).map((m) => (
              <li key={m.id}>
                <Link
                  to={`/casos/${m.id}`}
                  className="flex items-center justify-between gap-4 px-6 py-3 hover:bg-iusia-surface"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium text-iusia-carbon">
                      {m.title}
                    </span>
                    <span className="block text-[13px] text-iusia-mist">
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
    </div>
  );
}
