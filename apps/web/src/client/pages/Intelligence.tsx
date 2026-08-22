import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  Card,
  CardHeader,
  KpiTile,
  PageHeader,
  Skeleton,
  StateBlock,
  StatusChip,
} from "@iusia/ui";
import { api } from "../api.js";

/**
 * IUSIA Intelligence — vista de inteligencia operativa, NO un chat genérico.
 * La información estructurada domina; se deriva de tools read-only del servidor.
 */
export function Intelligence() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const firm = me.data?.firm_role === "FIRM_DIRECTOR";

  const health = useQuery({ queryKey: ["intel", "health", firm], queryFn: () => api.intelligence.caseHealth(firm), enabled: me.isSuccess });
  const risks = useQuery({ queryKey: ["intel", "risks", firm], queryFn: () => api.intelligence.risks(firm), enabled: me.isSuccess });
  const inactive = useQuery({ queryKey: ["intel", "inactive", firm], queryFn: () => api.intelligence.inactive(firm), enabled: me.isSuccess });
  const overdue = useQuery({ queryKey: ["intel", "overdue", firm], queryFn: () => api.intelligence.overdue(firm), enabled: me.isSuccess });

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        title="Inteligencia"
        description={firm ? "Visión transversal de la firma." : "Inteligencia sobre tus expedientes."}
        actions={firm ? <StatusChip label="Alcance: firma" tone="info" dot /> : <StatusChip label="Alcance: mis casos" tone="neutral" dot />}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {health.isLoading ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[92px]" />)
        ) : (
          <>
            <KpiTile label="Expedientes" value={String(health.data?.total ?? 0)} />
            <KpiTile label="Riesgo alto/crítico" value={String(health.data?.at_risk ?? 0)} tone={(health.data?.at_risk ?? 0) > 0 ? "critical" : "navy"} />
            <KpiTile label="Vencidos" value={String(overdue.data?.tasks.length ?? 0)} tone={(overdue.data?.tasks.length ?? 0) > 0 ? "warning" : "navy"} />
            <KpiTile label="Inactivos" value={String(inactive.data?.matters.length ?? 0)} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Riesgos" subtitle="Sólo casos con metodología registrada" />
          {risks.isLoading ? (
            <div className="p-5"><Skeleton className="h-16" /></div>
          ) : (risks.data?.risks.length ?? 0) === 0 ? (
            <StateBlock kind="empty" title="Sin riesgos registrados" hint="Los riesgos aparecen cuando existe justificación." />
          ) : (
            <ul className="divide-y divide-iusia-mist/20">
              {risks.data?.risks.map((r) => (
                <li key={r.matter_id} className="flex items-start justify-between gap-3 px-6 py-3">
                  <div className="min-w-0">
                    <Link to={`/casos/${r.matter_id}`} className="text-[14.5px] font-medium text-iusia-carbon hover:text-iusia-action">
                      {r.title}
                    </Link>
                    {r.rationale ? <p className="mt-0.5 text-[12.5px] text-iusia-mist-text line-clamp-2">{r.rationale}</p> : null}
                  </div>
                  <StatusChip
                    label={r.risk_level}
                    tone={r.risk_level === "CRITICAL" || r.risk_level === "HIGH" ? "critical" : "warning"}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Asuntos inactivos" subtitle="Sin actividad en 30 días" />
          {inactive.isLoading ? (
            <div className="p-5"><Skeleton className="h-16" /></div>
          ) : (inactive.data?.matters.length ?? 0) === 0 ? (
            <StateBlock kind="empty" title="Todo al día" hint="Ningún expediente lleva demasiado tiempo sin actividad." />
          ) : (
            <ul className="divide-y divide-iusia-mist/20">
              {inactive.data?.matters.map((m) => (
                <li key={m.matter_id} className="flex items-center justify-between gap-3 px-6 py-3">
                  <Link to={`/casos/${m.matter_id}`} className="truncate text-[14.5px] text-iusia-carbon hover:text-iusia-action">
                    {m.title}
                  </Link>
                  <time className="shrink-0 text-[12.5px] text-iusia-mist-text tnum">
                    {new Date(m.updated_at).toLocaleDateString("es-CO")}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
