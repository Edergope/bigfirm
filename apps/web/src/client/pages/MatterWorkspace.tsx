import { useState } from "react";
import { useParams, Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  ExecutionStatusChip,
  MatterStatusChip,
  RiskIndicator,
  StatusChip,
} from "@iusia/ui";
import type { ExecutionStatus, RiskLevel } from "@iusia/domain";
import { api, ApiError } from "../api.js";
import { StrategyRoom } from "./StrategyRoom.js";

/**
 * Workspace del caso. Jerarquía fijada por el Design System §06:
 * 1) qué pasa, 2) qué debo hacer, 3) qué sabemos, 4) qué recomienda IUSIA, 5) qué ocurrió.
 */
const TABS = [
  { id: "resumen", label: "Resumen" },
  { id: "documentos", label: "Documentos" },
  { id: "hechos", label: "Hechos y fuentes" },
  { id: "estrategia", label: "Estrategia" },
  { id: "actividad", label: "Actividad" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function MatterWorkspace() {
  const { matterId = "" } = useParams();
  const [tab, setTab] = useState<TabId>("resumen");
  const detail = useQuery({
    queryKey: ["matter", matterId],
    queryFn: () => api.getMatter(matterId),
    enabled: matterId.length > 0,
  });

  if (detail.isLoading) return <EmptyState title="Cargando expediente…" />;
  if (detail.error) {
    return (
      <EmptyState
        title="Expediente no disponible"
        hint={
          detail.error instanceof ApiError
            ? detail.error.message
            : "No fue posible cargar el expediente."
        }
      />
    );
  }
  const data = detail.data;
  if (!data) return null;
  const m = data.matter;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <Link to="/casos" className="text-[13px] text-iusia-action hover:underline">
            ← Casos
          </Link>
          <h1 className="mt-1 truncate text-xl font-semibold text-iusia-navy">{m.title}</h1>
          <p className="mt-1 text-[14px] text-iusia-mist">
            {m.reference} · {m.clientName} · {m.jurisdiction}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusChip
            label={m.materiality}
            tone={m.materiality === "HIGH_STAKES" ? "warning" : "neutral"}
          />
          <MatterStatusChip status={m.status} />
        </div>
      </div>

      {data.access.via_supervision ? (
        <div className="rounded-lg border border-iusia-action/30 bg-iusia-action/5 px-4 py-3 text-[14px] text-iusia-action">
          Estás viendo este expediente por supervisión de dirección, no por asignación.
          El acceso quedó registrado en la auditoría del caso.
        </div>
      ) : null}

      <nav className="flex gap-1 border-b border-iusia-mist/30">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={
              tab === t.id
                ? "border-b-2 border-iusia-action px-4 py-2 text-[14px] font-medium text-iusia-navy"
                : "px-4 py-2 text-[14px] text-iusia-mist hover:text-iusia-carbon"
            }
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "resumen" ? <Resumen matterId={matterId} data={data} /> : null}
      {tab === "documentos" ? <Documentos data={data} /> : null}
      {tab === "hechos" ? <Hechos data={data} /> : null}
      {tab === "estrategia" ? <Estrategia matterId={matterId} data={data} /> : null}
      {tab === "actividad" ? <Actividad data={data} /> : null}
    </div>
  );
}

type Detail = NonNullable<ReturnType<typeof useQuery<Awaited<ReturnType<typeof api.getMatter>>>>["data"]>;

