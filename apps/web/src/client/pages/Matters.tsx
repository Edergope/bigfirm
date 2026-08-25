import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Drawer,
  Field,
  Input,
  MetricRail,
  PageHeader,
  Select,
  Skeleton,
  StateBlock,
  StatusChip,
  Textarea,
  Workspace,
  materialityTerm,
  matterStatusTerm,
  practiceAreaLabel,
  riskTerm,
} from "@iusia/ui";
import { api, ApiError, type MatterSummary } from "../api.js";

const PRACTICE_AREAS = [
  "CIVIL", "COMERCIAL_CONTRACTUAL", "SOCIETARIO_MA", "LABORAL", "TRIBUTARIO",
  "PENAL_ECONOMICO", "ADMINISTRATIVO", "CONSTITUCIONAL", "FAMILIA", "INMOBILIARIO",
  "PROPIEDAD_INTELECTUAL", "INSOLVENCIA", "MIGRATORIO", "FINANCIERO", "COMPLIANCE", "OTRO",
];

const MATERIALITY_HELP: Record<string, string> = {
  SIMPLE: "Ruta corta: sólo la fundación, sin gates de aprobación humana.",
  MATERIAL: "Ruta estándar: especialistas, estrategia y auditoría de citas.",
  HIGH_STAKES: "Aprobación humana en gates de estrategia e integridad.",
};

/** Un expediente sin movimiento en 21 días es una señal de cartera, no de caso. */
const INACTIVE_DAYS = 21;
const ACTIVE_STATUSES = new Set(["INTAKE", "ACTIVE", "WAITING_CLIENT", "IN_REVIEW", "ON_HOLD"]);

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function relativeDays(iso: string): string {
  const d = daysSince(iso);
  if (d <= 0) return "hoy";
  if (d === 1) return "ayer";
  if (d < 30) return `hace ${d} d`;
  const months = Math.floor(d / 30);
  return months === 1 ? "hace 1 mes" : `hace ${months} meses`;
}

