import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SECURITY / anti-regresión — la configuración base deployable (wrangler.jsonc) NUNCA
 * debe declarar IUSIA_ENV (y menos "development") ni acoplar APP_URL a localhost. Si
 * alguien lo re-introduce, un `wrangler deploy` volvería a exponer el harness dev.
 */

// cwd de vitest = raíz del repo.
const WRANGLER = join(process.cwd(), "apps/web/wrangler.jsonc");
const VITE_CONFIG = join(process.cwd(), "apps/web/vite.config.ts");

interface R2Binding {
  binding: string;
  remote?: boolean;
}

/** Quita comentarios JSONC (bloque y línea) para poder parsear el objeto real. */
function parseJsonc(text: string): { vars?: Record<string, unknown>; r2_buckets?: R2Binding[] } {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const noLine = noBlock.replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(noLine) as { vars?: Record<string, unknown>; r2_buckets?: R2Binding[] };
}

describe("deployment safety: wrangler.jsonc base config (fail-closed)", () => {
  const config = parseJsonc(readFileSync(WRANGLER, "utf8"));
  const vars = config.vars ?? {};

  it("la config base NO declara IUSIA_ENV en vars", () => {
    expect("IUSIA_ENV" in vars).toBe(false);
  });

  it("en particular NO fija IUSIA_ENV=development (fail-open)", () => {
    expect(vars.IUSIA_ENV).not.toBe("development");
  });

  it("la config base NO acopla APP_URL a localhost", () => {
    const appUrl = vars.APP_URL;
    if (appUrl !== undefined) {
      expect(String(appUrl)).not.toMatch(/localhost/i);
    } else {
      expect(appUrl).toBeUndefined(); // preferido: APP_URL se suministra por entorno
    }
  });

  it("el binding ARTIFACTS base NO es remoto (dev normal usa R2 local)", () => {
    const artifacts = (config.r2_buckets ?? []).find((b) => b.binding === "ARTIFACTS");
    expect(artifacts, "ARTIFACTS debe existir en r2_buckets base").toBeDefined();
    expect(artifacts?.remote).not.toBe(true);
  });
});

describe("aislamiento local/remote R2 (vite.config.ts)", () => {
  const viteSrc = readFileSync(VITE_CONFIG, "utf8");

  it("el modo remoto está gateado por IUSIA_RAG_E2E (no se activa en dev normal)", () => {
    expect(viteSrc).toMatch(/IUSIA_RAG_E2E/);
    // remoteBindings sólo cuando el flag está activo.
    expect(viteSrc).toMatch(/remoteBindings:\s*ragE2E/);
  });

  it("sólo ARTIFACTS se marca remote y sólo en modo E2E", () => {
    expect(viteSrc).toMatch(/b\.binding === "ARTIFACTS"/);
    // No hay un `remote:true` incondicional sobre otros bindings en la config base.
    expect(viteSrc).not.toMatch(/PROMPTS[\s\S]{0,40}remote\s*=\s*true/);
  });

  it("IUSIA_ENV=staging en E2E, development en dev normal (nunca development en E2E)", () => {
    expect(viteSrc).toMatch(/ragE2E\s*\?\s*"staging"\s*:\s*"development"/);
  });
});
