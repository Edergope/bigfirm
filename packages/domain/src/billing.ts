import { z } from "zod";

/**
 * Port de facturación. Stripe está DIFERIDO (Blueprint §03): esta frontera existe
 * para que el resto del sistema no dependa de un proveedor de pagos concreto.
 *
 * Stripe cobra dinero; el Credit Ledger de IUSIA es la autoridad contable de créditos.
 * Nunca se mezclan: un pago de Stripe se traduce en una transacción GRANT de créditos.
 */

export const CheckoutRequest = z.object({
  organization_id: z.string().min(1),
  /** Paquete de créditos a comprar. Los precios reales se definen tras el MVP. */
  credit_package: z.string().min(1),
  success_url: z.string().url(),
  cancel_url: z.string().url(),
});
export type CheckoutRequest = z.infer<typeof CheckoutRequest>;

/** Evento de billing normalizado (independiente de la forma exacta de Stripe). */
export const BillingEvent = z.object({
  provider: z.string(),
  type: z.enum(["checkout.completed", "payment.failed", "refund.issued"]),
  organization_id: z.string(),
  credit_amount: z.number().int(),
  /** Clave de idempotencia del proveedor: impide acreditar dos veces un webhook. */
  idempotency_key: z.string().min(1),
});
export type BillingEvent = z.infer<typeof BillingEvent>;

export interface BillingProvider {
  readonly id: string;
  status(): "CONNECTED" | "DEFERRED_CONFIGURATION";
  createCheckout(request: CheckoutRequest): Promise<{ checkout_url: string }>;
  /** Verifica y normaliza un webhook entrante. Devuelve null si no es procesable. */
  parseWebhook(payload: string, signature: string | null): Promise<BillingEvent | null>;
}
