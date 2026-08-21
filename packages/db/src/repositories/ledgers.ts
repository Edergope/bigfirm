import { and, eq } from "drizzle-orm";
import { newId, type Authority, type CanonicalFact } from "@iusia/domain";
import type { IusiaDb } from "../client.js";
import { authorities, facts } from "../schema/iusia.js";

/** Fact Ledger persistente por Matter. */
export class FactRepository {
  constructor(private readonly db: IusiaDb) {}

  async listForMatter(organizationId: string, matterId: string) {
    return this.db
      .select()
      .from(facts)
      .where(and(eq(facts.organizationId, organizationId), eq(facts.matterId, matterId)));
  }

  /** Inserta o actualiza hechos por `fact_id` canónico dentro del matter. */
  async upsertMany(
    organizationId: string,
    matterId: string,
    items: readonly CanonicalFact[],
    establishedByExecutionId: string | null,
  ): Promise<number> {
    if (items.length === 0) return 0;
    const now = new Date().toISOString();
    for (const f of items) {
      await this.db
        .insert(facts)
        .values({
          id: newId("fact"),
          organizationId,
          matterId,
          factKey: f.fact_id,
          statement: f.statement,
          certainty: f.certainty,
          sourceClass: f.source_class,
          primarySource: f.primary_source,
          numbers: f.numbers,
          establishedByExecutionId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [facts.matterId, facts.factKey],
          set: {
            statement: f.statement,
            certainty: f.certainty,
            sourceClass: f.source_class,
            primarySource: f.primary_source,
            numbers: f.numbers,
            establishedByExecutionId,
            updatedAt: now,
          },
        });
    }
    return items.length;
  }
}

/** Authority Ledger: permite la auditoría de fuentes del agente 11. */
export class AuthorityRepository {
  constructor(private readonly db: IusiaDb) {}

  async listForMatter(organizationId: string, matterId: string) {
    return this.db
      .select()
      .from(authorities)
      .where(
        and(eq(authorities.organizationId, organizationId), eq(authorities.matterId, matterId)),
      );
  }

  async upsertMany(
    organizationId: string,
    matterId: string,
    items: readonly Authority[],
    establishedByExecutionId: string | null,
  ): Promise<number> {
    if (items.length === 0) return 0;
    const now = new Date().toISOString();
    for (const a of items) {
      await this.db
        .insert(authorities)
        .values({
          id: newId("authority"),
          organizationId,
          matterId,
          authorityKey: a.authority_id,
          citation: a.citation,
          type: a.type,
          status: a.status,
          ruleSummary: a.rule_summary,
          verifiedAt: a.status === "VERIFIED_CURRENT" ? now : null,
          establishedByExecutionId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [authorities.matterId, authorities.authorityKey],
          set: {
            citation: a.citation,
            type: a.type,
            status: a.status,
            ruleSummary: a.rule_summary,
            verifiedAt: a.status === "VERIFIED_CURRENT" ? now : null,
            establishedByExecutionId,
            updatedAt: now,
          },
        });
    }
    return items.length;
  }
}
