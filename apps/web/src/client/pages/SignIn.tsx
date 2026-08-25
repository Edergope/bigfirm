import { useState, type FormEvent } from "react";
import { Button, Field, Input } from "@iusia/ui";
import { authClient, signIn } from "../auth-client.js";

/**
 * Acceso y registro de firma. Todo el trabajo criptográfico/sesión lo hace Better Auth.
 * Login sobrio y premium: marca clara, acceso directo, sin ilustraciones cliché.
 */
export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await signIn.email({ email, password });
      if (res.error) throw new Error(res.error.message ?? "No fue posible iniciar sesión");
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Recuperación de contraseña (ruta nativa de Better Auth). La respuesta es siempre
   * la misma: nunca revela si un correo existe.
   */
  async function requestPasswordReset() {
    setError(null);
    setNotice(null);
    if (!email) {
      setError("Escribe tu correo para enviarte el enlace de recuperación.");
      return;
    }
    setBusy(true);
    try {
      await authClient.requestPasswordReset({ email, redirectTo: "/entrar" });
    } catch {
      // El resultado no se distingue a propósito.
    } finally {
      setNotice("Si el correo corresponde a una cuenta, recibirás un enlace para restablecer la contraseña.");
      setBusy(false);
    }
  }

  /** OAuth real de Google (Better Auth). Redirige el navegador; el frontend nunca ve tokens. */
  async function continueWithGoogle() {
    setError(null);
    setBusy(true);
    try {
      // callbackURL = destino tras completar el flujo (relativo a APP_URL del entorno).
      await signIn.social({ provider: "google", callbackURL: "/" });
      // signIn.social redirige a Google; no se ejecuta más código en éxito.
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible conectar con Google");
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Panel de marca — autoridad institucional, sin decoración gratuita. */}
      <div className="relative hidden flex-col justify-between bg-iusia-navy px-14 py-12 text-white lg:flex">
        <div>
          <p className="text-[22px] font-bold tracking-[0.2em]">IUSIA</p>
          <p className="mt-1 text-[11px] font-medium tracking-[0.16em] text-white/55">
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
        <div className="flex items-center gap-2 text-[13px] text-white/55">
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
            Acceso a la plataforma
          </h2>
          <p className="mt-1 text-[14px] text-iusia-mist-text">
            Continúa donde lo dejaste.
          </p>

          <form onSubmit={submit} className="mt-7 flex flex-col gap-4">
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
                autoComplete="current-password"
              />
            </Field>

            {error ? (
              <p role="alert" className="text-[13.5px] text-iusia-critical">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p role="status" className="text-[13.5px] text-iusia-mist-text">
                {notice}
              </p>
            ) : null}

            <Button type="submit" disabled={busy} className="mt-1 w-full">
              {busy ? "Procesando…" : "Entrar"}
            </Button>
          </form>

          <div className="mt-5 flex items-center gap-3 text-[12px] text-iusia-mist-text">
            <span className="h-px flex-1 bg-iusia-mist-strong" />o<span className="h-px flex-1 bg-iusia-mist-strong" />
          </div>

          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void continueWithGoogle()}
            className="mt-4 w-full"
          >
            Continuar con Google
          </Button>

          <button
            type="button"
            onClick={() => void requestPasswordReset()}
            disabled={busy}
            className="mt-6 text-[13.5px] text-iusia-action hover:underline disabled:opacity-50"
          >
            Olvidé mi contraseña
          </button>

          <p className="mt-6 text-[12.5px] leading-relaxed text-iusia-mist-text">
            El acceso a IUSIA lo habilita la dirección de tu firma. Si aún no tienes
            cuenta, solicítala a quien administra la plataforma.
          </p>
        </div>
      </div>
    </div>
  );
}
