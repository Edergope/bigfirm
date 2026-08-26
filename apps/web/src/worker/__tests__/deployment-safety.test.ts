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

interface WranglerConfig {
  ai?: { binding?: string };
  vars?: Record<string, unknown>;
  r2_buckets?: R2Binding[];
  env?: {
    staging?: {
      ai?: { binding?: string };
      vars?: Record<string, unknown>;
      d1_databases?: Array<{ binding: string; database_id?: string }>;
      ai_search?: Array<{ binding: string; instance_name?: string }>;
    };
  };
}

/** Quita comentarios JSONC (bloque y línea) para poder parsear el objeto real. */
function parseJsonc(text: string): WranglerConfig {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const noLine = noBlock.replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(noLine) as WranglerConfig;
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

  it("la conversión documental usa el binding nativo Workers AI", () => {
    expect(config.ai?.binding).toBe("AI");
  });
});

describe("environment staging (recursos remotos)", () => {
  const config = parseJsonc(readFileSync(WRANGLER, "utf8"));
  const staging = config.env?.staging;

  it("existe env.staging", () => {
    expect(staging).toBeDefined();
  });

  it("staging fija IUSIA_ENV=staging (nunca development → harness dev cerrado)", () => {
    expect(staging?.vars?.IUSIA_ENV).toBe("staging");
  });

  it("staging usa un database_id real (no el placeholder)", () => {
    const db = (staging?.d1_databases ?? []).find((d) => d.binding === "DB");
    expect(db?.database_id).toBeDefined();
    expect(db?.database_id).not.toMatch(/REPLACE_WITH/i);
  });

  it("staging APP_URL no es localhost", () => {
    expect(String(staging?.vars?.APP_URL ?? "")).not.toMatch(/localhost/i);
  });

  it("staging incluye el binding AI_SEARCH (instancia iusia-rag-e2e)", () => {
    const ai = (staging?.ai_search ?? []).find((a) => a.binding === "AI_SEARCH");
    expect(ai?.instance_name).toBe("iusia-rag-e2e");
  });

  it("staging redeclara Workers AI para toMarkdown", () => {
    expect(staging?.ai?.binding).toBe("AI");
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
