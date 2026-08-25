import { useState, type FormEvent } from "react";
import { Button, Card, CardHeader, Field, Input, StateBlock } from "@iusia/ui";
import { authClient, signIn, signUp } from "../auth-client.js";

/** Cabecera con la que el enlace acredita su posesión ante el servidor. */
const INVITATION_HEADER = "x-iusia-invitation";

/**
 * Aceptación de una invitación a la firma.
 *
 * IUSIA no admite registro público: esta pantalla sólo funciona con un enlace de
 * invitación válido. El correo, el rol y la organización los fija el servidor desde
 * la invitación; nada de eso se toma de este formulario.
 */
export function AcceptInvitation() {
  const invitationId = new URLSearchParams(window.location.search).get("invitationId") ?? "";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!invitationId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-iusia-surface px-6">
        <Card className="w-full max-w-md">
          <StateBlock
            kind="error"
            title="Enlace de invitación no válido"
            hint="Abre el enlace que recibiste por correo. El acceso a IUSIA es sólo por invitación."
          />
        </Card>
      </div>
    );
  }

  /** Acepta la invitación con la sesión ya establecida (usuario nuevo o existente). */
  async function accept() {
    const res = await authClient.organization.acceptInvitation({ invitationId });
    if (res.error) throw new Error(res.error.message ?? "No fue posible aceptar la invitación");
    window.location.assign("/");
  }

  async function createAccountAndAccept(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // El id de la invitación viaja como cabecera: es la prueba de que quien crea
      // la identidad recibió el correo. El servidor rechaza el alta sin ella.
      const res = await signUp.email(
        { email, password, name },
        { headers: { [INVITATION_HEADER]: invitationId } },
      );
      if (res.error) throw new Error(res.error.message ?? "No fue posible crear tu acceso");
      await accept();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
      setBusy(false);
    }
  }

  async function continueWithGoogle() {
    setBusy(true);
    setError(null);
    try {
      // Google asevera el correo: si coincide con el invitado, acredita el control.
      await signIn.social({
        provider: "google",
        callbackURL: `/invitacion?invitationId=${encodeURIComponent(invitationId)}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible conectar con Google");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-iusia-surface px-6 py-12">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-[20px] font-bold tracking-[0.18em] text-iusia-navy">IUSIA</p>
        <Card>
          <CardHeader
            title="Te invitaron a una firma"
            subtitle="Crea tu acceso o entra con la cuenta del correo invitado."
          />
          <form onSubmit={createAccountAndAccept} className="flex flex-col gap-4 px-6 py-5">
            <Field label="Nombre">
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Correo invitado">
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
                autoComplete="new-password"
              />
            </Field>
            {error ? (
              <p role="alert" className="text-[13.5px] text-iusia-critical">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Procesando…" : "Crear acceso y aceptar"}
            </Button>
          </form>

          <div className="px-6 pb-6">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void continueWithGoogle()}
              className="w-full"
            >
              Continuar con Google
            </Button>
            <button
              type="button"
              onClick={() => void accept().catch((e: unknown) => setError(e instanceof Error ? e.message : "Error"))}
              className="mt-4 w-full text-[13.5px] text-iusia-action hover:underline"
            >
              Ya tengo cuenta en IUSIA — aceptar invitación
            </button>
            <p className="mt-4 text-[12.5px] leading-relaxed text-iusia-mist-text">
              El correo y el rol los define la invitación; no pueden cambiarse desde aquí.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