export function Matters() {
  const queryClient = useQueryClient();
  const matters = useQuery({ queryKey: ["matters"], queryFn: api.listMatters });
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const rows = useMemo(() => {
    const all = matters.data?.matters ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.clientName.toLowerCase().includes(q) ||
        m.reference.toLowerCase().includes(q),
    );
  }, [matters.data, filter]);

  const all = matters.data?.matters ?? [];

  // Resumen de cartera. Sólo cifras derivadas de expedientes reales; si un dato no
  // existe en el modelo, no se inventa una tarjeta para rellenar la fila.
  const summary = useMemo(
    () => [
      {
        id: "activos",
        label: "Activos",
        value: String(all.filter((m) => ACTIVE_STATUSES.has(m.status)).length),
        tone: "navy" as const,
      },
      {
        id: "criticos",
        label: "Riesgo alto",
        value: String(all.filter((m) => m.riskLevel === "HIGH" || m.riskLevel === "CRITICAL").length),
        tone: "critical" as const,
      },
      {
        id: "criticidad",
        label: "Alta criticidad",
        value: String(all.filter((m) => m.materiality === "HIGH_STAKES").length),
        tone: "gold" as const,
      },
      {
        id: "detenidos",
        label: "Sin actividad",
        value: String(
          all.filter((m) => ACTIVE_STATUSES.has(m.status) && daysSince(m.updatedAt) >= INACTIVE_DAYS)
            .length,
        ),
        hint: `${INACTIVE_DAYS} días o más`,
        tone: "warning" as const,
      },
    ],
    [all],
  );

  return (
    <div className="flex min-h-[calc(100vh-118px)] flex-col gap-4">
      <PageHeader
        title="Cartera de casos"
        description={
          matters.data?.scope === "FIRM"
            ? "Todos los expedientes de la firma. Tu acceso de dirección queda auditado."
            : "Los expedientes que tienes asignados."
        }
        actions={<Button onClick={() => setOpen(true)}>Nuevo expediente</Button>}
      />

      {all.length > 0 ? <MetricRail items={summary} /> : null}

      <Workspace
        className="flex min-h-0 flex-1 flex-col"
        toolbar={
          <>
            <Input
              placeholder="Buscar por asunto, cliente o referencia…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Buscar expedientes"
              className="h-8 w-full max-w-xs text-[13.5px]"
            />
            <span className="ml-auto text-[12.5px] text-iusia-mist-text tnum">
              {rows.length} de {all.length}
            </span>
          </>
        }
      >

        {matters.isLoading ? (
          <div className="space-y-2 p-5">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : rows.length === 0 ? (
          <StateBlock
            kind="empty"
            title={filter ? "Sin coincidencias" : "No hay expedientes en tu alcance"}
            hint={filter ? "Ajusta el filtro." : "Crea uno o pide que te asignen a un caso."}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[880px] text-left">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-iusia-line-strong bg-iusia-paper text-[11.5px] font-semibold uppercase tracking-[0.06em] text-iusia-mist-text">
                  <th className="py-2 pl-5 pr-3 font-semibold">Asunto</th>
                  <th className="px-3 py-2 font-semibold">Cliente</th>
                  <th className="px-3 py-2 font-semibold">Estado</th>
                  <th className="px-3 py-2 font-semibold">Criticidad</th>
                  <th className="px-3 py-2 font-semibold">Riesgo</th>
                  <th className="py-2 pl-3 pr-5 text-right font-semibold">Actividad</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-iusia-line">
                {rows.map((m) => (
                  <MatterRow key={m.id} matter={m} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Workspace>

      <Drawer open={open} onClose={() => setOpen(false)} title="Nuevo expediente" width={520}>
        <NewMatterForm
          onCreated={() => {
            setOpen(false);
            void queryClient.invalidateQueries({ queryKey: ["matters"] });
          }}
        />
      </Drawer>
    </div>
  );
}

/**
 * Fila de cartera. La referencia acompaña al asunto en vez de ocupar su propia
 * columna: nadie busca un expediente por su código, pero sí lo necesita a la vista
 * para citarlo. Eso libera ancho para lo que sí se compara entre casos —estado,
 * criticidad, riesgo y cuándo se movió por última vez.
 */
function MatterRow({ matter: m }: { matter: MatterSummary }) {
  const status = matterStatusTerm(m.status);
  const materiality = materialityTerm(m.materiality);
  const risk = riskTerm(m.riskLevel);
  const stale = ACTIVE_STATUSES.has(m.status) && daysSince(m.updatedAt) >= INACTIVE_DAYS;

  return (
    <tr className="group transition-colors hover:bg-iusia-surface/70">
      <td className="py-2.5 pl-5 pr-3">
        <Link to={`/casos/${m.id}`} className="block">
          <span className="block truncate text-[14px] font-medium text-iusia-navy group-hover:text-iusia-action">
            {m.title}
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-[12px] text-iusia-mist-text">
            <span className="tnum">{m.reference}</span>
            {m.practiceAreas[0] ? (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{practiceAreaLabel(m.practiceAreas[0])}</span>
              </>
            ) : null}
          </span>
        </Link>
      </td>
      <td className="px-3 py-2.5 text-[13.5px] text-iusia-carbon">
        <span className="block max-w-[240px] truncate">{m.clientName}</span>
      </td>
      <td className="px-3 py-2.5">
        <StatusChip label={status.label} tone={status.tone} title={status.hint} />
      </td>
      <td className="px-3 py-2.5">
        <StatusChip label={materiality.label} tone={materiality.tone} title={materiality.hint} />
      </td>
      <td className="px-3 py-2.5">
        {/* El riesgo sin metodología registrada se muestra como ausencia, no como
            un indicador que el abogado no puede auditar. */}
        {m.riskLevel === "UNASSESSED" || !m.riskRationale ? (
          <span className="text-[12.5px] text-iusia-mist-text">—</span>
        ) : (
          <StatusChip label={risk.label} tone={risk.tone} title={m.riskRationale} dot />
        )}
      </td>
      <td className="py-2.5 pl-3 pr-5 text-right">
        <span
          className={
            "text-[12.5px] tnum " + (stale ? "font-medium text-iusia-warning-text" : "text-iusia-mist-text")
          }
          title={new Date(m.updatedAt).toLocaleString("es-CO")}
        >
          {relativeDays(m.updatedAt)}
        </span>
      </td>
    </tr>
  );
}

function NewMatterForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [jurisdiction, setJurisdiction] = useState("Colombia");
  const [materiality, setMateriality] = useState("MATERIAL");
  const [area, setArea] = useState("COMERCIAL_CONTRACTUAL");
  const [objective, setObjective] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api.createMatter({
        title,
        client_name: clientName,
        materiality,
        practice_areas: [area],
        jurisdiction,
        objective: objective || undefined,
      }),
    onSuccess: onCreated,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Asunto">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </Field>
      <Field label="Cliente">
        <Input value={clientName} onChange={(e) => setClientName(e.target.value)} required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Jurisdicción">
          <Input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} required />
        </Field>
        <Field label="Área de práctica">
          <Select value={area} onChange={(e) => setArea(e.target.value)}>
            {PRACTICE_AREAS.map((a) => (
              <option key={a} value={a}>
                {practiceAreaLabel(a)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {/* La materialidad gobierna cuántos especialistas intervienen y qué gates son
          obligatorios: se elige con su consecuencia a la vista, no con su enum. */}
      <Field label="Criticidad del encargo" hint={MATERIALITY_HELP[materiality]}>
        <Select value={materiality} onChange={(e) => setMateriality(e.target.value)}>
          {Object.keys(MATERIALITY_HELP).map((m) => (
            <option key={m} value={m}>
              {materialityTerm(m).label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Objetivo del cliente (opcional)">
        <Textarea rows={3} value={objective} onChange={(e) => setObjective(e.target.value)} />
      </Field>

      {create.error ? (
        <p role="alert" className="text-[13.5px] text-iusia-critical">
          {create.error instanceof ApiError ? create.error.message : "Error al crear"}
        </p>
      ) : null}

      <div className="mt-1 flex justify-end">
        <Button type="submit" disabled={create.isPending || !title || !clientName}>
          {create.isPending ? "Creando…" : "Crear expediente"}
        </Button>
      </div>
    </form>
  );
}
