import type { BillingEvent, BillingProvider, CheckoutRequest } from "@iusia/domain";
import { IusiaError } from "@iusia/domain";

/**
 * StripeBillingProvider — frontera de facturación. DIFERIDO (Blueprint §03).
 *
 * No implementa cobro real: sin `STRIPE_SECRET_KEY` configurado, `status()` es
 * DEFERRED_CONFIGURATION y las operaciones lanzan. La forma del webhook normalizado
 * (BillingEvent) ya está definida para que, al conectarlo, un pago se traduzca en una
 * transacción GRANT del Credit Ledger de IUSIA (idempotente).
 */
export class StripeBillingProvider implements BillingProvider {
  readonly id = "stripe";
  constructor(private readonly secretKey: string | null) {}

  status() {
    return this.secretKey ? ("CONNECTED" as const) : ("DEFERRED_CONFIGURATION" as const);
  }

  async createCheckout(_request: CheckoutRequest): Promise<{ checkout_url: string }> {
    throw new IusiaError(
      "PROVIDER_ERROR",
      "Stripe está diferido: no hay cobro configurado (ver docs/PENDIENTES.md)",
    );
  }

  async parseWebhook(): Promise<BillingEvent | null> {
    // Sin clave de firma no se puede verificar un webhook: se rechaza en vez de
    // confiar en un payload sin verificar.
    return null;
  }
}
