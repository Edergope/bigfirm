import { z } from "zod";
import { ExecutionId, MatterId, OrganizationId, UserId } from "./ids.js";

/**
 * IUSIA Credits — ledger contable propio.
 *
 * Stripe cobra dinero; IUSIA administra créditos. El saldo autoritativo vive en
 * D1, nunca en Analytics Engine ni en el AI Gateway (Blueprint §08).
 * Regla explícita: 1 crédito ≠ 1 token. El costo depende de provider y modelo.
 */

export const CREDIT_TX_KINDS = [
  "GRANT",
  "PURCHASE",
  "CONSUMPTION",
  "REFUND",
  "ADJUSTMENT",
] as const;
export const CreditTxKind = z.enum(CREDIT_TX_KINDS);
export type CreditTxKind = z.infer<typeof CreditTxKind>;

export const CreditTransaction = z.object({
  transaction_id: z.string().min(1),
  organization_id: OrganizationId,
  kind: CreditTxKind,
  /** Positivo acredita, negativo debita. Entero: los créditos no se fraccionan. */
  amount: z.number().int(),
  balance_after: z.number().int(),
  matter_id: MatterId.nullable(),
  execution_id: ExecutionId.nullable(),
  user_id: UserId.nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  provider_cost_usd: z.number().nonnegative().nullable(),
  /** Clave de idempotencia: impide doble cobro en reintentos de Workflow/Queue. */
  idempotency_key: z.string().min(1),
  created_at: z.string().datetime(),
});
export type CreditTransaction = z.infer<typeof CreditTransaction>;

/**
 * Tarifa por millón de tokens, en USD de costo upstream.
 * PENDIENTE COMERCIAL: el Blueprint §12 difiere la fórmula final de precio hasta
 * registrar costo real. Estos valores son costo de proveedor, NO precio de venta.
 */
export interface ModelRate {
  provider: string;
  model: string;
  input_usd_per_mtok: number;
  output_usd_per_mtok: number;
}

export interface CreditPolicy {
  /** Créditos por cada USD de costo upstream. Multiplicador comercial. */
  credits_per_usd: number;
  /** Cargo mínimo por ejecución, para que llamadas triviales no salgan gratis. */
  minimum_credits_per_execution: number;
}

export const DEFAULT_CREDIT_POLICY: CreditPolicy = {
  credits_per_usd: 1000,
  minimum_credits_per_execution: 1,
};

export function providerCostUsd(
  rate: ModelRate,
  usage: { input_tokens: number; output_tokens: number },
): number {
  return (
    (usage.input_tokens / 1_000_000) * rate.input_usd_per_mtok +
    (usage.output_tokens / 1_000_000) * rate.output_usd_per_mtok
  );
}

export function creditsForCost(
  costUsd: number,
  policy: CreditPolicy = DEFAULT_CREDIT_POLICY,
): number {
  return Math.max(
    policy.minimum_credits_per_execution,
    Math.ceil(costUsd * policy.credits_per_usd),
  );
}
