import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * MVP Bloque 5 — guards del trigger de Google OAuth en el frontend y del endpoint de
 * estado de Drive. No hay infra de tests de React (vitest node env); estas comprobaciones
 * fijan el contrato mínimo a nivel de fuente: el botón inicia el flujo REAL de Better Auth
 * y ni el botón ni el endpoint exponen tokens al cliente.
 */

const ROOT = process.cwd();
const SIGNIN = readFileSync(join(ROOT, "apps/web/src/client/pages/SignIn.tsx"), "utf8");
const DOCS_ROUTE = readFileSync(join(ROOT, "apps/web/src/worker/routes/documents.ts"), "utf8");

describe("botón Continuar con Google (SignIn)", () => {
  it("inicia el flujo social real de Better Auth con provider google", () => {
    expect(SIGNIN).toMatch(/signIn\.social\(\s*\{\s*provider:\s*["']google["']/);
  });

  it("pasa un callbackURL (destino tras el flujo)", () => {
    expect(SIGNIN).toMatch(/callbackURL:/);
  });

  it("EMAIL_PASSWORD_AUTH_STILL_WORKS: conserva el inicio de sesión con contraseña", () => {
    expect(SIGNIN).toMatch(/signIn\.email\(/);
  });

  it("PUBLIC_ORGANIZATION_CREATION_BLOCKED: la pantalla no registra firmas ni cuentas", () => {
    // Sprint 7.8: IUSIA no es un SaaS de alta self-service. El acceso lo habilita
    // la dirección de la firma; el frontend no ofrece crear tenant ni usuario.
    expect(SIGNIN).not.toMatch(/signUp\.email\(/);
    expect(SIGNIN).not.toMatch(/organization\.create\(/);
    expect(SIGNIN).not.toMatch(/Registrar una firma/);
  });

  it("ofrece recuperación de contraseña por la ruta nativa de Better Auth", () => {
    expect(SIGNIN).toMatch(/requestPasswordReset\(/);
  });

  it("el frontend no maneja tokens de Google (sólo redirige)", () => {
    expect(SIGNIN).not.toMatch(/access_token|refresh_token|client_secret/i);
  });
});

describe("endpoint GET /integrations/drive/status", () => {
  it("resuelve credenciales server-side (DriveCredentialResolver)", () => {
    expect(DOCS_ROUTE).toMatch(/DriveCredentialResolver\.forEnv/);
    expect(DOCS_ROUTE).toMatch(/resolveAdapter\(userId\)/);
  });

  it("nunca devuelve tokens: sólo connected/reason/self_test", () => {
    // El bloque del handler no referencia campos de token en la respuesta.
    const handler = DOCS_ROUTE.slice(DOCS_ROUTE.indexOf('"/integrations/drive/status"'));
    expect(handler).not.toMatch(/access_token|refresh_token|id_token|accessToken|refreshToken/);
  });
});
