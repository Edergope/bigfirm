import {
  IusiaError,
  providerCostUsd,
  type ProviderAttempt,
  type ProviderUsage,
} from "@iusia/domain";
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
  /** Todos los intentos reales de esta llamada, incluidos los fallidos. */
  attempts_detail: ProviderAttempt[];
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
  /**
   * El modelo agotó su presupuesto de salida ANTES de emitir contenido. En un modelo
   * de razonamiento `max_completion_tokens` cubre también los tokens de razonamiento,
   * así que un techo pensado como límite de contenido deja la respuesta vacía. Se
   * distingue de `empty` porque la causa —y el arreglo— son otros: no es que el
   * proveedor fallara, es que le pedimos pensar con menos espacio del que necesita.
   */
  | "output_budget_exhausted"
  | "network";

class ProviderCallError extends Error {
  constructor(
    readonly kind: ProviderFailureKind,
    message: string,
    readonly status?: number,
    /** Intento contabilizable asociado, cuando existe. Un fallo no es gratis. */
    readonly attempt?: ProviderAttempt,
  ) {
    super(message);
    this.name = "ProviderCallError";
  }
  /** Sólo estos fallos justifican reintentar el MISMO candidato. */
  get retryable(): boolean {
    return this.kind === "timeout" || this.kind === "http_5xx" || this.kind === "network";
  }
}

/**
 * Ganchos de observabilidad de una llamada al modelo.
 *
 * Existen porque una llamada de razonamiento puede durar más de dos minutos y el
 * Execution Ledger sólo registraba su principio y su final: entre medias, el
 * producto no tenía nada que mostrar. Estos ganchos emiten evidencia REAL de que la
 * llamada está en curso; nunca alteran su resultado.
 */
