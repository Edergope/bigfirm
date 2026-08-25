import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, KpiTile, PageHeader, Skeleton, StateBlock, StatusChip } from "@iusia/ui";
import { api, ApiError } from "../api.js";

/**
 * Control IUSIA — cómo está funcionando el sistema.
 *
 * Superficie exclusiva de la autoridad de plataforma. Aquí SÍ procede el detalle
 * técnico que la experiencia jurídica oculta: estado de ejecuciones, consumo,
 * integraciones y clasificación operacional de los agentes. No administra clientes
 * ni facturación: controla el sistema.
 *
 * La visibilidad se decide con la capacidad que devuelve el servidor; cada ruta que
 * consume esta vista vuelve a exigir autoridad de sistema.
 */
const TABS = [
  { id: "sistema", label: "Sistema" },
  { id: "agentes", label: "Agentes" },
  { id: "ejecuciones", label: "Ejecuciones" },
  { id: "integraciones", label: "Integraciones" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function SystemControl() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const [tab, setTab] = useState<TabId>("sistema");

  if (me.isLoading) return <Skeleton className="h-64" />;
  if (!me.data?.is_system_superadmin) {
    return (
      <Card>
        <StateBlock
          kind="error"
          title="Sin autoridad de sistema"
          hint="El control de IUSIA corresponde a la administración de la plataforma."
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Control IUSIA"
        description="Estado del sistema, equipo de agentes, ejecuciones e integraciones."
        actions={<StatusChip label="Autoridad de sistema" tone="intel" dot />}
      />

      <div role="tablist" aria-label="Áreas de control" className="flex gap-0.5 border-b border-iusia-line">
        {TABS.map((t) => {
          const selected = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(t.id)}
              className={
                selected
                  ? "-mb-px border-b-2 border-iusia-action px-3.5 py-2.5 text-[14px] font-medium text-iusia-navy"
                  : "px-3.5 py-2.5 text-[14px] text-iusia-mist-text transition-colors hover:text-iusia-carbon"
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "sistema" ? <SystemTab credits={me.data.credits} /> : null}
      {tab === "agentes" ? <AgentsTab /> : null}
      {tab === "ejecuciones" ? <ExecutionsTab /> : null}
      {tab === "integraciones" ? <IntegrationsTab /> : null}
    </div>
  );
}

function SystemTab({ credits }: { credits: number }) {
  const agents = useQuery({ queryKey: ["agents"], queryFn: api.agents });
  const execs = useQuery({ queryKey: ["system-executions"], queryFn: api.systemExecutions });

  const rows = execs.data?.executions ?? [];
  const spent = rows.reduce((s, r) => s + r.credits, 0);
  const failed = rows.filter((r) => r.status === "FAILED").length;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile label="Agentes canónicos" value={String(agents.data?.canonical_total ?? 30)} />
        <KpiTile label="Operacionales" value={String((agents.data?.agents ?? []).filter((a) => a.enabled).length)} />
        <KpiTile label="Créditos disponibles" value={credits.toLocaleString("es-CO")} />
        <KpiTile
          label="Ejecuciones con fallo"
          value={String(failed)}
          tone={failed > 0 ? "warning" : "navy"}
        />
      </div>
      <Card>
        <CardHeader title="Consumo reciente" subtitle="Créditos por las últimas orquestaciones" />
        <div className="px-6 py-5">
          <p className="text-[15px] text-iusia-carbon">
            <span className="font-semibold tabular-nums">{spent.toLocaleString("es-CO")}</span> créditos
            en {rows.length} orquestacion{rows.length === 1 ? "es" : "es"} recientes.
          </p>
          <p className="mt-1 text-[13px] text-iusia-mist-text">
            El detalle por ejecución está en la pestaña Ejecuciones.
          </p>
        </div>
      </Card>
    </div>
  );
}

function AgentsTab() {
  const agents = useQuery({ queryKey: ["agents"], queryFn: api.agents });
  if (agents.isLoading) return <Skeleton className="h-64" />;
  const list = agents.data?.agents ?? [];

  return (
    <Card>
      <CardHeader
        title="Equipo canónico"
        subtitle={`${list.length} agentes registrados · el contenido jurídico de cada uno es propiedad intelectual y no se edita desde aquí`}
      />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13.5px]">
          <thead className="border-b border-iusia-line text-[12px] uppercase tracking-wide text-iusia-mist-text">
            <tr>
              <th className="px-6 py-2.5 font-medium">Agente</th>
              <th className="px-3 py-2.5 font-medium">Rol operativo</th>
              <th className="px-3 py-2.5 font-medium">Estado</th>
              <th className="px-6 py-2.5 font-medium">Seleccionable</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-iusia-mist/15">
            {list.map((a) => (
              <tr key={a.agent_id} className="align-top">
                <td className="px-6 py-2.5">
                  <span className="block text-iusia-carbon">
                    <span className="mr-2 font-mono text-[11.5px] text-iusia-mist-text">{a.node_code}</span>
                    {a.name}
                  </span>
                  <span className="block max-w-md truncate text-[12px] text-iusia-mist-text">
                    {a.specialty}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-[12.5px] text-iusia-mist-text">{a.runtime_role}</td>
                <td className="px-3 py-2.5">
                  <StatusChip
                    label={a.enabled ? "Operacional" : "En reserva"}
                    tone={a.enabled ? "success" : "neutral"}
                  />
                </td>
                <td className="px-6 py-2.5">
                  <StatusChip
                    label={a.planner_eligible ? "Sí" : "No"}
                    tone={a.planner_eligible ? "intel" : "neutral"}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ExecutionsTab() {
  const execs = useQuery({ queryKey: ["system-executions"], queryFn: api.systemExecutions });
  if (execs.isLoading) return <Skeleton className="h-64" />;
  if (execs.error) {
    return (
      <Card>
        <StateBlock
          kind="error"
          title="No fue posible cargar las ejecuciones"
          hint={execs.error instanceof ApiError ? execs.error.message : undefined}
        />
      </Card>
    );
  }
  const rows = execs.data?.executions ?? [];

  return (
    <Card>
      <CardHeader title="Orquestaciones recientes" subtitle="Estado real del Execution Ledger" />
      {rows.length === 0 ? (
        <StateBlock kind="empty" title="Sin orquestaciones registradas" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13.5px]">
            <thead className="border-b border-iusia-line text-[12px] uppercase tracking-wide text-iusia-mist-text">
              <tr>
                <th className="px-6 py-2.5 font-medium">Expediente</th>
                <th className="px-3 py-2.5 font-medium">Estado</th>
                <th className="px-3 py-2.5 font-medium">Agentes</th>
                <th className="px-3 py-2.5 font-medium">Créditos</th>
                <th className="px-6 py-2.5 font-medium">Inicio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-iusia-mist/15">
              {rows.map((r) => (
                <tr key={r.root_execution_id}>
                  <td className="px-6 py-2.5">
                    <Link to={`/casos/${r.matter_id}`} className="text-iusia-action hover:underline">
                      {r.matter_title}
                    </Link>
                    {r.error_code ? (
                      <span className="block text-[12px] text-iusia-critical">{r.error_code}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusChip
                      label={r.status}
                      tone={
                        r.status === "COMPLETED" ? "success" : r.status === "FAILED" ? "critical" : "info"
                      }
                    />
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-iusia-carbon">{r.agents}</td>
                  <td className="px-3 py-2.5 tabular-nums text-iusia-carbon">{r.credits}</td>
                  <td className="px-6 py-2.5 tabular-nums text-iusia-mist-text">
                    {new Date(r.started_at).toLocaleString("es-CO")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function IntegrationsTab() {
  const drive = useQuery({ queryKey: ["drive-status"], queryFn: api.driveStatus });
  const integrations = useQuery({ queryKey: ["integrations"], queryFn: api.integrationsStatus });

  const items = [
    {
      name: "Google Drive",
      state: drive.data?.connected ? "Conectado" : "Sin conectar",
      ok: drive.data?.connected === true,
      note: "Origen documental del expediente",
    },
    {
      name: "AI Search",
      state: integrations.data?.retrieval.status ?? "—",
      ok: integrations.data?.retrieval.status === "CONNECTED",
      note: "Recuperación de evidencia del expediente",
    },
    {
      name: "Almacenamiento",
      state: integrations.data?.storage.status ?? "—",
      ok: integrations.data?.storage.status === "CONNECTED",
      note: "Espejo documental y salidas de agentes",
    },
  ];

  return (
    <Card>
      <CardHeader title="Integraciones" subtitle="Estado real de los servicios externos. Nunca se muestran credenciales." />
      <ul className="divide-y divide-iusia-line">
        {items.map((i) => (
          <li key={i.name} className="flex items-center justify-between px-6 py-3.5">
            <span className="min-w-0">
              <span className="block text-[14.5px] text-iusia-carbon">{i.name}</span>
              <span className="block text-[12.5px] text-iusia-mist-text">{i.note}</span>
            </span>
            <StatusChip label={i.state} tone={i.ok ? "success" : "warning"} dot />
          </li>
        ))}
      </ul>
    </Card>
  );
}
