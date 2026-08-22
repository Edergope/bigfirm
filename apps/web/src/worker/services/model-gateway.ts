import { IusiaError } from "@iusia/domain";
import type { ModelPolicy } from "@iusia/agents";
import type { Env } from "../env.js";

/**
 * Capa de modelos. Neutral respecto del proveedor.
 *
 * El dominio jurídico NUNCA importa el SDK de OpenAI ni el de Gemini
 * (Blueprint §11 regla 4). Todo pasa por el endpoint compatible del AI Gateway,
 * que resuelve routing, límites de gasto y telemetría de costo.
 *
 * Este servicio añade robustez de ejecución (Blueprint §08, prompt §8):
 * timeout del lado del cliente, retry con backoff SÓLO en fallos transitorios,
 * fallback entre candidatos, errores normalizados y una señal explícita de
 * "no configurado" distinta de un fallo real de proveedor.
 *
 * Privacidad: `cf-aig-collect-log-payload: false` conserva metadata (modelo,
 * tokens, costo, latencia) sin persistir prompts ni respuestas jurídicas.
 */

export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelCallContext {
  organization_id: string;
  matter_id: string;
  agent_id: string;
  execution_id: string;
}

export interface ModelResult {
  provider: string;
  model: string;
  text: string;
  usage: { input_tokens: number; output_tokens: number; cached_input_tokens: number };
  /** Id del log del gateway; permite correlacionar costo real sin guardar payload. */
  gateway_log_id: string | null;
  /** Intentos consumidos hasta obtener respuesta (para observabilidad). */
  attempts: number;
}

/** Clasificación normalizada del resultado de una llamada de proveedor. */
export type ProviderFailureKind =
  | "not_configured"
  | "timeout"
  | "http_4xx"
  | "http_5xx"
  | "empty"
  | "network";

class ProviderCallError extends Error {
  constructor(
    readonly kind: ProviderFailureKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderCallError";
  }
  /** Sólo estos fallos justifican reintentar el MISMO candidato. */
  get retryable(): boolean {
    return this.kind === "timeout" || this.kind === "http_5xx" || this.kind === "network";
  }
}

/** Dependencias inyectables para poder probar sin red ni esperas reales. */
export interface ModelGatewayDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Config de reintentos. Por defecto: 2 reintentos, backoff exponencial base 250ms. */
  maxAttemptsPerCandidate?: number;
  backoffBaseMs?: number;
  /** Timeout del lado del cliente por intento. */
  requestTimeoutMs?: number;
}

