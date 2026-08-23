import { describe, expect, it } from "vitest";
import { DRIVE_READONLY_SCOPE, buildGoogleSocialProvider } from "../auth/config.js";
import type { Env } from "../env.js";

/**
 * G1 — el social provider de Google solicita efectivamente el scope de sólo lectura
 * de Drive con acceso offline y consentimiento (para obtener refresh_token), con
 * mínimo privilegio (sin scopes de escritura) y sin activarse sin credenciales.
 */

function env(over: Partial<Env> = {}): Env {
  return {
    GOOGLE_CLIENT_ID: "cid",
    GOOGLE_CLIENT_SECRET: "csecret",
    ...over,
  } as unknown as Env;
}

describe("buildGoogleSocialProvider (G1)", () => {
  it("solicita drive.readonly, offline y prompt=consent", () => {
    const cfg = buildGoogleSocialProvider(env()) as {
      google: { scope: string[]; accessType: string; prompt: string };
    };
    expect(cfg.google.scope).toContain(DRIVE_READONLY_SCOPE);
    expect(cfg.google.accessType).toBe("offline");
    expect(cfg.google.prompt).toBe("consent");
  });

  it("mínimo privilegio: no incluye ningún scope de escritura de Drive", () => {
    const cfg = buildGoogleSocialProvider(env()) as { google: { scope: string[] } };
    const writeish = cfg.google.scope.filter(
      (s) => /\/auth\/drive$/.test(s) || s.includes("drive.file") || s.includes("drive.appdata"),
    );
    expect(writeish).toEqual([]);
    // El único scope de Drive es el de sólo lectura.
    const driveScopes = cfg.google.scope.filter((s) => s.includes("/auth/drive"));
    expect(driveScopes).toEqual([DRIVE_READONLY_SCOPE]);
  });

  it("sin credenciales, no activa el provider", () => {
    expect(buildGoogleSocialProvider(env({ GOOGLE_CLIENT_ID: undefined }))).toEqual({});
    expect(buildGoogleSocialProvider(env({ GOOGLE_CLIENT_SECRET: undefined }))).toEqual({});
  });
});
