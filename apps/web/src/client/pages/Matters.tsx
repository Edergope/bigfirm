import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Drawer,
  Field,
  Input,
  Module,
  ScreenTitle,
  Select,
  Skeleton,
  StateBlock,
  StatusChip,
  Textarea,
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
        label: "Expedientes activos",
        value: String(all.filter((m) => ACTIVE_STATUSES.has(m.status)).length),
        color: "text-iusia-navy",
      },
      {
        id: "criticos",
        label: "Riesgo alto o crítico",
        value: String(all.filter((m) => m.riskLevel === "HIGH" || m.riskLevel === "CRITICAL").length),
        color: "text-iusia-critical",
      },
      {
        id: "criticidad",
        label: "Alta criticidad",
        value: String(all.filter((m) => m.materiality === "HIGH_STAKES").length),
        color: "text-iusia-gold-text",
      },
      {
        id: "detenidos",
        label: "Sin actividad",
        hint: `${INACTIVE_DAYS} d+`,
        value: String(
          all.filter((m) => ACTIVE_STATUSES.has(m.status) && daysSince(m.updatedAt) >= INACTIVE_DAYS)
            .length,
        ),
        color: "text-iusia-warning-text",
      },
    ],
    [all],
  );

  return (
    <div className="pb-2">
      <ScreenTitle
        eyebrow="Cartera"
        title="Casos"
        description={
          matters.data?.scope === "FIRM"
            ? "Todos los expedientes de la firma. Tu acceso de dirección queda auditado."
            : "Los expedientes que tienes asignados."
        }
        actions={<Button onClick={() => setOpen(true)}>Nuevo expediente</Button>}
      />

      {/*
        El resumen NO es otra fila de métricas: vive como una columna lateral que
        acompaña a la cartera. Un expediente se lee en la lista; la salud de la
        cartera se lee al lado, sin robarle la primera pantalla.
      */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-4">
        <Module
          className="lg:col-span-3"
          padded={false}
          action={
            <div className="flex w-full items-center gap-3">
              <Input
                placeholder="Buscar por asunto, cliente o referencia…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label="Buscar expedientes"
                className="h-8 w-full max-w-xs rounded-[10px] text-[13px]"
              />
              <span className="ml-auto shrink-0 text-[12px] tnum text-iusia-mist-text">
                {rows.length} de {all.length}
              </span>
            </div>
          }
        >
          {matters.isLoading ? (
            <div className="space-y-2 px-5 pb-5">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          ) : rows.length === 0 ? (
            <StateBlock
              kind="empty"
              title={filter ? "Sin coincidencias" : "No hay expedientes en tu alcance"}
              hint={filter ? "Ajusta la búsqueda." : "Crea uno o pide que te asignen a un caso."}
            />
          ) : (
            <ul className="divide-y divide-iusia-line/70">
              {rows.map((m) => (
                <MatterRow key={m.id} matter={m} />
              ))}
            </ul>
          )}
        </Module>

        <div className="flex flex-col gap-4">
          <Module title="Salud de la cartera" eyebrow="Resumen">
            <ul className="flex flex-col gap-3">
              {summary.map((x) => (
                <li key={x.id} className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] text-iusia-carbon">{x.label}</span>
                  <span className="flex items-baseline gap-2">
                    {x.hint ? (
                      <span className="text-[10.5px] uppercase tracking-[0.06em] text-iusia-mist-text">
                        {x.hint}
                      </span>
                    ) : null}
                    <span
                      className={
                        "text-[19px] font-semibold leading-none tnum " +
                        (x.value === "0" ? "text-iusia-mist-text" : x.color)
                      }
                    >
                      {x.value}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Module>

          <Module tone="ice" title="Criticidad" eyebrow="Distribución">
            {all.length === 0 ? (
              <p className="text-[13px] text-iusia-mist-text">Sin expedientes todavía.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {(["HIGH_STAKES", "MATERIAL", "SIMPLE"] as const).map((level) => {
                  const n = all.filter((m) => m.materiality === level).length;
                  const pct = all.length ? Math.round((n / all.length) * 100) : 0;
                  const t = materialityTerm(level);
                  return (
                    <li key={level}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[12.5px] text-iusia-carbon">{t.label}</span>
                        <span className="shrink-0 text-[12px] tnum text-iusia-mist-text">{n}</span>
                      </div>
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-iusia-paper">
                        <span
                          className={
                            "block h-full rounded-full " +
                            (level === "HIGH_STAKES" ? "bg-iusia-gold" : "bg-iusia-navy/45")
                          }
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Module>
        </div>
      </div>

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
 * Un expediente como objeto jurídico, no como fila de hoja de cálculo.
 *
 * Dos niveles tipográficos: arriba lo que identifica el caso ante un cliente
 * —asunto y cliente—, abajo lo que lo sitúa —referencia, área, última actividad—.
 * El estado y la criticidad viven a la derecha porque son lo que se compara entre
 * expedientes al repasar la cartera; la referencia baja a metadato porque nadie
 * busca un caso por su código, pero necesita verlo para citarlo.
 */
function MatterRow({ matter: m }: { matter: MatterSummary }) {
  const status = matterStatusTerm(m.status);
  const materiality = materialityTerm(m.materiality);
  const risk = riskTerm(m.riskLevel);
  const stale = ACTIVE_STATUSES.has(m.status) && daysSince(m.updatedAt) >= INACTIVE_DAYS;
  const showRisk = m.riskLevel !== "UNASSESSED" && !!m.riskRationale;

  return (
    <li>
      <Link
        to={`/casos/${m.id}`}
        className="group flex h-[62px] items-center gap-4 px-5 transition-colors hover:bg-iusia-ice"
      >
        {/* Marca de prioridad: sólo aparece cuando el expediente la merece. */}
        <span
          aria-hidden
          className={
            "h-9 w-[3px] shrink-0 rounded-full " +
            (m.materiality === "HIGH_STAKES"
              ? "bg-iusia-gold"
              : showRisk && (m.riskLevel === "HIGH" || m.riskLevel === "CRITICAL")
                ? "bg-iusia-critical"
                : "bg-transparent")
          }
        />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-medium tracking-[-0.01em] text-iusia-navy group-hover:text-iusia-action">
            {m.title}
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-iusia-mist-text">
            {m.clientName}
            <span aria-hidden className="px-1.5 text-iusia-mist">·</span>
            <span className="tnum">{m.reference}</span>
            {m.practiceAreas[0] ? (
              <>
                <span aria-hidden className="px-1.5 text-iusia-mist">·</span>
                {practiceAreaLabel(m.practiceAreas[0])}
              </>
            ) : null}
          </span>
        </span>

        <span className="hidden shrink-0 items-center gap-2 md:flex">
          <StatusChip label={status.label} tone={status.tone} title={status.hint} />
          <StatusChip label={materiality.label} tone={materiality.tone} title={materiality.hint} />
          {showRisk ? (
            <StatusChip label={risk.label} tone={risk.tone} title={m.riskRationale ?? undefined} dot />
          ) : null}
        </span>

        <span
          className={
            "hidden w-20 shrink-0 text-right text-[12px] tnum sm:block " +
            (stale ? "font-medium text-iusia-warning-text" : "text-iusia-mist-text")
          }
          title={new Date(m.updatedAt).toLocaleString("es-CO")}
        >
          {relativeDays(m.updatedAt)}
        </span>
      </Link>
    </li>
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
