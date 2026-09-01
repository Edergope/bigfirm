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
  /** La entrada cacheada cuesta ~10× menos. Ignorarla sobrestima cada llamada. */
  cached_input_usd_per_mtok?: number;
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

/**
 * Costo real de una llamada.
 *
 * Los proveedores informan `input_tokens` INCLUYENDO los cacheados, y facturan esa
 * porción a tarifa reducida. Cobrar todo a tarifa plena —como se hacía— sobrestima
 * el costo justo en el caso que IUSIA más produce: prompts canónicos inmutables que
 * el proveedor cachea llamada tras llamada.
 */
export function providerCostUsd(
  rate: ModelRate,
  usage: { input_tokens: number; output_tokens: number; cached_input_tokens?: number },
): number {
  const cached = Math.min(usage.cached_input_tokens ?? 0, usage.input_tokens);
  const fresh = usage.input_tokens - cached;
  const cachedRate = rate.cached_input_usd_per_mtok ?? rate.input_usd_per_mtok;
  return (
    (fresh / 1_000_000) * rate.input_usd_per_mtok +
    (cached / 1_000_000) * cachedRate +
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
