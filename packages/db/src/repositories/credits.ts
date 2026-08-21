import { eq } from "drizzle-orm";
import { IusiaError, newId, type CreditTxKind } from "@iusia/domain";
import type { IusiaDb } from "../client.js";
import { creditTransactions, creditWallets } from "../schema/iusia.js";

/**
 * Credit Ledger de IUSIA. Autoridad contable del saldo.
 * Toda escritura es idempotente por `idempotencyKey`: los Workflows y las Queues
 * reintentan, y un reintento no puede cobrar dos veces.
 */
export class CreditRepository {
  constructor(private readonly db: IusiaDb) {}

  async ensureWallet(organizationId: string, initialGrant = 0): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .insert(creditWallets)
      .values({ organizationId, balance: initialGrant, updatedAt: now })
      .onConflictDoNothing();
  }

  async balance(organizationId: string): Promise<number> {
    const [row] = await this.db
      .select({ balance: creditWallets.balance })
      .from(creditWallets)
      .where(eq(creditWallets.organizationId, organizationId))
      .limit(1);
    return row?.balance ?? 0;
  }

  /**
   * Registra un movimiento de créditos.
   * `amount` negativo debita. Si la clave de idempotencia ya existe, no hace nada
   * y devuelve el saldo actual.
   */
  async post(input: {
    organizationId: string;
    kind: CreditTxKind;
    amount: number;
    idempotencyKey: string;
    matterId?: string | null;
    executionId?: string | null;
    userId?: string | null;
    provider?: string | null;
    model?: string | null;
    providerCostUsd?: number | null;
    allowNegative?: boolean;
  }): Promise<{ balance: number; applied: boolean }> {
    const existing = await this.db
      .select({ balanceAfter: creditTransactions.balanceAfter })
      .from(creditTransactions)
      .where(eq(creditTransactions.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (existing[0]) return { balance: existing[0].balanceAfter, applied: false };

    const current = await this.balance(input.organizationId);
    const next = current + input.amount;
    if (next < 0 && !input.allowNegative) {
      throw new IusiaError(
        "INSUFFICIENT_CREDITS",
        "Saldo de créditos insuficiente para ejecutar la operación",
        { balance: current, required: Math.abs(input.amount) },
      );
    }

    const now = new Date().toISOString();
    await this.db.batch([
      this.db.insert(creditTransactions).values({
        id: newId("creditTx"),
        organizationId: input.organizationId,
        kind: input.kind,
        amount: input.amount,
        balanceAfter: next,
        matterId: input.matterId ?? null,
        executionId: input.executionId ?? null,
        userId: input.userId ?? null,
        provider: input.provider ?? null,
        model: input.model ?? null,
        providerCostUsd: input.providerCostUsd ?? null,
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
      }),
      this.db
        .update(creditWallets)
        .set({ balance: next, updatedAt: now })
        .where(eq(creditWallets.organizationId, input.organizationId)),
    ]);

    return { balance: next, applied: true };
  }
}
