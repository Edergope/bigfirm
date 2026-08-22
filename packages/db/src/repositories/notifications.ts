import { and, desc, eq } from "drizzle-orm";
import type { IusiaDb } from "../client.js";
import { notifications } from "../schema/iusia.js";

/**
 * NotificationRepository — ledger de trazabilidad de notificaciones en D1.
 *
 * El ledger es la fuente de verdad de qué se intentó enviar y con qué resultado,
 * independiente del proveedor. Aislado por organización.
 */
export interface RecordPendingInput {
  id: string;
  organizationId: string;
  matterId: string | null;
  executionId: string | null;
  recipient: string;
  channel: string;
  event: string;
  subject: string | null;
  provider: string;
  correlationId: string | null;
  detail?: Record<string, unknown>;
}

export type NotificationResultStatus = "SENT" | "NOT_CONFIGURED" | "FAILED";

export class NotificationRepository {
  constructor(private readonly db: IusiaDb) {}

  /**
   * Registra la notificación en estado PENDING antes de intentar el envío.
   * Idempotente por `id`: reintentar no duplica la fila.
   */
  async recordPending(input: RecordPendingInput): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .insert(notifications)
      .values({
        id: input.id,
        organizationId: input.organizationId,
        matterId: input.matterId,
        executionId: input.executionId,
        recipient: input.recipient,
        channel: input.channel,
        event: input.event,
        subject: input.subject,
        provider: input.provider,
        providerMessageId: null,
        status: "PENDING",
        normalizedError: null,
        correlationId: input.correlationId,
        detail: input.detail ?? {},
        createdAt: now,
        attemptedAt: now,
        sentAt: null,
      })
      .onConflictDoNothing();
  }

  /** Actualiza el resultado del intento de envío. */
  async markResult(
    organizationId: string,
    id: string,
    status: NotificationResultStatus,
    opts: { providerMessageId?: string | null; error?: string | null } = {},
  ): Promise<void> {
    await this.db
      .update(notifications)
      .set({
        status,
        providerMessageId: opts.providerMessageId ?? null,
        normalizedError: opts.error ?? null,
        sentAt: status === "SENT" ? new Date().toISOString() : null,
      })
      .where(and(eq(notifications.organizationId, organizationId), eq(notifications.id, id)));
  }

  async findById(organizationId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.organizationId, organizationId), eq(notifications.id, id)))
      .limit(1);
    return row ?? null;
  }

  async listForMatter(organizationId: string, matterId: string, limit = 100) {
    return this.db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.organizationId, organizationId), eq(notifications.matterId, matterId)),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }
}