function Resumen({ matterId, data }: { matterId: string; data: Detail }) {
  return (
    <div className="grid grid-cols-3 gap-5">
      <div className="col-span-2 flex flex-col gap-5">
        <Card>
          <CardHeader title="Qué pasa" />
          <div className="px-6 py-5">
            <p className="text-[15px] leading-relaxed text-iusia-carbon">
              {data.matter.objective ?? "Sin objetivo registrado para este expediente."}
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Equipo del caso" />
          {data.members.length === 0 ? (
            <EmptyState title="Sin miembros asignados" />
          ) : (
            <ul className="divide-y divide-iusia-mist/20">
              {data.members.map((member) => (
                <li
                  key={member.userId}
                  className="flex items-center justify-between px-6 py-3 text-[14px]"
                >
                  <span className="font-mono text-[13px] text-iusia-mist">{member.userId}</span>
                  <span className="flex items-center gap-2">
                    {member.delegatedByUserId ? (
                      <StatusChip label="Delegado" tone="info" />
                    ) : null}
                    <StatusChip label={member.role} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="flex flex-col gap-5">
        <Card className="px-6 py-5">
          <p className="mb-3 text-[15px] font-semibold text-iusia-navy">Riesgo</p>
          <RiskIndicator
            level={data.matter.riskLevel as RiskLevel}
            rationale={data.matter.riskRationale}
          />
        </Card>

        <Card>
          <CardHeader title="Ejecuciones de IA" />
          {data.executions.length === 0 ? (
            <EmptyState
              title="Sin ejecuciones"
              hint="Inicia una orquestación desde la pestaña Estrategia."
            />
          ) : (
            <ul className="divide-y divide-iusia-mist/20">
              {data.executions.slice(0, 6).map((e) => (
                <li key={e.id} className="flex items-center justify-between px-6 py-3">
                  <span className="min-w-0 text-[14px]">
                    <span className="block truncate">{e.agentId}</span>
                    <span className="block text-[13px] text-iusia-mist">
                      {e.model ?? "—"}
                      {e.creditsConsumed ? ` · ${e.creditsConsumed} créditos` : ""}
                    </span>
                  </span>
                  <ExecutionStatusChip status={e.status as ExecutionStatus} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Link
          to={`/casos/${matterId}?tab=estrategia`}
          className="text-[14px] text-iusia-action hover:underline"
        >
          Ver Strategy Room →
        </Link>
      </div>
    </div>
  );
}

function Documentos({ data }: { data: Detail }) {
  return (
    <Card>
      <CardHeader title="Expediente documental" />
      <div className="border-b border-iusia-mist/25 px-6 py-3 text-[13px] text-iusia-mist">
        Los archivos permanecen en Google Drive. IUSIA administra referencias, clasificación
        y estado de revisión — no duplica el archivo.
      </div>
      {data.documents.length === 0 ? (
        <EmptyState
          title="Sin documentos vinculados"
          hint="La vinculación desde Google Drive Picker requiere credenciales OAuth aún no aprovisionadas."
        />
      ) : (
        <ul className="divide-y divide-iusia-mist/20">
          {data.documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between px-6 py-3">
              <span className="min-w-0">
                <span className="block truncate text-[15px]">{d.name}</span>
                <span className="block text-[13px] text-iusia-mist">{d.classification}</span>
              </span>
              <StatusChip label={d.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const CERTAINTY_LABEL: Record<string, string> = {
  "[F]": "Hecho acreditado",
  "[A]": "Alegado",
  "[D]": "Documental",
  "[I]": "Inferido",
  "[C]": "Contradicho",
  "[U]": "No verificado",
  "[R]": "Referido",
  "[X]": "Descartado",
};

function Hechos({ data }: { data: Detail }) {
  return (
    <div className="grid grid-cols-2 gap-5">
      <Card>
        <CardHeader title="Fact Ledger" />
        {data.facts.length === 0 ? (
          <EmptyState
            title="Sin hechos registrados"
            hint="El agente 01 de intake establece la base fáctica al ejecutarse."
          />
        ) : (
          <ul className="divide-y divide-iusia-mist/20">
            {data.facts.map((f) => (
              <li key={f.id} className="px-6 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[15px] leading-snug">{f.statement}</p>
                  <StatusChip label={CERTAINTY_LABEL[f.certainty] ?? f.certainty} />
                </div>
                <p className="mt-1 text-[13px] text-iusia-mist">Fuente: {f.primarySource}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Authority Ledger" />
        {data.authorities.length === 0 ? (
          <EmptyState
            title="Sin autoridades registradas"
            hint="El agente 03 de investigación registra normas y jurisprudencia verificables."
          />
        ) : (
          <ul className="divide-y divide-iusia-mist/20">
            {data.authorities.map((a) => (
              <li key={a.id} className="px-6 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[15px] font-medium">{a.citation}</p>
                  <StatusChip
                    label={a.status}
                    tone={a.status === "VERIFIED_CURRENT" ? "success" : "warning"}
                  />
                </div>
                <p className="mt-1 text-[13px] text-iusia-mist">{a.ruleSummary}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Estrategia({ matterId, data }: { matterId: string; data: Detail }) {
  const queryClient = useQueryClient();
  const [objective, setObjective] = useState(data.matter.objective ?? "");

  const roots = data.executions.filter((e) => e.parentExecutionId === null);
  const latestRoot = roots[0]?.rootExecutionId ?? null;

  const start = useMutation({
    mutationFn: () => api.startOrchestration(matterId, objective),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["matter", matterId] }),
  });

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Iniciar orquestación jurídica" />
        <div className="px-6 py-5">
          <p className="mb-3 text-[14px] text-iusia-mist">
            Se ejecutarán agentes reales del piloto (00 Managing Partner → 01 Intake → 03
            Investigación). Cada ejecución queda registrada en el Execution Ledger con su
            propio identificador, proveedor, modelo y costo.
          </p>
          <textarea
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            rows={3}
            placeholder="Objetivo jurídico concreto del encargo (mínimo 10 caracteres)"
            className="w-full rounded-lg border border-iusia-mist/60 px-3 py-2 text-[15px]"
          />
          {start.error ? (
            <p role="alert" className="mt-2 text-[14px] text-iusia-critical">
              {start.error instanceof ApiError ? start.error.message : "Error al iniciar"}
            </p>
          ) : null}
          <div className="mt-3">
            <Button
              onClick={() => start.mutate()}
              disabled={start.isPending || objective.trim().length < 10}
            >
              {start.isPending ? "Despachando…" : "Ejecutar orquestación"}
            </Button>
          </div>
        </div>
      </Card>

      {latestRoot ? (
        <StrategyRoom rootExecutionId={latestRoot} />
      ) : (
        <Card>
          <CardHeader title="Strategy Room" />
          <EmptyState
            title="Sin ejecuciones registradas"
            hint="El grafo se construye a partir de eventos reales del Execution Ledger. Sin ejecución no hay nodos."
          />
        </Card>
      )}
    </div>
  );
}

function Actividad({ data }: { data: Detail }) {
  return (
    <Card>
      <CardHeader title="Auditoría del expediente" />
      <div className="border-b border-iusia-mist/25 px-6 py-3 text-[13px] text-iusia-mist">
        Registro jurídico de decisiones y accesos, separado de los logs técnicos.
      </div>
      {data.activity.length === 0 ? (
        <EmptyState title="Sin actividad registrada" />
      ) : (
        <ul className="divide-y divide-iusia-mist/20">
          {data.activity.map((a) => (
            <li key={a.id} className="flex items-center justify-between px-6 py-3">
              <span>
                <span className="block text-[14px]">{a.action}</span>
                <span className="block text-[13px] text-iusia-mist">
                  {a.resourceType}
                  {a.reason ? ` · ${a.reason}` : ""}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <StatusChip
                  label={a.outcome}
                  tone={
                    a.outcome === "DENIED" || a.outcome === "FAILURE" ? "critical" : "success"
                  }
                />
                <time className="text-[13px] tabular-nums text-iusia-mist">
                  {new Date(a.occurredAt).toLocaleString("es-CO")}
                </time>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