export interface ModelCallHooks {
  /**
   * Se invoca tras CADA intento real, con éxito o sin él, para que el caller lo
   * contabilice. Es el punto por el que una llamada fallida deja de ser gratis.
   */
  onSettled?: (attempt: ProviderAttempt) => void | Promise<void>;
  onAttempt?: (info: {
    provider: string;
    model: string;
    attempt: number;
    candidateIndex: number;
  }) => void | Promise<void>;
  onResponse?: (info: {
    provider: string;
    model: string;
    attempt: number;
    durationMs: number;
  }) => void | Promise<void>;
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
    // `fetch` global de Workers exige `this = globalThis`; almacenarlo como propiedad
    // y llamarlo como `this.fetchImpl(...)` provoca "Illegal invocation". El wrapper
    // preserva el binding global (y sigue siendo inyectable en tests).
    this.fetchImpl = deps.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = deps.sleep ?? DEFAULT_SLEEP;
    this.maxAttempts = Math.max(1, deps.maxAttemptsPerCandidate ?? 3);
    this.backoffBaseMs = deps.backoffBaseMs ?? 250;
    this.requestTimeoutMs = deps.requestTimeoutMs ?? 300_000;
  }

  /** Liquida un intento sin que un fallo de observabilidad rompa la ejecución. */
  private async settle(hooks: ModelCallHooks, attempt: ProviderAttempt): Promise<void> {
    try {
      await hooks.onSettled?.(attempt);
    } catch {
      // La contabilidad no puede tumbar el trabajo jurídico; el fallo se ve en el log.
    }
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
    hooks: ModelCallHooks = {},
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
    /** Todos los intentos reales, para que ninguno se pierda al fallar. */
    const settled: ProviderAttempt[] = [];
    let attempts = 0;
    let sawTimeout = false;

    for (const candidate of candidates) {
      const label = `${candidate.provider}/${candidate.model}`;
      for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
        attempts++;
        // Señal de vida ANTES de la llamada. Una llamada de planificación tarda de
        // 30 a 130 segundos contra un modelo de razonamiento; sin esta señal el
        // sistema quedaba mudo todo ese tiempo y el abogado sólo podía concluir que
        // se había colgado. El hook no puede afectar a la llamada: si falla, se ignora.
        try {
          await hooks.onAttempt?.({
            provider: candidate.provider,
            model: candidate.model,
            attempt,
            candidateIndex: candidates.indexOf(candidate),
          });
        } catch {
          // La observabilidad nunca rompe la ejecución jurídica.
        }
        const startedAt = Date.now();
        try {
          const { attempt: record, text } = await this.callOnce(
            policy,
            candidate,
            messages,
            ctx,
            attempt,
          );
          settled.push(record);
          await this.settle(hooks, record);
          if (text === null) {
            const kind: ProviderFailureKind =
              record.outcome === "OUTPUT_BUDGET_EXHAUSTED" ? "output_budget_exhausted" : "empty";
            throw new ProviderCallError(
              kind,
              record.outcome === "OUTPUT_BUDGET_EXHAUSTED"
                ? `${label} agotó max_completion_tokens=${policy.max_output_tokens} sin emitir contenido: en un modelo de razonamiento ese techo incluye los tokens de razonamiento`
                : `respuesta vacía del proveedor (finish_reason=${String(record.finish_reason ?? "desconocido")})`,
              record.http_status ?? undefined,
              record,
            );
          }
          try {
            await hooks.onResponse?.({
              provider: record.provider,
              model: record.model,
              attempt,
              durationMs: Date.now() - startedAt,
            });
          } catch {
            // idem
          }
          return {
            provider: record.provider,
            model: record.model,
            text,
            usage: record.usage ?? { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 },
            gateway_log_id: record.gateway_log_id,
            attempts,
            attempts_detail: settled,
          };
        } catch (error) {
          const pce =
            error instanceof ProviderCallError
              ? error
              : new ProviderCallError("network", errMsg(error));
          // Un intento que no pasó por `callOnce` (red, timeout) también se liquida.
          if (pce.attempt && !settled.includes(pce.attempt)) {
            settled.push(pce.attempt);
            await this.settle(hooks, pce.attempt);
          }
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
      {
        agent_id: ctx.agent_id,
        attempts: failures,
        // Los intentos YA quedaron contabilizados por `onSettled`; se exponen para
        // que el caller pueda cerrar la ejecución sabiendo cuánto costó fallar.
        settled_attempts: settled.length,
        settled_cost_usd: settled.reduce((sum, a) => sum + (a.provider_cost_usd ?? 0), 0),
        unknown_cost_attempts: settled.filter((a) => a.provider_cost_usd === null).length,
      },
    );
  }

  /**
   * Una petición real al proveedor. Devuelve SIEMPRE un intento contabilizable.
   *
   * El orden importa y antes estaba invertido: se validaba el contenido y se lanzaba
   * ANTES de mirar el `usage`, de modo que una respuesta con `finish_reason=length`
   * —que sí consumió tokens de razonamiento facturables— se descartaba entera y
   * quedaba registrada como cero. Ahora se captura el usage, se cuesta el intento y
   * sólo después se decide si el resultado sirve.
   */
  private async callOnce(
    policy: ModelPolicy,
    candidate: { provider: string; model: string },
    messages: readonly ModelMessage[],
    ctx: ModelCallContext,
    attemptNumber: number,
  ): Promise<{ attempt: ProviderAttempt; text: string | null }> {
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

    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const base = {
      provider: candidate.provider,
      model: candidate.model,
      attempt: attemptNumber,
      started_at: startedAt,
    };
    /** Intento sin usage: costo DESCONOCIDO, jamás cero. */
    const unmeasured = (
      outcome: ProviderAttempt["outcome"],
      message: string,
      httpStatus?: number,
    ): ProviderAttempt => ({
      ...base,
      outcome,
      usage: null,
      provider_cost_usd: null,
      gateway_log_id: null,
      http_status: httpStatus ?? null,
      latency_ms: Date.now() - startedMs,
      error_message: message,
    });

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
          // Parámetros dependientes de la familia del modelo (token limit + temperature).
          // Punto único de compatibilidad; nunca emite claves incompatibles.
          ...modelRequestParams(candidate.provider, candidate.model, policy),
        }),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = controller.signal.aborted;
      throw new ProviderCallError(
        aborted ? "timeout" : "network",
        aborted ? `timeout tras ${this.requestTimeoutMs}ms` : errMsg(error),
        undefined,
        unmeasured(aborted ? "TIMEOUT" : "NETWORK_ERROR", aborted ? "timeout" : errMsg(error)),
      );
    } finally {
      clearTimeout(timer);
    }

    const rawBody = await response.text().catch(() => "");
    const body = parseBody(rawBody);
    const usage = extractUsage(body);
    const gatewayLogId = response.headers.get("cf-aig-log-id");

    if (!response.ok) {
      const kind: ProviderFailureKind = response.status >= 500 ? "http_5xx" : "http_4xx";
      // Algunos errores devuelven usage: si lo hacen, se cuesta igualmente.
      const attempt: ProviderAttempt = {
        ...base,
        outcome: "HTTP_ERROR",
        usage,
        provider_cost_usd: usage
          ? providerCostUsd(rateFor(candidate.provider, candidate.model), usage)
          : null,
        gateway_log_id: gatewayLogId,
        http_status: response.status,
        latency_ms: Date.now() - startedMs,
        error_message: `HTTP ${response.status}`,
      };
      throw new ProviderCallError(kind, `HTTP ${response.status}`, response.status, attempt);
    }

    const finishReason = body?.choices?.[0]?.finish_reason ?? null;
    const text = body?.choices?.[0]?.message?.content;
    const hasText = typeof text === "string" && text.length > 0;
    const outcome: ProviderAttempt["outcome"] = hasText
      ? "SUCCESS"
      : finishReason === "length"
        ? "OUTPUT_BUDGET_EXHAUSTED"
        : "EMPTY";

    const attempt: ProviderAttempt = {
      ...base,
      outcome,
      finish_reason: finishReason,
      usage,
      // El costo se calcula SIEMPRE que haya usage, sirva o no la respuesta.
      provider_cost_usd: usage
        ? providerCostUsd(rateFor(candidate.provider, candidate.model), usage)
        : null,
      gateway_log_id: gatewayLogId,
      http_status: response.status,
      latency_ms: Date.now() - startedMs,
    };

    return { attempt, text: hasText ? text : null };
  }
}