const DEFAULT_SLEEP = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class ModelGateway {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly env: Env,
    deps: ModelGatewayDeps = {},
  ) {
    this.fetchImpl = deps.fetch ?? fetch;
    this.sleep = deps.sleep ?? DEFAULT_SLEEP;
    this.maxAttempts = Math.max(1, deps.maxAttemptsPerCandidate ?? 3);
    this.backoffBaseMs = deps.backoffBaseMs ?? 250;
    this.requestTimeoutMs = deps.requestTimeoutMs ?? 300_000;
  }

  /** True si faltan secretos para operar contra el gateway. */
  isConfigured(): boolean {
    return Boolean(this.env.CLOUDFLARE_ACCOUNT_ID);
  }

  private endpoint(): string {
    const account = this.env.CLOUDFLARE_ACCOUNT_ID;
    const gateway = this.env.AI_GATEWAY_NAME;
    return `https://gateway.ai.cloudflare.com/v1/${account}/${gateway}/compat/chat/completions`;
  }

  /**
   * Ejecuta una llamada de modelo aplicando la política del agente:
   * preferido primero, luego los fallbacks. Cada candidato se reintenta sólo ante
   * fallos transitorios (timeout/5xx/red) con backoff; los 4xx no se reintentan.
   */
  async complete(
    policy: ModelPolicy,
    messages: readonly ModelMessage[],
    ctx: ModelCallContext,
  ): Promise<ModelResult> {
    // Falta de credenciales = ACTION_REQUIRED_SECRET, no un fallo de proveedor.
    if (!this.isConfigured()) {
      throw new IusiaError(
        "PROVIDER_NOT_CONFIGURED",
        "AI Gateway sin credenciales: falta CLOUDFLARE_ACCOUNT_ID (ACTION_REQUIRED_SECRET)",
        { action_required: "wrangler secret put CLOUDFLARE_ACCOUNT_ID" },
      );
    }

    const candidates = [policy.preferred, ...policy.fallback];
    const failures: Array<{ candidate: string; kind: ProviderFailureKind; message: string }> = [];
    let attempts = 0;
    let sawTimeout = false;

    for (const candidate of candidates) {
      const label = `${candidate.provider}/${candidate.model}`;
      for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
        attempts++;
        try {
          const result = await this.callOnce(policy, candidate, messages, ctx);
          return { ...result, attempts };
        } catch (error) {
          const pce =
            error instanceof ProviderCallError
              ? error
              : new ProviderCallError("network", errMsg(error));
          if (pce.kind === "timeout") sawTimeout = true;
          failures.push({ candidate: label, kind: pce.kind, message: pce.message });

          const isLastAttempt = attempt === this.maxAttempts;
          if (!pce.retryable || isLastAttempt) break; // pasa al siguiente candidato
          // Backoff exponencial con jitter suave antes de reintentar el mismo candidato.
          await this.sleep(this.backoffBaseMs * 2 ** (attempt - 1));
        }
      }
    }

    // Un timeout persistente se distingue de un error genérico de proveedor.
    const code = sawTimeout && failures.every((f) => f.kind === "timeout")
      ? "PROVIDER_TIMEOUT"
      : "PROVIDER_ERROR";
    throw new IusiaError(
      code,
      "Todos los proveedores configurados para este agente fallaron",
      { agent_id: ctx.agent_id, attempts: failures },
    );
  }

  private async callOnce(
    policy: ModelPolicy,
    candidate: { provider: string; model: string },
    messages: readonly ModelMessage[],
    ctx: ModelCallContext,
  ): Promise<Omit<ModelResult, "attempts">> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      // Telemetría de costo mapeada a org/matter/agente/ejecución (Blueprint §11 regla 10).
      "cf-aig-metadata": JSON.stringify(ctx),
      // No persistir contenido confidencial en los logs del gateway.
      "cf-aig-collect-log-payload": "false",
      "cf-aig-request-timeout": String(this.requestTimeoutMs),
    };
    if (this.env.AI_GATEWAY_TOKEN) {
      headers["cf-aig-authorization"] = `Bearer ${this.env.AI_GATEWAY_TOKEN}`;
    }

    // Timeout del lado del cliente: no dependemos sólo del header del gateway.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint(), {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: `${candidate.provider}/${candidate.model}`,
          messages,
          temperature: policy.temperature,
          max_tokens: policy.max_output_tokens,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ProviderCallError("timeout", `timeout tras ${this.requestTimeoutMs}ms`);
      }
      throw new ProviderCallError("network", errMsg(error));
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const kind: ProviderFailureKind = response.status >= 500 ? "http_5xx" : "http_4xx";
      throw new ProviderCallError(kind, `HTTP ${response.status}`, response.status);
    }

    const body = (await response.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    } | null;

    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || text.length === 0) {
      throw new ProviderCallError("empty", "respuesta vacía del proveedor");
    }

    return {
      provider: candidate.provider,
      model: candidate.model,
      text,
      usage: {
        input_tokens: body?.usage?.prompt_tokens ?? 0,
        output_tokens: body?.usage?.completion_tokens ?? 0,
        cached_input_tokens: body?.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      },
      gateway_log_id: response.headers.get("cf-aig-log-id"),
    };
  }
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : "error desconocido";
}

/**
 * Tarifas de costo upstream por millón de tokens.
 * Son COSTO de proveedor, no precio de venta. Revisar contra facturación real
 * antes de fijar la fórmula comercial de créditos (Blueprint §12).
 */
export const MODEL_RATES: Record<
  string,
  { provider: string; model: string; input_usd_per_mtok: number; output_usd_per_mtok: number }
> = {
  "openai/gpt-5": {
    provider: "openai",
    model: "gpt-5",
    input_usd_per_mtok: 1.25,
    output_usd_per_mtok: 10,
  },
  "google/gemini-2.5-pro": {
    provider: "google",
    model: "gemini-2.5-pro",
    input_usd_per_mtok: 1.25,
    output_usd_per_mtok: 10,
  },
};

export function rateFor(provider: string, model: string) {
  return (
    MODEL_RATES[`${provider}/${model}`] ?? {
      provider,
      model,
      input_usd_per_mtok: 0,
      output_usd_per_mtok: 0,
    }
  );
}
