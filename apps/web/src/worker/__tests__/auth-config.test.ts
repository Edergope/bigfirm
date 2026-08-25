import { describe, expect, it } from "vitest";
import { createAuth } from "../auth/config.js";
import type { Env } from "../env.js";

/**
 * Sprint 7.8 — invariantes de configuración de Better Auth.
 *
 * IUSIA no implementa identidad propia: configura la de Better Auth. Estos tests
 * fijan las decisiones de seguridad de esa configuración, que es donde viven.
 */

function auth() {
  // drizzleAdapter no consulta la base al construirse: basta un binding inerte.
  return createAuth({
    DB: {} as never,
    APP_URL: "https://iusia.test",
    BETTER_AUTH_SECRET: "test-secret",
    GOOGLE_CLIENT_ID: "cid",
    GOOGLE_CLIENT_SECRET: "csecret",
  } as unknown as Env);
}

describe("configuración de Better Auth", () => {
  it("PUBLIC_ORGANIZATION_CREATION_BLOCKED: ningún usuario crea firmas por su cuenta", () => {
    const opts = auth().options as {
      plugins?: Array<{ id?: string; options?: { allowUserToCreateOrganization?: boolean } }>;
    };
    const org = opts.plugins?.find((p) => p.id === "organization");
    expect(org, "el plugin organization debe estar activo").toBeTruthy();
    expect(org?.options?.allowUserToCreateOrganization).toBe(false);
  });

  it("SYSTEM_SUPERADMIN_SERVER_SIDE_ONLY: systemRole no es asignable por el cliente", () => {
    const opts = auth().options as {
      user?: { additionalFields?: Record<string, { input?: boolean; returned?: boolean }> };
    };
    const field = opts.user?.additionalFields?.systemRole;
    expect(field, "systemRole debe declararse como additionalField").toBeTruthy();
    // `input: false` hace que Better Auth rechace el campo si llega del cliente
    // y lo ignore del perfil de OAuth. Es la garantía de no autoasignación.
    expect(field?.input).toBe(false);
    expect(field?.returned).toBe(false);
  });

  it("EMAIL_PASSWORD_AUTH_STILL_WORKS y la recuperación queda conectada", () => {
    const opts = auth().options as {
      emailAndPassword?: { enabled?: boolean; sendResetPassword?: unknown };
    };
    expect(opts.emailAndPassword?.enabled).toBe(true);
    expect(typeof opts.emailAndPassword?.sendResetPassword).toBe("function");
  });

  it("NO_PLAINTEXT_PASSWORD: IUSIA no implementa hashing ni almacenamiento propio", () => {
    const opts = auth().options as { emailAndPassword?: { password?: unknown } };
    // Sin `password.hash`/`verify` custom: la criptografía es de Better Auth.
    expect(opts.emailAndPassword?.password).toBeUndefined();
  });

  it("los roles de firma configurados son exactamente los del dominio", () => {
    const opts = auth().options as {
      plugins?: Array<{ id?: string; options?: { roles?: Record<string, unknown> } }>;
    };
    const org = opts.plugins?.find((p) => p.id === "organization");
    const roles = Object.keys(org?.options?.roles ?? {}).sort();
    expect(roles).toEqual(
      ["ASSISTANT", "EXTERNAL_LAWYER", "FIRM_DIRECTOR", "LAWYER", "PARALEGAL", "PARTNER", "READ_ONLY"],
    );
    expect(roles).not.toContain("SYSTEM_SUPERADMIN");
  });
});
