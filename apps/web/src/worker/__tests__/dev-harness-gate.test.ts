import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { isIusiaError } from "@iusia/domain";
import { devRoutes, isDevelopmentEnv } from "../routes/dev.js";
import type { AppBindings } from "../context.js";

/**
 * SECURITY — el harness dev (/api/dev/*) debe FALLAR CERRADO fuera de development.
 * Sólo IUSIA_ENV === "development" lo habilita; cualquier otro estado responde 404
 * ANTES de tocar D1/créditos/Drive (el gate es el primer middleware).
 */

// App de prueba: monta devRoutes con el MISMO mapeo de error que producción
// (IusiaError -> su status), para observar el 404 real del gate.
function testApp() {
  const app = new Hono<AppBindings>();
  app.onError((error, c) => {
    if (isIusiaError(error)) return c.json(error.toJSON(), error.status as 404);
    return c.json({ error: "unhandled" }, 500);
  });
  app.route("/api/dev", devRoutes);
  return app;
}

// Env que, si el gate dejara pasar, permitiría detectar un side-effect: un DB espía.
// En producción NO debe construirse ni consultarse.
function spyEnv(iusiaEnv: string | undefined) {
  const dbTouched = { value: false };
  const env = {
    IUSIA_ENV: iusiaEnv,
    // Cualquier acceso a DB marcaría un side-effect. El gate debe cortar antes.
    get DB() {
      dbTouched.value = true;
      return {} as unknown;
    },
  } as unknown as AppBindings["Bindings"];
  return { env, dbTouched };
}

const DEV_ENDPOINTS: Array<[string, string]> = [
  ["/api/dev/bootstrap", "POST"],
  ["/api/dev/e2e/add-org-member", "POST"],
  ["/api/dev/e2e/drive-read", "POST"],
];

const BLOCKED_ENVS: Array<[string, string | undefined]> = [
  ["production", "production"],
  ["staging", "staging"],
  ["test", "test"],
  ["undefined", undefined],
  ["empty string", ""],
  ["valor arbitrario", "dev"], // ni siquiera "dev" cuenta: sólo "development"
];

describe("isDevelopmentEnv (fail-closed, igualdad estricta)", () => {
  it("sólo 'development' es verdadero", () => {
    expect(isDevelopmentEnv("development")).toBe(true);
  });
  it.each([["production"], ["staging"], ["test"], [""], ["dev"], ["Development"], ["DEVELOPMENT"]])(
    "'%s' es falso",
    (v) => expect(isDevelopmentEnv(v)).toBe(false),
  );
  it("undefined y null son falsos", () => {
    expect(isDevelopmentEnv(undefined)).toBe(false);
    expect(isDevelopmentEnv(null)).toBe(false);
  });
});

describe("gate del harness dev — bloqueo fuera de development", () => {
  const app = testApp();

  for (const [route, method] of DEV_ENDPOINTS) {
    for (const [label, value] of BLOCKED_ENVS) {
      it(`${method} ${route} con IUSIA_ENV=${label} -> 404 sin side-effect`, async () => {
        const { env, dbTouched } = spyEnv(value);
        const res = await app.request(route, { method }, env);
        expect(res.status).toBe(404);
        // Fail-closed: el gate corta antes de construir contexto/DB (sin grants, addMember, Drive).
        expect(dbTouched.value).toBe(false);
      });
    }
  }
});

describe("gate del harness dev — permisivo SÓLO en development", () => {
  const app = testApp();

  for (const [route, method] of DEV_ENDPOINTS) {
    it(`${method} ${route} con IUSIA_ENV=development NO devuelve 404 del gate (pasa el gate)`, async () => {
      // En development el gate deja pasar; el handler falla luego por falta de DB/sesión
      // real (no es 404 del gate). Basta con demostrar que el gate no lo bloqueó.
      const env = { IUSIA_ENV: "development" } as unknown as AppBindings["Bindings"];
      const res = await app.request(route, { method, headers: { "content-type": "application/json" }, body: "{}" }, env);
      expect(res.status).not.toBe(404);
    });
  }
});
