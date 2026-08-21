import { and, desc, eq } from "drizzle-orm";
import { newId } from "@iusia/domain";
import type { IusiaDb } from "../client.js";
import { auditEvents } from "../schema/iusia.js";

/**
 * Legal Audit Ledger. Separado de los logs técnicos de Workers: aquí se registra
 * quién accedió, quién aprobó, quién cambió estado y qué ejecutó la IA.
 * Nunca se escriben aquí prompts, documentos ni contenido confidencial.
 */
export class AuditRepository {
  constructor(private readonly db: IusiaDb) {}

  async record(input: {
    organizationId: string;
    matterId?: string | null;
    actorUserId?: string | null;
    actorExecutionId?: string | null;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    outcome: "ALLOWED" | "DENIED" | "SUCCESS" | "FAILURE";
    reason?: string | null;
    detail?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insert(auditEvents).values({
      id: newId("audit"),
      organizationId: input.organizationId,
      matterId: input.matterId ?? null,
      actorUserId: input.actorUserId ?? null,
      actorExecutionId: input.actorExecutionId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      outcome: input.outcome,
      reason: input.reason ?? null,
      detail: input.detail ?? {},
      occurredAt: new Date().toISOString(),
    });
  }

  async listForMatter(organizationId: string, matterId: string, limit = 100) {
    return this.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.organizationId, organizationId), eq(auditEvents.matterId, matterId)),
      )
      .orderBy(desc(auditEvents.occurredAt))
      .limit(limit);
  }
}
