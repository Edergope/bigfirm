import { useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Drawer,
  Field,
  Input,
  CountUp,
  Module,
  Rise,
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

/**
 * Ejes de la cartera. Cabecera y filas usan la MISMA rejilla: si cada fila
 * calculara su propio reparto, un asunto largo desplazaría los estados y la
 * columna dejaría de poder compararse de un vistazo.
 */
const ROW_GRID =
  "grid grid-cols-[3px_minmax(0,1fr)_150px] items-center gap-x-5 md:grid-cols-[3px_minmax(0,1fr)_190px_160px_104px]";

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
    <div className="flex h-full flex-col pb-2">
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
        UN solo objeto: salud, búsqueda, ejes y expedientes. El resumen estaba como
        columna lateral y se leía como un panel auxiliar pegado al listado; aquí
        encabeza el mismo workspace, que es lo que hace que la cartera se lea junta.
      */}
      <Module className="flex min-h-0 flex-1 flex-col" padded={false}>
        {all.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-12 gap-y-3 bg-iusia-ice/70 px-5 py-4">
            {summary.map((x, i) => (
              <Rise key={x.id} delay={i * 0.05}>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-iusia-mist-text">
                  {x.label}
                </p>
                <p className="mt-1 flex items-baseline gap-1.5">
                  <span
                    className={
                      "text-[21px] font-semibold leading-none tracking-[-0.02em] tnum " +
                      (x.value === "0" ? "text-iusia-mist-text" : x.color)
                    }
                  >
                    <CountUp value={Number(x.value)} />
                  </span>
                  {x.hint ? (
                    <span className="text-[11px] text-iusia-mist-text">{x.hint}</span>
                  ) : null}
                </p>
              </Rise>
            ))}

          </div>
        ) : null}

        <div className="flex items-center gap-3 px-5 py-3">
          <Input
            placeholder="Buscar por asunto, cliente o referencia…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Buscar expedientes"
            className="h-8 w-full max-w-sm rounded-[10px] text-[13px]"
          />
          <span className="ml-auto shrink-0 text-[12px] tnum text-iusia-mist-text">
            {rows.length === all.length
              ? `${all.length} expediente${all.length === 1 ? "" : "s"}`
              : `${rows.length} de ${all.length}`}
          </span>
        </div>

        {matters.isLoading ? (
          <div className="space-y-2 px-5 pb-5">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : rows.length === 0 ? (
          <StateBlock
            kind="empty"
            title={filter ? "Ningún expediente coincide" : "No hay expedientes en tu alcance"}
            hint={filter ? "Prueba con otro término." : "Crea uno o pide que te asignen a un caso."}
            action={
              filter ? (
                <Button variant="secondary" size="sm" onClick={() => setFilter("")}>
                  Limpiar búsqueda
                </Button>
              ) : (
                <Button size="sm" onClick={() => setOpen(true)}>
                  Nuevo expediente
                </Button>
              )
            }
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* Ejes fijos. Nombrarlos es lo que convierte una lista en una cartera
                legible: el abogado sabe qué compara en cada columna sin leerlas. */}
            <div className={ROW_GRID + " sticky top-0 z-10 bg-iusia-paper px-5 pb-1.5 pt-1"}>
              <span />
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-iusia-mist-text">
                Expediente
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-iusia-mist-text">
                Estado
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-iusia-mist-text">
                Criticidad
              </span>
              <span className="text-right text-[10px] font-semibold uppercase tracking-[0.1em] text-iusia-mist-text">
                Actualizado
              </span>
            </div>
            <ul className="divide-y divide-iusia-line/60">
              {rows.map((m) => (
                <MatterRow key={m.id} matter={m} />
              ))}
            </ul>
          </div>
        )}
      </Module>

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
 * Un expediente como objeto jurídico.
 *
 * Tres niveles tipográficos que funcionan incluso en escala de grises, porque la
 * jerarquía la lleva el tamaño y el peso, no el color:
 *
 *   CASE_TITLE      15px / 600 / navy      — identifica el caso ante un cliente
 *   CASE_CLIENT     13px / 500 / carbon    — de quién es
 *   CASE_AREA       13px / 400 / mist      — de qué trata
 *   CASE_REFERENCE  11px / tnum / mist/75  — cómo se cita
 *
 * La identidad del expediente vive a la izquierda; su estado operativo, en ejes
 * fijos a la derecha. Mezclar ambos en una sola línea era lo que obligaba a leer
 * cada carácter para saber de qué caso se trataba.
 */
