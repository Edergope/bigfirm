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

console.log(`✓ CANONICAL_AGENT_TREE_UNCHANGED: repo/agents == ${BASELINE}`);
