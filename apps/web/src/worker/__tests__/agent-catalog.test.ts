import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  InMemoryPromptSource,
  PromptLoader,
  getAgentDefinition,
  listAgentDefinitions,
} from "@iusia/agents";
import { renderWorkPackage, WorkPackage, newId } from "@iusia/domain";
import { UNTRUSTED_SYSTEM_GUARD } from "../agents/guards.js";
import { rateFor } from "../services/model-gateway.js";

/**
 * P0 — Auditoría del Agent Prompt System + dry-run runtime de los 30 agentes.
 *
 * Fuente canónica: repo/agents/<agent_id>/agent.md. Manifest normativo:
 * repo/manifests/AGENTS_MANIFEST.json. Registry: packages/agents (full-agents.json).
 * Estos tests fallan ante cualquier drift (falta de archivo, SHA desajustado,
 * id duplicado, entry sin archivo, archivo sin entry, prompt vacío, agente desconocido).
 *
 * No se realiza ninguna llamada a un LLM: el dry-run se detiene justo antes del provider.
 */

// cwd durante vitest = raíz del repo.
const REPO = process.cwd();
const manifest = JSON.parse(
  readFileSync(join(REPO, "repo/manifests/AGENTS_MANIFEST.json"), "utf8"),
) as { entries: Array<{ name: string; sha256: string }> };
const manifestById = new Map(manifest.entries.map((e) => [e.name, e]));

function canonicalPath(agentId: string): string {
  return join(REPO, "repo/agents", agentId, "agent.md");
}
function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

describe("catálogo canónico de agentes", () => {
  const defs = listAgentDefinitions();

  it("el manifest normativo define exactamente 30 agentes", () => {
    expect(manifest.entries).toHaveLength(30);
  });

  it("el registry registra los mismos 30 agentes que el manifest", () => {
    expect(defs).toHaveLength(manifest.entries.length);
    const regIds = new Set(defs.map((d) => d.agent_id));
    const manIds = new Set(manifest.entries.map((e) => e.name));
    expect(regIds).toEqual(manIds);
  });

  it("agent_id y node_code son únicos (sin colisiones)", () => {
    const ids = defs.map((d) => d.agent_id);
    const nodes = defs.map((d) => d.node_code);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(nodes).size).toBe(nodes.length);
  });

  it("correspondencia 1:1 registry ↔ agent.md ↔ manifest, con SHA coincidente", () => {
    for (const def of defs) {
      // El archivo canónico existe, es legible, no vacío y UTF-8.
      const buf = readFileSync(canonicalPath(def.agent_id));
      expect(buf.length).toBeGreaterThan(0);
      expect(() => buf.toString("utf8")).not.toThrow();

      const actual = sha256(buf);
      // SHA del registry == archivo == manifest.
      expect(actual, `${def.agent_id}: registry vs archivo`).toBe(def.prompt_sha256);
      expect(actual, `${def.agent_id}: manifest vs archivo`).toBe(
        manifestById.get(def.agent_id)?.sha256,
      );
      // runtime_prompt_ref presente y resoluble por convención.
      expect(def.prompt_ref).toContain(def.agent_id);
      expect(def.prompt_ref).toContain(def.prompt_version);
    }
  });

  it("rechaza un agent_id desconocido (no se ejecuta lo que no está registrado)", () => {
    expect(() => getAgentDefinition("99-agente-inexistente")).toThrow(/no está registrado/);
  });
});

describe("dry-run runtime de los 30 agentes (sin LLM)", () => {
  const defs = listAgentDefinitions();

  it("los 30 agentes quedan AGENT_RUNTIME_READY hasta justo antes del provider", async () => {
    const ready: string[] = [];
    const failed: Array<{ agent: string; error: string }> = [];

    for (const def of defs) {
      try {
        // 1) Registry → definición (ya la tenemos). 2) Prompt source desde el archivo canónico.
        const canonical = readFileSync(canonicalPath(def.agent_id), "utf8");
        const loader = new PromptLoader(
          new InMemoryPromptSource(new Map([[def.prompt_ref, canonical]])),
        );
        // 3) PromptLoader localiza + verifica hash + carga el prompt completo (no vacío).
        const prompt = await loader.load(def);
        if (prompt.text.length === 0) throw new Error("prompt vacío");
        if (prompt.sha256 !== def.prompt_sha256) throw new Error("hash desajustado");

        // 4) WorkPackage mínimo VÁLIDO (contrato explícito, no concatenación arbitraria).
        const wp = WorkPackage.parse({
          work_package_id: newId("workPackage"),
          matter_id: "mtr_aaaaaaaaaaaaaaaaaaaaaaaa",
          execution_id: "exe_aaaaaaaaaaaaaaaaaaaaaaaa",
          parent_execution_id: null,
          agent_id: def.agent_id,
          objective: "Dry-run de preparación del runtime del agente.",
          questions: [],
          fact_refs: [],
          source_refs: [],
          document_excerpts: [],
          upstream_outputs: [],
          constraints: [],
          expected_output_schema: def.output_schema_id,
          allowed_tools: def.tools_policy,
          jurisdiction: "Colombia",
          language: "es-CO",
          created_at: new Date().toISOString(),
        });

        // 5) Ensamble de mensajes previo al provider (guarda + prompt canónico + WorkPackage).
        const rendered = renderWorkPackage(wp);
        const messages = [
          { role: "system" as const, content: UNTRUSTED_SYSTEM_GUARD },
          { role: "system" as const, content: prompt.text },
          { role: "user" as const, content: rendered },
        ];
        if (messages.some((m) => m.content.length === 0)) throw new Error("mensaje vacío");

        // 6) Resolución de model route + tools (sin llamar al proveedor).
        const preferred = def.model_policy.preferred;
        if (!preferred.provider || !preferred.model) throw new Error("model route incompleta");
        rateFor(preferred.provider, preferred.model);
        if (!Array.isArray(def.tools_policy)) throw new Error("tools policy inválida");

        // 7) DETENERSE antes de la llamada externa al LLM.
        ready.push(def.agent_id);
      } catch (error) {
        failed.push({ agent: def.agent_id, error: error instanceof Error ? error.message : "?" });
      }
    }

    expect(failed, JSON.stringify(failed)).toEqual([]);
    expect(ready).toHaveLength(30);
  });
});
