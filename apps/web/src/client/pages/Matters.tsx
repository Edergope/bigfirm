import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  Drawer,
  Field,
  Input,
  MatterStatusChip,
  PageHeader,
  Select,
  Skeleton,
  StateBlock,
  StatusChip,
  Textarea,
} from "@iusia/ui";
import { api, ApiError } from "../api.js";

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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Casos"
        description={
          matters.data?.scope === "FIRM"
            ? "Cartera completa de la firma (acceso de dirección, auditado)."
            : "Expedientes asignados a ti."
        }
        actions={<Button onClick={() => setOpen(true)}>Nuevo expediente</Button>}
      />

      <Card>
        <div className="flex items-center gap-3 border-b border-iusia-mist/25 px-5 py-3">
          <Input
            placeholder="Filtrar por asunto, cliente o referencia…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-9 max-w-sm"
          />
          <span className="ml-auto text-[13px] text-iusia-mist tnum">
            {rows.length} expediente{rows.length === 1 ? "" : "s"}
          </span>
        </div>

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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-iusia-mist/25 text-[12.5px] font-medium text-iusia-mist">
                  <th className="px-5 py-2.5">Referencia</th>
                  <th className="px-5 py-2.5">Asunto</th>
                  <th className="px-5 py-2.5">Cliente</th>
                  <th className="px-5 py-2.5">Materialidad</th>
                  <th className="px-5 py-2.5">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-iusia-mist/15">
                {rows.map((m) => (
                  <tr key={m.id} className="group transition-colors hover:bg-iusia-surface">
                    <td className="px-5 py-3 text-[13px] tabular-nums text-iusia-mist">{m.reference}</td>
                    <td className="px-5 py-3">
                      <Link
                        to={`/casos/${m.id}`}
                        className="text-[14.5px] font-medium text-iusia-carbon group-hover:text-iusia-action"
                      >
                        {m.title}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-[14px] text-iusia-carbon/85">{m.clientName}</td>
                    <td className="px-5 py-3">
                      <StatusChip
                        label={m.materiality}
                        tone={m.materiality === "HIGH_STAKES" ? "warning" : "neutral"}
                      />
                    </td>
                    <td className="px-5 py-3">
                      <MatterStatusChip status={m.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

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
                {a.replaceAll("_", " ")}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Materialidad" hint={MATERIALITY_HELP[materiality]}>
        <Select value={materiality} onChange={(e) => setMateriality(e.target.value)}>
          {Object.keys(MATERIALITY_HELP).map((m) => (
            <option key={m} value={m}>
              {m}
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
