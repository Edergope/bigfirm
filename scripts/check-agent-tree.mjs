#!/usr/bin/env node
/**
 * Protección de integridad de la IP canónica jurídica (Bloque 7.7A-FIX, Regla 0).
 *
 * Los 30 abogados canónicos viven en `repo/agents/**` y son propiedad intelectual
 * jurídica: NO se modifican, resumen ni "optimizan" en el trabajo de orquestación.
 * Este guard verifica con Git real que el árbol no cambió respecto del baseline y
 * que no hay modificaciones sin commitear. Falla cerrado.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const BASELINE = "1525d8f62677a8857c445a36ff2ed67db552d366";

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function fail(msg) {
  console.error(`✗ CANONICAL_AGENT_INTEGRITY_FAILED: ${msg}`);
  process.exit(1);
}

let headTree;
try {
  headTree = sh("git rev-parse HEAD:repo/agents");
} catch {
  fail("no se pudo leer el árbol repo/agents desde Git");
}

if (headTree !== BASELINE) {
  fail(`el árbol repo/agents (${headTree}) difiere del baseline canónico (${BASELINE})`);
}

// Modificaciones en working tree / staged sin commitear dentro de repo/agents.
const dirty = sh("git status --porcelain -- repo/agents");
if (dirty.length > 0) {
  fail(`hay cambios sin commitear en repo/agents:\n${dirty}`);
}

// ── Correspondencia registry ↔ IP canónica (Bloque 7.7B) ─────────────────────
// El registry describe CÓMO se ejecuta cada agente; el agent.md es su contenido
// jurídico. Ambos deben referirse exactamente al mismo conjunto y al mismo hash.
const DIR = "repo/agents";
const canonicalIds = readdirSync(DIR).filter((d) => existsSync(`${DIR}/${d}/agent.md`));
const registry = JSON.parse(readFileSync("packages/agents/src/full-agents.json", "utf8"));

if (canonicalIds.length !== 30) fail(`se esperaban 30 agent.md canónicos, hay ${canonicalIds.length}`);
if (registry.length !== canonicalIds.length) {
  fail(`registry (${registry.length}) != agent.md canónicos (${canonicalIds.length})`);
}

const registered = new Set(registry.map((d) => d.agent_id));
for (const id of canonicalIds) {
  if (!registered.has(id)) fail(`agente canónico sin registrar: ${id}`);
}
for (const def of registry) {
  if (!existsSync(`${DIR}/${def.agent_id}/agent.md`)) {
    fail(`agente registrado sin definición canónica: ${def.agent_id}`);
  }
  const sha = createHash("sha256")
    .update(readFileSync(`${DIR}/${def.agent_id}/agent.md`))
    .digest("hex");
  if (sha !== def.prompt_sha256) {
    fail(`SHA distinto para ${def.agent_id}: canónico ${sha} != registry ${def.prompt_sha256}`);
  }
  // Un agente habilitado sólo puede orquestar o ser seleccionable por el planner.
  if (def.enabled && def.runtime_role !== "ORCHESTRATOR" && !def.planner_eligible) {
    fail(`${def.agent_id} está habilitado sin rol operativo válido`);
  }
}

const enabled = registry.filter((d) => d.enabled).length;
const eligible = registry.filter((d) => d.planner_eligible).length;
console.log(`✓ CANONICAL_AGENT_TREE_UNCHANGED: repo/agents == ${BASELINE}`);
console.log(
  `✓ REGISTRY_MATCHES_CANONICAL: ${registry.length} agentes, ${enabled} operacionales, ` +
    `${eligible} seleccionables, 0 mismatches de SHA`,
);
