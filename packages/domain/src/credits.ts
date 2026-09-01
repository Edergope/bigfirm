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

// ─────────────────── Contabilidad por INTENTO de proveedor ───────────────────

/**
 * Un intento REAL contra un proveedor, con su economía, haya servido o no.
 *
 * Regla contable no negociable: UN FALLO NO ES UNA LLAMADA GRATIS. La
 * documentación oficial de OpenAI lo dice sin rodeos para los modelos de
 * razonamiento — «you could incur costs for input and reasoning tokens without
 * receiving a visible response»— y eso es exactamente lo que ocurrió el 1 de
 * septiembre: ocho llamadas reales, dinero gastado, y el ledger anotando cero.
 *
 * El resultado FUNCIONAL de la llamada y su COSTO son dos cosas distintas y se
 * registran por separado.
 */
export type ProviderAttemptOutcome =
  | "SUCCESS"
  | "OUTPUT_BUDGET_EXHAUSTED"
  | "EMPTY"
  | "HTTP_ERROR"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "INVALID_STRUCTURED_OUTPUT";

export interface ProviderUsage {
  input_tokens: number;
  cached_input_tokens: number;
  /** Total de salida facturable. YA incluye los tokens de razonamiento. */
  output_tokens: number;
  /**
   * Porción de `output_tokens` dedicada a razonar. Sólo observabilidad: sumarla
   * al total sería cobrarla dos veces.
   */
  reasoning_tokens?: number;
}

export interface ProviderAttempt {
  provider: string;
  model: string;
  attempt: number;
  outcome: ProviderAttemptOutcome;
  finish_reason?: string | null;
  http_status?: number | null;
  /**
   * `null` significa COSTO DESCONOCIDO, no costo cero. Un timeout de red no
   * devuelve usage y no podemos afirmar que no costó nada.
   */
  usage: ProviderUsage | null;
  provider_cost_usd: number | null;
  /** Id del log del gateway: identidad natural de la petición real. */
  gateway_log_id: string | null;
  started_at: string;
  latency_ms: number;
  error_message?: string;
}

export function attemptHasKnownCost(attempt: ProviderAttempt): boolean {
  return attempt.usage !== null && attempt.provider_cost_usd !== null;
}

/**
 * Estimación conservadora del costo de un intento ANTES de hacerlo.
 *
 * Existe para que una cadena de fallos sin usage —timeouts, cortes de red— no
 * pueda gastar sin límite: si no se puede medir, se reserva.
 *
 * El factor de salida sale de la medición real: la planificación que funcionó
 * consumió 8.528 tokens de un techo de 16.000, es decir el 53 %. Se reserva el
 * 60 % del techo, no el 100 %: reservar el máximo teórico haría imposible
 * cualquier ejecución normal dentro del presupuesto.
 */
export const RESERVED_OUTPUT_FRACTION = 0.6;

export function estimateAttemptCostUsd(
  rate: ModelRate,
  args: { inputTokens: number; maxOutputTokens: number },
): number {
  return providerCostUsd(rate, {
    input_tokens: args.inputTokens,
    output_tokens: Math.ceil(args.maxOutputTokens * RESERVED_OUTPUT_FRACTION),
    cached_input_tokens: 0,
  });
}

/**
 * Costo con el que un intento impacta el presupuesto de la raíz.
 *
 * Con usage real se usa el costo observado. Sin usage se conserva la reserva
 * conservadora: lo desconocido nunca vale cero.
 */
export function attemptBudgetImpactUsd(
  attempt: ProviderAttempt,
  reservedUsd: number,
): number {
  return attempt.provider_cost_usd ?? reservedUsd;
}

/**
 * Clave de idempotencia de un intento.
 *
 * La identidad natural de una petición real es el id de log del gateway: si el
 * Workflow reejecuta un step y reenvía la petición, hay OTRO id y otro cargo —
 * porque efectivamente se gastó otra vez—; si lo que se repite es la
 * contabilización de la MISMA petición, la clave coincide y no se cobra doble.
 */
export function attemptIdempotencyKey(executionId: string, attempt: ProviderAttempt): string {
  if (attempt.gateway_log_id) return `execution:${executionId}:call:${attempt.gateway_log_id}`;
  const usage = attempt.usage;
  if (usage) {
    return `execution:${executionId}:call:${attempt.provider}/${attempt.model}:${usage.input_tokens}:${usage.output_tokens}`;
  }
  return `execution:${executionId}:call:${attempt.provider}/${attempt.model}:${attempt.outcome}:${attempt.started_at}`;
}