/** Cuerpo JSON del endpoint compatible. Un cuerpo ilegible no rompe la contabilidad. */
function parseBody(raw: string): ProviderResponseBody | null {
  try {
    return JSON.parse(raw) as ProviderResponseBody;
  } catch {
    return null;
  }
}

interface ProviderResponseBody {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

/**
 * Normaliza el usage del proveedor.
 *
 * Los tokens de razonamiento YA están contenidos en `completion_tokens` y se facturan
 * como salida (documentación oficial de OpenAI, consultada el 2026-09-01). Se capturan
 * aparte SÓLO para observabilidad: sumarlos al total sería cobrarlos dos veces.
 *
 * Devuelve `null` cuando el proveedor no informó consumo: eso es costo DESCONOCIDO,
 * que no es lo mismo que costo cero.
 */
export function extractUsage(body: ProviderResponseBody | null): ProviderUsage | null {
  const usage = body?.usage;
  if (!usage || (usage.prompt_tokens === undefined && usage.completion_tokens === undefined)) {
    return null;
  }
  const reasoning = usage.completion_tokens_details?.reasoning_tokens;
  return {
    input_tokens: usage.prompt_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? 0,
    cached_input_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    ...(reasoning === undefined ? {} : { reasoning_tokens: reasoning }),
  };
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : "error desconocido";
}

/**
 * Familia de razonamiento de OpenAI (gpt-5 y o1/o3/o4/oN). Estos modelos imponen
 * dos restricciones de contrato distintas al resto, verificadas live contra el
 * endpoint `/compat` del AI Gateway (2026-08), que reenvía los parámetros tal cual
 * sin traducirlos:
 *   1) rechazan `max_tokens` (400 `unsupported_parameter`) y exigen `max_completion_tokens`;
 *   2) rechazan `temperature` != default (400 `unsupported_value`): sólo admiten 1.
 */
export function isOpenAiReasoningModel(provider: string, model: string): boolean {
  if (provider !== "openai") return false;
  return /^(gpt-5|o[1-9])/.test(model);
}

/** Alias explícito para la restricción (1). Se conserva por claridad en los tests. */
export function requiresMaxCompletionTokens(provider: string, model: string): boolean {
  return isOpenAiReasoningModel(provider, model);
}

/**
 * Devuelve EXACTAMENTE una clave de límite de salida según la familia del modelo.
 * Por construcción nunca emite `max_tokens` y `max_completion_tokens` a la vez.
 */
export function outputTokenParam(
  provider: string,
  model: string,
  maxOutputTokens: number,
): { max_tokens: number } | { max_completion_tokens: number } {
  return requiresMaxCompletionTokens(provider, model)
    ? { max_completion_tokens: maxOutputTokens }
    : { max_tokens: maxOutputTokens };
}

/**
 * Compone el subconjunto de parámetros del cuerpo que depende de la familia del
 * modelo: límite de salida (siempre) y `temperature` (sólo cuando el modelo admite
 * un valor personalizado). Para la familia de razonamiento de OpenAI se OMITE
 * `temperature` para usar el default (1), en vez de enviar un valor que sería
 * rechazado. Punto único de compatibilidad: no se dispersan condiciones por el código.
 */
export function modelRequestParams(
  provider: string,
  model: string,
  policy: { temperature: number; max_output_tokens: number },
): Record<string, number> {
  const params: Record<string, number> = {
    ...outputTokenParam(provider, model, policy.max_output_tokens),
  };
  if (!isOpenAiReasoningModel(provider, model)) {
    params.temperature = policy.temperature;
  }
  return params;
}

/**
 * Tarifas de costo upstream por millón de tokens.
 * Son COSTO de proveedor, no precio de venta. Revisar contra facturación real
 * antes de fijar la fórmula comercial de créditos (Blueprint §12).
 */
/**
 * Tarifas OFICIALES de proveedor, USD por millón de tokens.
 *
 * Fuente: documentación oficial consultada el 2026-09-01 —
 * developers.openai.com/api/docs/pricing y ai.google.dev/gemini-api/docs/pricing.
 *
 * `cached_input` no es un adorno: la entrada cacheada cuesta una décima parte y los
 * prompts canónicos de IUSIA son inmutables, así que es exactamente el caso que el
 * proveedor premia. Ignorarla —como se hacía— sobrestimaba el costo de cada llamada.
 */
export interface ModelRateEntry {
  provider: string;
  model: string;
  input_usd_per_mtok: number;
  cached_input_usd_per_mtok: number;
  output_usd_per_mtok: number;
  /** Fecha de la consulta a la documentación oficial. */
  source_date: string;
}

export const MODEL_RATES: Record<string, ModelRateEntry> = {
  "openai/gpt-5": {
    provider: "openai", model: "gpt-5",
    input_usd_per_mtok: 1.25, cached_input_usd_per_mtok: 0.125, output_usd_per_mtok: 10,
    source_date: "2026-09-01",
  },
  "openai/gpt-5-mini": {
    provider: "openai", model: "gpt-5-mini",
    input_usd_per_mtok: 0.25, cached_input_usd_per_mtok: 0.025, output_usd_per_mtok: 2,
    source_date: "2026-09-01",
  },
  "openai/gpt-5-nano": {
    provider: "openai", model: "gpt-5-nano",
    input_usd_per_mtok: 0.05, cached_input_usd_per_mtok: 0.005, output_usd_per_mtok: 0.4,
    source_date: "2026-09-01",
  },
  "google/gemini-2.5-pro": {
    provider: "google", model: "gemini-2.5-pro",
    input_usd_per_mtok: 1.25, cached_input_usd_per_mtok: 0.125, output_usd_per_mtok: 10,
    source_date: "2026-09-01",
  },
  "google/gemini-2.5-flash": {
    provider: "google", model: "gemini-2.5-flash",
    input_usd_per_mtok: 0.3, cached_input_usd_per_mtok: 0.03, output_usd_per_mtok: 2.5,
    source_date: "2026-09-01",
  },
};

/**
 * Tarifa de un modelo. FALLA CERRADA ante un modelo desconocido.
 *
 * Antes devolvía ceros, de modo que un modelo sin tarifa registrada parecía GRATIS:
 * el presupuesto no lo frenaba nunca y el ledger contabilizaba 0. Con routing
 * dinámico eso es una puerta abierta a gastar sin límite y sin registro. Un modelo
 * que IUSIA no sabe costear no debe ejecutarse.
 */
export function rateFor(provider: string, model: string): ModelRateEntry {
  const rate = MODEL_RATES[`${provider}/${model}`];
  if (!rate) {
    throw new IusiaError(
      "UNKNOWN_MODEL_RATE",
      `No hay tarifa registrada para "${provider}/${model}": IUSIA no ejecuta un modelo cuyo costo no sabe calcular.`,
      { provider, model, known: Object.keys(MODEL_RATES) },
    );
  }
  return rate;
}

/** ¿Está este modelo habilitado para ejecutarse, es decir, sabemos costearlo? */
export function hasKnownRate(provider: string, model: string): boolean {
  return Boolean(MODEL_RATES[`${provider}/${model}`]);
}
