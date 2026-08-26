#!/usr/bin/env node
/**
 * Sincroniza los prompts canónicos hacia R2.
 *
 * Lee `packages/agents/src/full-agents.json` —la misma fuente que usa el Agent
 * Registry— y sube cada `agent.md` VERBATIM al bucket de prompts.
 *
 * Reglas que este script hace cumplir:
 *  - Nunca modifica, resume ni reescribe un agent.md.
 *  - Verifica el SHA-256 de cada archivo contra el registrado antes de subirlo.
 *    Si no coincide, aborta: el registry debe actualizarse conscientemente.
 *
 * Uso:
 *   node scripts/sync-prompts.mjs --local     (bucket local de wrangler dev)
 *   node scripts/sync-prompts.mjs --remote    (bucket real)
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const BUCKET = "iusia-prompts";

const remote = process.argv.includes("--remote");
const local = process.argv.includes("--local");
if (remote === local) {
  console.error("Especifica exactamente uno: --local o --remote");
  process.exit(1);
}

const definitions = JSON.parse(
  readFileSync(join(repoRoot, "packages/agents/src/full-agents.json"), "utf8"),
);

// Pipeline documental determinista (fuera del planner): estos agentes se despachan
// directamente por el Document Engine, nunca los elige el planner. Siguen con
// `enabled:false` en el registry (el planner no los ve), pero su prompt canónico
// debe existir en R2 para poder ejecutarlos. Se suben VERBATIM y verificados por SHA,
// igual que los demás; no altera el árbol canónico ni los límites del planner.
const DOCUMENT_PIPELINE_IDS = new Set([
  "08-redactor-senior-juridico",
  "02-compilador-y-entrega-final",
]);

let uploaded = 0;
for (const def of definitions.filter((d) => d.enabled || DOCUMENT_PIPELINE_IDS.has(d.agent_id))) {
  const sourcePath = join(repoRoot, def.prompt_source_path);
  const bytes = readFileSync(sourcePath);
  const actual = createHash("sha256").update(bytes).digest("hex");

  if (actual !== def.prompt_sha256) {
    console.error(
      `\n✖ INTEGRIDAD FALLIDA · ${def.agent_id}\n` +
        `  esperado: ${def.prompt_sha256}\n` +
        `  actual:   ${actual}\n` +
        `  El prompt canónico cambió. Revisa el diff, versiona el prompt y actualiza\n` +
        `  pilot-agents.json de forma consciente. No se sube nada.\n`,
    );
    process.exit(1);
  }

  execFileSync(
    "pnpm",
    [
      "--filter",
      "@iusia/web",
      "exec",
      "wrangler",
      "r2",
      "object",
      "put",
      `${BUCKET}/${def.prompt_ref}`,
      "--file",
      sourcePath,
      "--content-type",
      "text/markdown",
      remote ? "--remote" : "--local",
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );

  console.log(`✔ ${def.agent_id} → ${def.prompt_ref} (${bytes.length} bytes, sha ok)`);
  uploaded += 1;
}

console.log(
  `\n${uploaded} prompt(s) sincronizados a ${remote ? "R2 remoto" : "R2 local"}. ` +
    `Contenido verbatim, integridad verificada.`,
);
