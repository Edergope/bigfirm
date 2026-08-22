import { useState, type FormEvent } from "react";
import { Button, Field, Input } from "@iusia/ui";
import { authClient, signIn, signUp } from "../auth-client.js";

/**
 * Acceso y registro de firma. Todo el trabajo criptográfico/sesión lo hace Better Auth.
 * Login sobrio y premium: marca clara, acceso directo, sin ilustraciones cliché.
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
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Panel de marca — autoridad institucional, sin decoración gratuita. */}
      <div className="relative hidden flex-col justify-between bg-iusia-navy px-14 py-12 text-white lg:flex">
        <div>
          <p className="text-[22px] font-bold tracking-[0.2em]">IUSIA</p>
          <p className="mt-1 text-[11px] font-medium tracking-[0.16em] text-white/45">
            INTELLIGENCE · LAW · ADVANTAGE
          </p>
        </div>
        <div className="max-w-md">
          <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.01em]">
            El sistema operativo jurídico de tu firma.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-white/65">
            Expedientes, hechos, autoridades y orquestación multiagente en un solo lugar —
            con trazabilidad auditable de cada decisión.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[13px] text-white/40">
          <span className="h-1.5 w-1.5 rounded-full bg-iusia-intel" />
          Go Legaltech · Confidencial
        </div>
      </div>

      {/* Panel de acceso */}
      <div className="flex items-center justify-center bg-iusia-surface px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <p className="text-[20px] font-bold tracking-[0.18em] text-iusia-navy">IUSIA</p>
          </div>
          <h2 className="text-[22px] font-semibold text-iusia-navy">
            {mode === "in" ? "Acceso a la plataforma" : "Registrar firma"}
          </h2>
          <p className="mt-1 text-[14px] text-iusia-mist">
            {mode === "in"
              ? "Continúa donde lo dejaste."
              : "Crea tu firma y su primer usuario de dirección."}
          </p>

          <form onSubmit={submit} className="mt-7 flex flex-col gap-4">
            {mode === "up" ? (
              <>
                <Field label="Nombre">
                  <Input value={name} onChange={(e) => setName(e.target.value)} required />
                </Field>
                <Field label="Nombre de la firma">
                  <Input value={firmName} onChange={(e) => setFirmName(e.target.value)} required />
                </Field>
              </>
            ) : null}
            <Field label="Correo">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </Field>
            <Field label="Contraseña">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === "in" ? "current-password" : "new-password"}
              />
            </Field>

            {error ? (
              <p role="alert" className="text-[13.5px] text-iusia-critical">
                {error}
              </p>
            ) : null}

            <Button type="submit" disabled={busy} className="mt-1 w-full">
              {busy ? "Procesando…" : mode === "in" ? "Entrar" : "Crear firma"}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => {
              setMode(mode === "in" ? "up" : "in");
              setError(null);
            }}
            className="mt-6 text-[13.5px] text-iusia-action hover:underline"
          >
            {mode === "in" ? "Registrar una firma nueva" : "Ya tengo una cuenta"}
          </button>
        </div>
      </div>
    </div>
  );
}
