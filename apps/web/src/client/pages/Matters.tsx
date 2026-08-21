import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardHeader, EmptyState, MatterStatusChip, StatusChip } from "@iusia/ui";
import { api, ApiError } from "../api.js";

const PRACTICE_AREAS = [
  "CIVIL",
  "COMERCIAL_CONTRACTUAL",
  "SOCIETARIO_MA",
  "LABORAL",
  "TRIBUTARIO",
  "PENAL_ECONOMICO",
  "ADMINISTRATIVO",
  "CONSTITUCIONAL",
  "FAMILIA",
  "INMOBILIARIO",
  "PROPIEDAD_INTELECTUAL",
  "INSOLVENCIA",
  "MIGRATORIO",
  "FINANCIERO",
  "COMPLIANCE",
  "OTRO",
];

const MATERIALITY_HELP: Record<string, string> = {
  SIMPLE: "Ruta corta: menos nodos del DAG, sin gates de aprobación humana.",
  MATERIAL: "Ruta estándar con especialistas y auditoría de citas.",
  HIGH_STAKES: "Exige aprobación humana en los gates de estrategia e integridad.",
};

export function Matters() {
  const queryClient = useQueryClient();
  const matters = useQuery({ queryKey: ["matters"], queryFn: api.listMatters });
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold text-iusia-navy">Casos</h1>
          <p className="mt-1 text-[14px] text-iusia-mist">
            {matters.data?.scope === "FIRM"
              ? "Cartera completa de la firma (acceso de dirección, auditado)."
              : "Expedientes asignados a ti."}
          </p>
        </div>
        <Button onClick={() => setOpen((v) => !v)}>
          {open ? "Cancelar" : "Nuevo expediente"}
        </Button>
      </div>

      {open ? (
        <NewMatterForm
          onCreated={() => {
            setOpen(false);
            void queryClient.invalidateQueries({ queryKey: ["matters"] });
          }}
        />
      ) : null}

      <Card>
        <CardHeader title={`${matters.data?.matters.length ?? 0} expedientes`} />
        {matters.isLoading ? (
          <EmptyState title="Cargando expedientes…" />
        ) : (matters.data?.matters.length ?? 0) === 0 ? (
          <EmptyState
            title="No hay expedientes en tu alcance"
            hint="Crea uno nuevo o pide a un socio que te asigne a un caso existente."
          />
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-iusia-mist/30 text-[13px] text-iusia-mist">
                <th className="px-6 py-3 font-medium">Referencia</th>
                <th className="px-6 py-3 font-medium">Asunto</th>
                <th className="px-6 py-3 font-medium">Cliente</th>
                <th className="px-6 py-3 font-medium">Materialidad</th>
                <th className="px-6 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-iusia-mist/20">
              {matters.data?.matters.map((m) => (
                <tr key={m.id} className="h-[48px] hover:bg-iusia-surface">
                  <td className="px-6 text-[14px] tabular-nums text-iusia-mist">
                    {m.reference}
                  </td>
                  <td className="px-6">
                    <Link
                      to={`/casos/${m.id}`}
                      className="text-[15px] font-medium text-iusia-action hover:underline"
                    >
                      {m.title}
                    </Link>
                  </td>
                  <td className="px-6 text-[14px]">{m.clientName}</td>
                  <td className="px-6">
                    <StatusChip
                      label={m.materiality}
                      tone={m.materiality === "HIGH_STAKES" ? "warning" : "neutral"}
                    />
                  </td>
                  <td className="px-6">
                    <MatterStatusChip status={m.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
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
    <Card>
      <CardHeader title="Nuevo expediente" />
      <form onSubmit={submit} className="grid grid-cols-2 gap-4 px-6 py-5">
        <Field label="Asunto" value={title} onChange={setTitle} required />
        <Field label="Cliente" value={clientName} onChange={setClientName} required />
        <Field label="Jurisdicción" value={jurisdiction} onChange={setJurisdiction} required />

        <label className="flex flex-col gap-1">
          <span className="text-[14px]">Área de práctica</span>
          <select
            value={area}
            onChange={(e) => setArea(e.target.value)}
            className="h-10 rounded-lg border border-iusia-mist/60 px-3 text-[15px]"
          >
            {PRACTICE_AREAS.map((a) => (
              <option key={a} value={a}>
                {a.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[14px]">Materialidad</span>
          <select
            value={materiality}
            onChange={(e) => setMateriality(e.target.value)}
            className="h-10 rounded-lg border border-iusia-mist/60 px-3 text-[15px]"
          >
            {Object.keys(MATERIALITY_HELP).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <span className="text-[13px] text-iusia-mist">{MATERIALITY_HELP[materiality]}</span>
        </label>

        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-[14px]">Objetivo del cliente (opcional)</span>
          <textarea
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            rows={3}
            className="rounded-lg border border-iusia-mist/60 px-3 py-2 text-[15px]"
          />
        </label>

        {create.error ? (
          <p role="alert" className="col-span-2 text-[14px] text-iusia-critical">
            {create.error instanceof ApiError ? create.error.message : "Error al crear"}
          </p>
        ) : null}

        <div className="col-span-2">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Creando…" : "Crear expediente"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[14px]">{label}</span>
      <input
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-lg border border-iusia-mist/60 px-3 text-[15px] outline-none focus:border-iusia-action"
      />
    </label>
  );
}
