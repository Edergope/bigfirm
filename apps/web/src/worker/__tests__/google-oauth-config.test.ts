import { describe, expect, it } from "vitest";
import { DRIVE_READONLY_SCOPE, buildGoogleSocialProvider } from "../auth/config.js";
import type { Env } from "../env.js";

/**
 * Sprint 7.8 — identidad y autorización de Drive son flujos SEPARADOS.
 *
 * Iniciar sesión con Google sólo prueba quién eres: no debe pedir acceso a los
 * documentos del usuario ni forzar la pantalla de consentimiento en cada entrada.
 * Drive se autoriza después, de forma incremental, con `linkSocial`.
 */

function env(over: Partial<Env> = {}): Env {
  return {
    GOOGLE_CLIENT_ID: "cid",
    GOOGLE_CLIENT_SECRET: "csecret",
    ...over,
  } as unknown as Env;
}

function google(e: Env = env()) {
  const cfg = buildGoogleSocialProvider(e) as {
    google?: { scope?: string[]; accessType?: string; prompt?: string };
  };
  return cfg.google;
}

describe("buildGoogleSocialProvider — login = sólo identidad", () => {
  it("GOOGLE_LOGIN_DOES_NOT_REQUEST_DRIVE_SCOPE", () => {
    const cfg = google();
    const scopes = cfg?.scope ?? [];
    expect(scopes).not.toContain(DRIVE_READONLY_SCOPE);
    expect(scopes.filter((s) => s.includes("googleapis.com/auth/drive"))).toEqual([]);
  });

  it("GOOGLE_LOGIN_DOES_NOT_FORCE_CONSENT", () => {
    // Sin `prompt: "consent"` Google no vuelve a pedir permisos en cada inicio de sesión.
    expect(google()?.prompt).toBeUndefined();
  });

  it("conserva accessType=offline para que la ingesta en background pueda renovar", () => {
    // No amplía lo que se pide al entrar: gobierna el tipo de token, no el scope.
    expect(google()?.accessType).toBe("offline");
  });

  it("mínimo privilegio: nunca declara scopes de escritura de Drive", () => {
    const scopes = google()?.scope ?? [];
    const writeish = scopes.filter((s) => /drive(\.file|\.appdata)?$|drive\.write/.test(s));
    expect(writeish).toEqual([]);
  });

  it("sin credenciales, no activa el provider", () => {
    expect(buildGoogleSocialProvider(env({ GOOGLE_CLIENT_ID: undefined }))).toEqual({});
    expect(buildGoogleSocialProvider(env({ GOOGLE_CLIENT_SECRET: undefined }))).toEqual({});
  });
});
