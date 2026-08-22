import type { NotificationProvider, ProviderSendResult } from "@iusia/domain";

/**
 * Adapters de notificación.
 *
 * ResendNotificationProvider habla con la REST API de Resend vía fetch (sin SDK),
 * de modo que el dominio nunca importa Resend. Sin `RESEND_API_KEY`, status() es
 * NOT_CONFIGURED y `send` devuelve NOT_CONFIGURED (no lanza, no bloquea).
 */
export interface ResendConfig {
  apiKey: string | null;
  from: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class ResendNotificationProvider implements NotificationProvider {
  readonly id = "resend";
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly cfg: ResendConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.timeoutMs = cfg.timeoutMs ?? 15_000;
  }

  status() {
    return this.cfg.apiKey ? ("CONNECTED" as const) : ("NOT_CONFIGURED" as const);
  }

  async send(input: {
    to: string;
    subject: string;
    text: string;
    tags: Record<string, string>;
  }): Promise<ProviderSendResult> {
    if (!this.cfg.apiKey) {
      return { status: "NOT_CONFIGURED", failure_kind: "not_configured" };
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.to)) {
      return { status: "FAILED", failure_kind: "invalid_recipient", error: "destinatario inválido" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.cfg.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.cfg.from,
          to: input.to,
          subject: input.subject,
          text: input.text,
          // Metadata operativa para correlación; nunca contenido jurídico.
          tags: Object.entries(input.tags).map(([name, value]) => ({ name, value })),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        return {
          status: "FAILED",
          failure_kind: res.status >= 500 ? "http_5xx" : "http_4xx",
          error: `HTTP ${res.status}`,
        };
      }
      const body = (await res.json().catch(() => null)) as { id?: string } | null;
      return { status: "SENT", provider_message_id: body?.id ?? null };
    } catch (error) {
      if (controller.signal.aborted) {
        return { status: "FAILED", failure_kind: "timeout", error: `timeout ${this.timeoutMs}ms` };
      }
      return {
        status: "FAILED",
        failure_kind: "network",
        error: error instanceof Error ? error.message : "error de red",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Proveedor en memoria para tests. Registra los envíos y puede simular fallos. */
export class FakeNotificationProvider implements NotificationProvider {
  readonly id = "fake";
  readonly sent: Array<{ to: string; subject: string; text: string; tags: Record<string, string> }> = [];
  constructor(
    private readonly opts: {
      configured?: boolean;
      fail?: ProviderSendResult;
    } = {},
  ) {}

  status() {
    return this.opts.configured === false ? ("NOT_CONFIGURED" as const) : ("CONNECTED" as const);
  }

  async send(input: {
    to: string;
    subject: string;
    text: string;
    tags: Record<string, string>;
  }): Promise<ProviderSendResult> {
    if (this.opts.configured === false) {
      return { status: "NOT_CONFIGURED", failure_kind: "not_configured" };
    }
    if (this.opts.fail) return this.opts.fail;
    this.sent.push(input);
    return { status: "SENT", provider_message_id: `fake_${this.sent.length}` };
  }
}
