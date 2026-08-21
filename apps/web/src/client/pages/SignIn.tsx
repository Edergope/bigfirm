import { useState, type FormEvent } from "react";
import { Button, Card } from "@iusia/ui";
import { authClient, signIn, signUp } from "../auth-client.js";

/**
 * Autenticación y creación de firma.
 *
 * Todo el trabajo criptográfico y de sesión lo hace Better Auth. Esta vista sólo
 * recoge datos y crea la organización (= firma), que es el tenant raíz.
 */
export function SignIn() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [firmName, setFirmName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "in") {
        const res = await signIn.email({ email, password });
        if (res.error) throw new Error(res.error.message ?? "No fue posible iniciar sesión");
      } else {
        const res = await signUp.email({ email, password, name });
        if (res.error) throw new Error(res.error.message ?? "No fue posible crear la cuenta");

        // La firma es la entidad superior del multitenancy: sin ella no hay contexto.
        const org = await authClient.organization.create({
          name: firmName,
          slug: firmName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40),
        });
        if (org.error) throw new Error(org.error.message ?? "No fue posible crear la firma");
        await authClient.organization.setActive({ organizationId: org.data.id });
      }
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-iusia-navy px-4">
      <Card className="w-full max-w-md px-8 py-8">
        <p className="text-lg font-bold tracking-[0.14em] text-iusia-navy">IUSIA</p>
        <p className="mt-0.5 text-[13px] text-iusia-mist">
          {mode === "in" ? "Acceso a la plataforma" : "Registro de firma"}
        </p>

        <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
          {mode === "up" ? (
            <>
              <Field label="Nombre" value={name} onChange={setName} required />
              <Field label="Nombre de la firma" value={firmName} onChange={setFirmName} required />
            </>
          ) : null}
          <Field label="Correo" type="email" value={email} onChange={setEmail} required />
          <Field
            label="Contraseña"
            type="password"
            value={password}
            onChange={setPassword}
            required
          />

          {error ? (
            <p role="alert" className="text-[14px] text-iusia-critical">
              {error}
            </p>
          ) : null}

          <div className="mt-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Procesando…" : mode === "in" ? "Entrar" : "Crear firma"}
            </Button>
          </div>
        </form>

        <button
          type="button"
          onClick={() => setMode(mode === "in" ? "up" : "in")}
          className="mt-5 text-[13px] text-iusia-action hover:underline"
        >
          {mode === "in" ? "Registrar una firma nueva" : "Ya tengo cuenta"}
        </button>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[14px] text-iusia-carbon">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-lg border border-iusia-mist/60 px-3 text-[15px] outline-none focus:border-iusia-action"
      />
    </label>
  );
}
