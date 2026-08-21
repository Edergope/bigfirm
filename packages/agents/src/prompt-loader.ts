import { IusiaError } from "@iusia/domain";
import type { AgentDefinition } from "./definition.js";

/**
 * Prompt Loader — desacopla el runtime del conocimiento jurídico.
 *
 * Ninguna línea de los agent.md se incrusta en TypeScript. El prompt se carga
 * en ejecución desde una fuente (R2 en producción) y se verifica por SHA-256
 * contra el Agent Registry antes de usarse.
 */

export interface PromptSource {
  /** Devuelve el texto del prompt para una clave, o null si no existe. */
  get(ref: string): Promise<string | null>;
}

/** Fuente R2. El bucket contiene los artefactos versionados de prompt. */
export class R2PromptSource implements PromptSource {
  constructor(private readonly bucket: R2Bucket) {}

  async get(ref: string): Promise<string | null> {
    const object = await this.bucket.get(ref);
    if (!object) return null;
    return object.text();
  }
}

/** Fuente en memoria, para tests. No se usa en producción. */
export class InMemoryPromptSource implements PromptSource {
  constructor(private readonly entries: Map<string, string>) {}

  async get(ref: string): Promise<string | null> {
    return this.entries.get(ref) ?? null;
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface LoadedPrompt {
  agent_id: string;
  version: string;
  sha256: string;
  text: string;
}

export class PromptLoader {
  /** Caché por isolate. La clave incluye el hash: un prompt distinto nunca reusa caché. */
  private readonly cache = new Map<string, LoadedPrompt>();

  constructor(private readonly source: PromptSource) {}

  async load(def: AgentDefinition): Promise<LoadedPrompt> {
    const cacheKey = `${def.prompt_ref}#${def.prompt_sha256}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const text = await this.source.get(def.prompt_ref);
    if (text === null) {
      throw new IusiaError(
        "PROMPT_INTEGRITY_FAILED",
        `No se encontró el artefacto de prompt "${def.prompt_ref}". Ejecuta la sincronización de prompts.`,
        { agent_id: def.agent_id, prompt_ref: def.prompt_ref },
      );
    }

    const actual = await sha256Hex(text);
    if (actual !== def.prompt_sha256) {
      // Falla cerrada: nunca ejecutar un prompt jurídico que no es el canónico.
      throw new IusiaError(
        "PROMPT_INTEGRITY_FAILED",
        `Integridad de prompt fallida para "${def.agent_id}": el artefacto no coincide con el hash canónico`,
        { agent_id: def.agent_id, expected: def.prompt_sha256, actual },
      );
    }

    const loaded: LoadedPrompt = {
      agent_id: def.agent_id,
      version: def.prompt_version,
      sha256: actual,
      text,
    };
    this.cache.set(cacheKey, loaded);
    return loaded;
  }
}
