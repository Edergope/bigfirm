import { describe, expect, it } from "vitest";
import {
  buildAgentCatalog,
  eligibleAgentIds,
  listAgentDefinitions,
  listPipelineOnlyAgents,
  ORCHESTRATOR_AGENT_ID,
  plannerEligibleAgentIds,
} from "./registry.js";

/**
 * Integridad del Agent Registry completo (Bloque 7.7B).
 *
 * Los 30 abogados canónicos viven en `repo/agents/**` y son IP jurídica: estos tests
 * verifican que el registry los refleja con exactitud y que el catálogo que ve el
 * planner expone metadata mínima, sin prompts ni secretos.
 */

const defs = listAgentDefinitions();

// La correspondencia 1:1 con los agent.md canónicos y el cotejo de SHA contra los
// archivos reales los verifica `scripts/check-agent-tree.mjs` (guard local + CI):
// este paquete se compila para Workers y no expone APIs de Node a propósito.

describe("ALL_CANONICAL_AGENTS_REGISTERED", () => {
  it("registra exactamente los 30 agentes canónicos", () => {
    expect(defs).toHaveLength(30);
  });

  it("NO_DUPLICATE_AGENT_ID / NODE_CODE", () => {
    expect(new Set(defs.map((d) => d.agent_id)).size).toBe(defs.length);
    expect(new Set(defs.map((d) => d.node_code)).size).toBe(defs.length);
    expect(new Set(defs.map((d) => d.prompt_ref)).size).toBe(defs.length);
  });

  it("cada agente declara un sha256 canónico y su ruta de prompt", () => {
    for (const d of defs) {
      expect(d.prompt_sha256, d.agent_id).toMatch(/^[0-9a-f]{64}$/);
      expect(d.prompt_source_path, d.agent_id).toBe(`repo/agents/${d.agent_id}/agent.md`);
    }
  });
});

describe("clasificación operacional", () => {
  it("cada agente tiene runtime_role y una razón para su estado", () => {
    for (const d of defs) {
      expect(d.runtime_role, d.agent_id).toBeTruthy();
      expect(typeof d.planner_eligible, d.agent_id).toBe("boolean");
      // Habilitado ⇒ orquesta o es seleccionable. Nunca se habilita "porque sí".
      if (d.enabled) {
        expect(d.runtime_role === "ORCHESTRATOR" || d.planner_eligible, d.agent_id).toBe(true);
      }
    }
  });

  it("el orquestador nunca es seleccionable como especialista", () => {
    const orch = defs.find((d) => d.agent_id === ORCHESTRATOR_AGENT_ID)!;
    expect(orch.runtime_role).toBe("ORCHESTRATOR");
    expect(orch.planner_eligible).toBe(false);
  });

  it("los roles de documento y auditoría no son seleccionables", () => {
    const gated = listPipelineOnlyAgents().filter((d) => d.agent_id !== ORCHESTRATOR_AGENT_ID);
    for (const d of gated) {
      expect(
        ["QUALITY_REVIEW", "DOCUMENT_DRAFTER", "DOCUMENT_COMPILER"].includes(d.runtime_role),
        d.agent_id,
      ).toBe(true);
      expect(d.planner_eligible, d.agent_id).toBe(false);
    }
  });
});

describe("PLANNER_CATALOG", () => {
  const catalog = buildAgentCatalog();

  it("EXCLUDES_ORCHESTRATOR", () => {
    expect(catalog.some((c) => c.agent_id === ORCHESTRATOR_AGENT_ID)).toBe(false);
  });

  it("EXCLUDES_NON_SELECTABLE_SUPPORT_ROLES", () => {
    const forbidden = new Set(["QUALITY_REVIEW", "DOCUMENT_DRAFTER", "DOCUMENT_COMPILER", "ORCHESTRATOR"]);
    for (const c of catalog) expect(forbidden.has(c.runtime_role), c.agent_id).toBe(false);
  });

  it("CONTAINS_ALL_SELECTABLE_SPECIALISTS habilitados", () => {
    const expected = defs.filter((d) => d.enabled && d.planner_eligible).map((d) => d.agent_id);
    expect(catalog.map((c) => c.agent_id).sort()).toEqual([...expected].sort());
    expect(catalog.length).toBeGreaterThanOrEqual(20);
  });

  it("HAS_REQUIRED_FIELDS: metadata suficiente para discriminar", () => {
    for (const c of catalog) {
      expect(c.agent_id, "agent_id").toBeTruthy();
      expect(c.name.length, c.agent_id).toBeGreaterThan(3);
      expect(c.specialty.length, c.agent_id).toBeGreaterThan(20);
      expect(c.runtime_role, c.agent_id).toBeTruthy();
      expect(c.output_type, c.agent_id).toBeTruthy();
    }
    // Las especialidades deben ser distintas entre sí: si no, el planner no discrimina.
    expect(new Set(catalog.map((c) => c.specialty)).size).toBe(catalog.length);
  });

  it("NO_FULL_PROMPT_EXPOSED_TO_PLANNER", () => {
    const json = JSON.stringify(catalog);
    // Ninguna entrada se acerca al tamaño de un agent.md (decenas de miles de bytes).
    for (const c of catalog) expect(c.specialty.length, c.agent_id).toBeLessThan(400);
    expect(json).not.toContain("<identity>");
    expect(json).not.toContain("PISOSO LEGAL AI");
    // El catálogo completo debe seguir siendo barato en tokens.
    expect(json.length).toBeLessThan(20_000);
  });

  it("NO_SECRET_METADATA_EXPOSED", () => {
    const keys = new Set(catalog.flatMap((c) => Object.keys(c)));
    for (const forbidden of [
      "prompt_sha256",
      "prompt_source_path",
      "prompt_ref",
      "model_policy",
      "tools_policy",
      "governance",
    ]) {
      expect(keys.has(forbidden), forbidden).toBe(false);
    }
    const json = JSON.stringify(catalog);
    expect(json).not.toMatch(/[0-9a-f]{64}/); // ningún sha256
    expect(json).not.toMatch(/gpt-|gemini|openai|api[_-]?key/i);
  });

  it("eligibleAgentIds ⊆ planner-eligible y excluye deshabilitados", () => {
    const eligible = eligibleAgentIds();
    const selectable = plannerEligibleAgentIds();
    for (const id of eligible) {
      expect(selectable.has(id), id).toBe(true);
      expect(defs.find((d) => d.agent_id === id)!.enabled, id).toBe(true);
    }
    expect(eligible.has(ORCHESTRATOR_AGENT_ID)).toBe(false);
  });
});
