import { IusiaError } from "@iusia/domain";
import type { ModelPolicy } from "@iusia/agents";
import type { Env } from "../env.js";

/**
 * Capa de modelos. Neutral respecto del proveedor.
 *
 * El dominio jurídico NUNCA importa el SDK de OpenAI ni el de Gemini
 * (Blueprint §11 regla 4). Todo pasa por el endpoint compatible del AI Gateway,
 * que resuelve routing, reintentos, límites de gasto y telemetría de costo.
 *
 * Privacidad: `cf-aig-collect-log-payload: false` conserva metadata (modelo,
 * tokens, costo, latencia) sin persistir prompts ni respuestas jurídicas en el
 * servicio de logs (Blueprint §08).
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
}

export class ModelGateway {
  constructor(private readonly env: Env) {}

  private endpoint(): string {
    const account = this.env.CLOUDFLARE_ACCOUNT_ID;
    const gateway = this.env.AI_GATEWAY_NAME;
    if (!account) {
      throw new IusiaError(
        "PROVIDER_ERROR",
        "CLOUDFLARE_ACCOUNT_ID no está configurado; la capa de modelos no puede operar",
      );
    }
    return `https://gateway.ai.cloudflare.com/v1/${account}/${gateway}/compat/chat/completions`;
  }

  /**
   * Ejecuta una llamada de modelo aplicando la política del agente:
   * preferido primero, luego los fallbacks declarados. La conmutación se registra.
   */
  async complete(
    policy: ModelPolicy,
    messages: readonly ModelMessage[],
    ctx: ModelCallContext,
  ): Promise<ModelResult> {
    const candidates = [policy.preferred, ...policy.fallback];
    const failures: string[] = [];

    for (const candidate of candidates) {
      try {
        return await this.callOnce(policy, candidate, messages, ctx);
      } catch (error) {
        // Sólo se registra proveedor/modelo y el mensaje: nunca el payload jurídico.
        failures.push(
          `${candidate.provider}/${candidate.model}: ${
            error instanceof Error ? error.message : "error desconocido"
          }`,
        );
      }
    }

    throw new IusiaError(
      "PROVIDER_ERROR",
      "Todos los proveedores configurados para este agente fallaron",
      { agent_id: ctx.agent_id, attempts: failures },
    );
  }

  private async callOnce(
    policy: ModelPolicy,
    candidate: { provider: string; model: string },
    messages: readonly ModelMessage[],
    ctx: ModelCallContext,
  ): Promise<ModelResult> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      // Telemetría de costo mapeada a org/matter/agente/ejecución (Blueprint §11 regla 10).
      "cf-aig-metadata": JSON.stringify(ctx),
      // No persistir contenido confidencial en los logs del gateway.
      "cf-aig-collect-log-payload": "false",
      "cf-aig-request-timeout": "300000",
    };
    if (this.env.AI_GATEWAY_TOKEN) {
      headers["cf-aig-authorization"] = `Bearer ${this.env.AI_GATEWAY_TOKEN}`;
    }

    const response = await fetch(this.endpoint(), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: `${candidate.provider}/${candidate.model}`,
        messages,
        temperature: policy.temperature,
        max_tokens: policy.max_output_tokens,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };

    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string" || text.length === 0) {
      throw new Error("respuesta vacía del proveedor");
    }

    return {
      provider: candidate.provider,
      model: candidate.model,
      text,
      usage: {
        input_tokens: body.usage?.prompt_tokens ?? 0,
        output_tokens: body.usage?.completion_tokens ?? 0,
        cached_input_tokens: body.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      },
      gateway_log_id: response.headers.get("cf-aig-log-id"),
    };
  }
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
