import { describe, expect, it } from "vitest";
import { InMemoryPromptSource, PromptLoader, sha256Hex } from "./prompt-loader.js";
import { getAgentDefinition, listAgentDefinitions } from "./registry.js";
import type { AgentDefinition } from "./definition.js";

describe("integridad del Prompt Loader", () => {
  const def = getAgentDefinition("01-intake-y-clasificador");

  it("carga el prompt cuando el hash coincide", async () => {
    const text = "contenido canónico del agente";
    const hash = await sha256Hex(text);
    const loader = new PromptLoader(new InMemoryPromptSource(new Map([[def.prompt_ref, text]])));

    const loaded = await loader.load({ ...def, prompt_sha256: hash } as AgentDefinition);
    expect(loaded.text).toBe(text);
    expect(loaded.sha256).toBe(hash);
  });

  it("falla cerrada si el artefacto no coincide con el hash canónico", async () => {
    // Un prompt jurídico alterado nunca debe ejecutarse silenciosamente.
    const loader = new PromptLoader(
      new InMemoryPromptSource(new Map([[def.prompt_ref, "prompt manipulado"]])),
    );
    await expect(loader.load(def)).rejects.toThrow(/Integridad de prompt fallida/);
  });

  it("falla de forma explícita si el artefacto no existe en R2", async () => {
    const loader = new PromptLoader(new InMemoryPromptSource(new Map()));
    await expect(loader.load(def)).rejects.toThrow(/sincronización de prompts/);
  });
});

describe("Agent Registry", () => {
  it("registra exactamente los tres agentes del piloto", () => {
    expect(listAgentDefinitions().map((d) => d.node_code).sort()).toEqual(["00", "01", "03"]);
  });

  it("rechaza agentes no registrados en vez de improvisar", () => {
    expect(() => getAgentDefinition("99-agente-inexistente")).toThrow(/no está registrado/);
  });

  it("mantiene hashes de 64 caracteres para todos los agentes", () => {
    for (const def of listAgentDefinitions()) {
      expect(def.prompt_sha256, def.agent_id).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
