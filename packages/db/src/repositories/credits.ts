import { and, eq, sql } from "drizzle-orm";
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
    // El wallet debe existir para que la mutación atómica tenga una fila que tocar.
    // Antes, un movimiento sobre una organización sin wallet actualizaba 0 filas en
    // silencio: quedaba el asiento sin saldo.
    await this.ensureWallet(input.organizationId);

    const now = new Date().toISOString();
    const txId = newId("creditTx");

    // 1. La transacción se reclama PRIMERO. El índice único sobre `idempotency_key`
    //    es lo que decide quién aplica el movimiento: comprobar antes con un SELECT
    //    dejaba una ventana en la que dos reintentos simultáneos cobraban dos veces.
    const claimed = await this.db
      .insert(creditTransactions)
      .values({
        id: txId,
        organizationId: input.organizationId,
        kind: input.kind,
        amount: input.amount,
        // Provisional: se corrige con el saldo REAL devuelto por la mutación atómica.
        balanceAfter: 0,
        matterId: input.matterId ?? null,
        executionId: input.executionId ?? null,
        userId: input.userId ?? null,
        provider: input.provider ?? null,
        model: input.model ?? null,
        providerCostUsd: input.providerCostUsd ?? null,
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: creditTransactions.id });

    if (!claimed[0]) {
      // Ya aplicada por otro intento: se devuelve el saldo que dejó aquella.
      const [existing] = await this.db
        .select({ balanceAfter: creditTransactions.balanceAfter })
        .from(creditTransactions)
        .where(eq(creditTransactions.idempotencyKey, input.idempotencyKey))
        .limit(1);
      return {
        balance: existing?.balanceAfter ?? (await this.balance(input.organizationId)),
        applied: false,
      };
    }

    // 2. Mutación ATÓMICA del saldo: `balance = balance + amount` en SQL. Nunca se
    //    escribe un valor absoluto calculado en JS — dos débitos en paralelo perdían
    //    uno de los dos (lost update) y el wallet divergía del ledger.
    const guard = input.allowNegative
      ? sql`1 = 1`
      : sql`${creditWallets.balance} + ${input.amount} >= 0`;
    const updated = await this.db
      .update(creditWallets)
      .set({ balance: sql`${creditWallets.balance} + ${input.amount}`, updatedAt: now })
      .where(and(eq(creditWallets.organizationId, input.organizationId), guard))
      .returning({ balance: creditWallets.balance });

    if (!updated[0]) {
      // Saldo insuficiente (o wallet inexistente): se revierte la reclamación para
      // que un reintento posterior con la misma clave pueda volver a intentarlo.
      await this.db.delete(creditTransactions).where(eq(creditTransactions.id, txId));
      const current = await this.balance(input.organizationId);
      throw new IusiaError(
        "INSUFFICIENT_CREDITS",
        "Saldo de créditos insuficiente para ejecutar la operación",
        { balance: current, required: Math.abs(input.amount) },
      );
    }

    const next = updated[0].balance;
    // 3. El asiento queda con el saldo real posterior al movimiento.
    await this.db
      .update(creditTransactions)
      .set({ balanceAfter: next })
      .where(eq(creditTransactions.id, txId));

    return { balance: next, applied: true };
  }

  /**
   * Reconciliación contable: saldo del wallet frente a la suma del ledger.
   * Es la comprobación que delata un lost update, y la usan los tests de concurrencia.
   */
  async reconcile(organizationId: string): Promise<{
    walletBalance: number;
    ledgerBalance: number;
    reconciled: boolean;
  }> {
    const [wallet, ledger] = await Promise.all([
      this.balance(organizationId),
      this.db
        .select({ total: sql<number>`coalesce(sum(${creditTransactions.amount}), 0)` })
        .from(creditTransactions)
        .where(eq(creditTransactions.organizationId, organizationId)),
    ]);
    const ledgerBalance = Number(ledger[0]?.total ?? 0);
    return { walletBalance: wallet, ledgerBalance, reconciled: wallet === ledgerBalance };
  }
}