function MatterRow({ matter: m }: { matter: MatterSummary }) {
  const status = matterStatusTerm(m.status);
  const materiality = materialityTerm(m.materiality);
  const risk = riskTerm(m.riskLevel);
  const stale = ACTIVE_STATUSES.has(m.status) && daysSince(m.updatedAt) >= INACTIVE_DAYS;
  const showRisk = m.riskLevel !== "UNASSESSED" && !!m.riskRationale;
  const critical = m.riskLevel === "HIGH" || m.riskLevel === "CRITICAL";

  return (
    <li>
      <Link
        to={`/casos/${m.id}`}
        className={
          ROW_GRID +
          " group px-5 py-3 transition-[background-color] duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:bg-iusia-ice/80"
        }
      >
        {/* Señal de exploración. Nunca es el único portador del significado: la
            criticidad y el riesgo van además como texto en sus propios ejes. */}
        {/* La señal se alarga al pasar por encima: informa de que la fila responde
            sin desplazar el texto ni cambiar la altura de la fila. */}
        <span
          aria-hidden
          className={
            "w-[3px] rounded-full transition-[height] duration-[var(--motion-normal)] ease-[var(--ease-standard)] motion-reduce:transition-none " +
            "h-9 group-hover:h-12 " +
            (critical
              ? "bg-iusia-critical"
              : m.materiality === "HIGH_STAKES"
                ? "bg-iusia-gold"
                : "bg-iusia-line group-hover:bg-iusia-action/40")
          }
        />

        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold leading-snug tracking-[-0.012em] text-iusia-navy transition-colors duration-[var(--motion-fast)] group-hover:text-iusia-action">
            {m.title}
          </span>
          <span className="mt-0.5 block truncate text-[13px] leading-snug">
            <span className="font-medium text-iusia-carbon">{m.clientName}</span>
            {m.practiceAreas[0] ? (
              <>
                <span aria-hidden className="px-1.5 text-iusia-mist">·</span>
                <span className="text-iusia-mist-text">
                  {practiceAreaLabel(m.practiceAreas[0])}
                </span>
              </>
            ) : null}
          </span>
          <span
            className="mt-1 block truncate text-[11px] leading-none tracking-[0.03em] tnum text-iusia-mist-text/75"
            title={m.reference}
          >
            {m.reference}
          </span>
        </span>

        <span className="flex flex-col items-start gap-1">
          <StatusChip label={status.label} tone={status.tone} title={status.hint} />
          {/* El riesgo acompaña al estado: es lo que decide si un caso "en curso"
              está tranquilo o no, y no merecía una cuarta columna con dos casos. */}
          {showRisk ? (
            <StatusChip
              label={risk.label}
              tone={risk.tone}
              title={m.riskRationale ?? undefined}
              dot
            />
          ) : null}
        </span>

        <span className="hidden md:block">
          <StatusChip label={materiality.label} tone={materiality.tone} title={materiality.hint} />
        </span>

        <span
          className={
            "hidden text-right text-[12px] tnum md:block " +
            (stale ? "font-medium text-iusia-warning-text" : "text-iusia-mist-text")
          }
          title={`Última actividad: ${new Date(m.updatedAt).toLocaleString("es-CO")}`}
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
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const create = useMutation({
    mutationFn: async () => {
      const res = await api.createMatter({
        title,
        client_name: clientName,
        materiality,
        practice_areas: [area],
        jurisdiction,
        objective: objective || undefined,
      });
      // Los documentos aportados en la creación se suben al expediente recién
      // creado: crea su carpeta en Drive y quedan encolados para ingestión. Un fallo
      // de subida no deshace el expediente —ya existe y es utilizable—; se informa.
      if (files.length > 0) {
        await api.uploadDocuments(res.matter.id, files);
      }
      return res;
    },
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

      {/* Documentos aportados: opcionales al crear. Se suben al expediente y quedan
          disponibles para el análisis. Arrastrar no es la única vía. */}
      <Field label="Documentos del caso (opcional)">
        <div className="rounded-[var(--radius-md)] border border-dashed border-iusia-line-strong bg-iusia-ice/50 px-4 py-3">
          <input
            ref={fileInput}
            type="file"
            multiple
            className="sr-only"
            aria-label="Adjuntar documentos al nuevo expediente"
            onChange={(e) => {
              setFiles((f) => [...f, ...Array.from(e.target.files ?? [])].slice(0, 10));
              e.target.value = "";
            }}
          />
          <Button type="button" variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
            Adjuntar documentos
          </Button>
          {files.length > 0 ? (
            <ul className="mt-2.5 flex flex-col gap-1">
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center justify-between gap-3 rounded-[8px] bg-iusia-paper px-2.5 py-1.5"
                >
                  <span className="min-w-0 truncate text-[12.5px] text-iusia-carbon">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => setFiles((c) => c.filter((_, j) => j !== i))}
                    className="shrink-0 text-[11.5px] font-medium text-iusia-mist-text hover:text-iusia-critical"
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
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
