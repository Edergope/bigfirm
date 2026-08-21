import { eq } from "drizzle-orm";
import type { IusiaDb } from "../client.js";
import { agentDefinitions } from "../schema/iusia.js";

export interface AgentDefinitionRow {
  agentId: string;
  name: string;
  role: string;
  domain: string;
  promptRef: string;
  promptVersion: string;
  promptSha256: string;
  enabled: boolean;
  modelPolicy: unknown;
  toolsPolicy: string[];
  outputType: string;
  outputSchemaId: string;
  parallelizable: boolean;
  timeoutMs: number;
}

/**
 * Prompt/Agent Registry en D1. Guarda METADATA, nunca el texto del prompt.
 * El conocimiento jurídico permanece en agent.md y su artefacto en R2.
 */
export class AgentRepository {
  constructor(private readonly db: IusiaDb) {}

  async findById(agentId: string) {
    const [row] = await this.db
      .select()
      .from(agentDefinitions)
      .where(eq(agentDefinitions.agentId, agentId))
      .limit(1);
    return row ?? null;
  }

  async listEnabled() {
    return this.db
      .select()
      .from(agentDefinitions)
      .where(eq(agentDefinitions.enabled, true));
  }

  async upsert(def: AgentDefinitionRow): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .insert(agentDefinitions)
      .values({ ...def, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: agentDefinitions.agentId,
        set: {
          name: def.name,
          role: def.role,
          domain: def.domain,
          promptRef: def.promptRef,
          promptVersion: def.promptVersion,
          promptSha256: def.promptSha256,
          enabled: def.enabled,
          modelPolicy: def.modelPolicy,
          toolsPolicy: def.toolsPolicy,
          outputType: def.outputType,
          outputSchemaId: def.outputSchemaId,
          parallelizable: def.parallelizable,
          timeoutMs: def.timeoutMs,
          updatedAt: now,
        },
      });
  }
}
