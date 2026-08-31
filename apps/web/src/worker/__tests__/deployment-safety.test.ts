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
  queues?: {
    consumers?: Array<{
      queue?: string;
      max_batch_size?: number;
      max_retries?: number;
      dead_letter_queue?: string;
    }>;
  };
  env?: {
    staging?: WranglerEnv;
    production?: WranglerEnv;
  };
}

interface WranglerEnv {
  ai?: { binding?: string };
  vars?: Record<string, unknown>;
  d1_databases?: Array<{ binding: string; database_id?: string }>;
  r2_buckets?: R2Binding[];
  ai_search?: Array<{ binding: string; instance_name?: string }>;
  workflows?: Array<{ binding?: string }>;
  durable_objects?: { bindings?: Array<{ name?: string }> };
  queues?: WranglerConfig["queues"];
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

  it("consumer documental base usa batch seguro con DLQ", () => {
    const consumer = (config.queues?.consumers ?? []).find(
      (c) => c.queue === "iusia-document-ingestion",
    );
    expect(consumer?.max_batch_size).toBe(4);
    expect(consumer?.max_retries).toBe(3);
    expect(consumer?.dead_letter_queue).toBe("iusia-document-ingestion-dlq");
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

  it("staging mantiene batch documental seguro con DLQ", () => {
    const consumer = (staging?.queues?.consumers ?? []).find(
      (c) => c.queue === "iusia-document-ingestion",
    );
    expect(consumer?.max_batch_size).toBe(4);
    expect(consumer?.max_retries).toBe(3);
    expect(consumer?.dead_letter_queue).toBe("iusia-document-ingestion-dlq");
  });
});

/**
 * Producción existía sólo como hueco: la única configuración desplegable era la base,
 * sin AI_SEARCH, sin ORCHESTRATION_MODE y con un database_id de marcador. Nada de lo
 * validado en staging describía un deploy real de producción. Estos tests fijan que
 * el entorno esté DECLARADO y que sus decisiones sean explícitas, no heredadas.
 */
describe("environment production (declarado y fail-closed)", () => {
  const config = parseJsonc(readFileSync(WRANGLER, "utf8"));
  const production = config.env?.production;

  it("existe env.production", () => {
    expect(production).toBeDefined();
  });

  it("production fija IUSIA_ENV=production (harness dev cerrado)", () => {
    expect(production?.vars?.IUSIA_ENV).toBe("production");
    expect(production?.vars?.IUSIA_ENV).not.toBe("development");
  });

  it("production declara ORCHESTRATION_MODE de forma explícita, no por herencia", () => {
    // La decisión de correr el planner dinámico en producción debe ser consciente.
    expect(["pilot", "dynamic"]).toContain(String(production?.vars?.ORCHESTRATION_MODE));
  });

  it("production declara los mismos bindings que staging (los env no heredan)", () => {
    expect((production?.d1_databases ?? []).map((d) => d.binding)).toContain("DB");
    expect((production?.r2_buckets ?? []).map((b) => b.binding)).toEqual(
      expect.arrayContaining(["PROMPTS", "ARTIFACTS"]),
    );
    expect((production?.ai_search ?? []).map((a) => a.binding)).toContain("AI_SEARCH");
    expect((production?.workflows ?? []).map((w) => w.binding)).toContain("MATTER_ORCHESTRATION");
    expect((production?.durable_objects?.bindings ?? []).map((b) => b.name)).toContain(
      "LegalWorker",
    );
    expect(production?.ai?.binding).toBe("AI");
  });

  it("production mantiene batch documental seguro con DLQ", () => {
    const consumer = (production?.queues?.consumers ?? [])[0];
    expect(consumer?.max_batch_size).toBe(4);
    expect(consumer?.max_retries).toBe(3);
    expect(consumer?.dead_letter_queue).toMatch(/-dlq$/);
  });

  it("production NO comparte los recursos de staging", () => {
    const stagingDb = (config.env?.staging?.d1_databases ?? []).find((d) => d.binding === "DB");
    const productionDb = (production?.d1_databases ?? []).find((d) => d.binding === "DB");
    expect(productionDb?.database_id).not.toBe(stagingDb?.database_id);
    expect((production?.r2_buckets ?? []).map((b) => b.binding).length).toBeGreaterThan(0);
    for (const bucket of production?.r2_buckets ?? []) {
      expect(bucket.remote).not.toBe(true);
    }
  });

  it("production NO apunta a localhost", () => {
    expect(String(production?.vars?.APP_URL ?? "")).not.toMatch(/localhost/i);
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
