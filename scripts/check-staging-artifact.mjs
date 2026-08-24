#!/usr/bin/env node
/**
 * Deploy safety guard (Bloque 6): valida el artifact generado por `build:staging`
 * (dist/iusia/wrangler.json) ANTES de `wrangler deploy`. Falla el CI si algo no cuadra.
 * Complementa deployment-safety.test.ts (que valida la config fuente): aquí se
 * comprueba la SALIDA real del build.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ARTIFACT = join(here, "../apps/web/dist/iusia/wrangler.json");

const EXPECT = {
  name: "iusia-staging",
  IUSIA_ENV: "staging",
  APP_URL: "https://iusia-staging.edergope.workers.dev",
  D1_ID: "ead5c7aa-fd00-4515-9964-dc0c09db3046",
  AI_SEARCH: "iusia-rag-e2e",
  ARTIFACTS: "iusia-artifacts",
  PROMPTS: "iusia-prompts",
  OLD_ACCOUNT: "a5c1f73aafac11795dbf5192c7a87817",
};

const fail = (msg) => {
  console.error(`✘ staging artifact inválido: ${msg}`);
  process.exit(1);
};

let cfg;
try {
  cfg = JSON.parse(readFileSync(ARTIFACT, "utf8"));
} catch (e) {
  fail(`no se pudo leer ${ARTIFACT}: ${e.message}`);
}

const vars = cfg.vars ?? {};
const r2 = Object.fromEntries((cfg.r2_buckets ?? []).map((b) => [b.binding, b.bucket_name]));
const d1 = (cfg.d1_databases ?? []).find((d) => d.binding === "DB");
const ai = (cfg.ai_search ?? []).find((a) => a.binding === "AI_SEARCH");
const blob = JSON.stringify(cfg);

if (cfg.name !== EXPECT.name) fail(`name=${cfg.name}, esperado ${EXPECT.name}`);
if (vars.IUSIA_ENV !== EXPECT.IUSIA_ENV) fail(`IUSIA_ENV=${vars.IUSIA_ENV}, esperado ${EXPECT.IUSIA_ENV}`);
if (vars.IUSIA_ENV === "development") fail("IUSIA_ENV=development (fail-open)");
if (vars.APP_URL !== EXPECT.APP_URL) fail(`APP_URL=${vars.APP_URL}`);
if (/localhost/i.test(vars.APP_URL ?? "")) fail("APP_URL contiene localhost");
if (!d1 || d1.database_id !== EXPECT.D1_ID) fail(`D1 id=${d1?.database_id}`);
if (/REPLACE_WITH/i.test(d1?.database_id ?? "")) fail("D1 id es placeholder");
if (!ai || ai.instance_name !== EXPECT.AI_SEARCH) fail(`AI_SEARCH=${ai?.instance_name}`);
if (r2.ARTIFACTS !== EXPECT.ARTIFACTS) fail(`ARTIFACTS=${r2.ARTIFACTS}`);
if (r2.PROMPTS !== EXPECT.PROMPTS) fail(`PROMPTS=${r2.PROMPTS}`);
if (blob.includes(EXPECT.OLD_ACCOUNT)) fail("referencia al account antiguo a5c1f73");
for (const leak of ["GOCSPX-", "ya29.", "cfut_", "BETTER_AUTH_SECRET"]) {
  if (blob.includes(leak)) fail(`posible secreto embebido: ${leak}`);
}

console.log("✓ staging artifact válido: iusia-staging / staging / D1 real / AI_SEARCH / R2 ok / sin secretos ni placeholders");
