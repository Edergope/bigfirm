import { beforeEach, describe, expect, it, vi } from "vitest";
import { isIusiaError } from "@iusia/domain";
import type { ModelPolicy } from "@iusia/agents";
import {
  ModelGateway,
  isOpenAiReasoningModel,
  modelRequestParams,
  outputTokenParam,
  requiresMaxCompletionTokens,
  type ModelGatewayDeps,
} from "../services/model-gateway.js";
import type { Env } from "../env.js";

/**
 * Endurecimiento de la capa de modelos: retry con backoff sólo en transitorios,
 * timeout de cliente, fallback entre candidatos, errores normalizados y señal
 * explícita de "no configurado". Todo probado sin red ni esperas reales.
 */

const POLICY: ModelPolicy = {
  route: "test",
  preferred: { provider: "openai", model: "gpt-5" },
  fallback: [{ provider: "google", model: "gemini-2.5-pro" }],
  temperature: 0.2,
  max_output_tokens: 100,
};

const CTX = {
  organization_id: "org_1",
  matter_id: "mtr_1",
  agent_id: "01-intake-y-clasificador",
  execution_id: "exe_1",
};

const MESSAGES = [{ role: "user" as const, content: "hola" }];

function env(overrides: Partial<Env> = {}): Env {
  return {
    CLOUDFLARE_ACCOUNT_ID: "acct_test",
    AI_GATEWAY_NAME: "iusia",
    AI_GATEWAY_TOKEN: "tok_test",
    ...overrides,
  } as unknown as Env;
}

function okResponse(text: string, tokens = { p: 10, c: 5 }): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: tokens.p, completion_tokens: tokens.c },
    }),
    { status: 200, headers: { "cf-aig-log-id": "log_123" } },
  );
}

function statusResponse(status: number): Response {
  return new Response("err", { status });
}

/** sleep falso: no espera, sólo cuenta llamadas. */
function fakeDeps(fetchImpl: typeof fetch): ModelGatewayDeps & { slept: number[] } {
  const slept: number[] = [];
  return {
    fetch: fetchImpl,
    sleep: async (ms: number) => {
      slept.push(ms);
    },
    slept,
    maxAttemptsPerCandidate: 3,
    backoffBaseMs: 10,
    requestTimeoutMs: 1000,
  };
}

describe("ModelGateway hardening", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("señala PROVIDER_NOT_CONFIGURED cuando falta el account id", async () => {
    const gw = new ModelGateway(env({ CLOUDFLARE_ACCOUNT_ID: "" }), { fetch: vi.fn() });
    await expect(gw.complete(POLICY, MESSAGES, CTX)).rejects.toSatisfy(
      (e: unknown) => isIusiaError(e) && e.code === "PROVIDER_NOT_CONFIGURED",
    );
    expect(gw.isConfigured()).toBe(false);
  });

  it("devuelve el texto y attempts=1 al primer intento exitoso", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse("respuesta"));
    const gw = new ModelGateway(env(), fakeDeps(fetchImpl as unknown as typeof fetch));
    const r = await gw.complete(POLICY, MESSAGES, CTX);
    expect(r.text).toBe("respuesta");
    expect(r.attempts).toBe(1);
    expect(r.provider).toBe("openai");
    expect(r.usage.input_tokens).toBe(10);
    expect(r.gateway_log_id).toBe("log_123");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reintenta el mismo candidato ante 5xx y luego tiene éxito (con backoff)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(statusResponse(503))
      .mockResolvedValueOnce(okResponse("ok"));
    const deps = fakeDeps(fetchImpl as unknown as typeof fetch);
    const gw = new ModelGateway(env(), deps);
    const r = await gw.complete(POLICY, MESSAGES, CTX);
    expect(r.text).toBe("ok");
    expect(r.attempts).toBe(2);
    expect(deps.slept.length).toBe(1); // hubo un backoff entre intentos
  });

  it("NO reintenta ante 4xx: pasa directo al fallback", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(statusResponse(400)) // preferred: no retryable
      .mockResolvedValueOnce(okResponse("desde fallback"));
    const deps = fakeDeps(fetchImpl as unknown as typeof fetch);
    const gw = new ModelGateway(env(), deps);
    const r = await gw.complete(POLICY, MESSAGES, CTX);
    expect(r.text).toBe("desde fallback");
    expect(r.provider).toBe("google");
    // 1 intento fallido (preferred) + 1 exitoso (fallback), sin backoff (no retryable)
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(deps.slept.length).toBe(0);
  });

  it("agota reintentos del preferido y conmuta al fallback", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(statusResponse(500))
      .mockResolvedValueOnce(statusResponse(500))
      .mockResolvedValueOnce(statusResponse(500)) // preferred agota sus 3 intentos
      .mockResolvedValueOnce(okResponse("fallback ok"));
    const gw = new ModelGateway(env(), fakeDeps(fetchImpl as unknown as typeof fetch));
    const r = await gw.complete(POLICY, MESSAGES, CTX);
    expect(r.text).toBe("fallback ok");
    expect(r.provider).toBe("google");
  });

  it("clasifica como PROVIDER_TIMEOUT cuando todo es timeout", async () => {
    const fetchImpl = vi.fn().mockImplementation((_url, init: RequestInit) => {
      // Simula abort del cliente: marca el signal como abortado y rechaza,
      // igual que haría fetch cuando el AbortController dispara el timeout.
      const signal = init.signal as AbortSignal;
      Object.defineProperty(signal, "aborted", { value: true, configurable: true });
      return Promise.reject(new Error("aborted"));
    });
    const gw = new ModelGateway(env(), fakeDeps(fetchImpl as unknown as typeof fetch));
    await expect(gw.complete(POLICY, MESSAGES, CTX)).rejects.toSatisfy(
      (e: unknown) => isIusiaError(e) && e.code === "PROVIDER_TIMEOUT",
    );
  });

  it("una respuesta vacía no se reintenta y termina en PROVIDER_ERROR si nadie responde", async () => {
    const empty = () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 });
    const fetchImpl = vi.fn().mockImplementation(async () => empty());
    const deps = fakeDeps(fetchImpl as unknown as typeof fetch);
    const gw = new ModelGateway(env(), deps);
    await expect(gw.complete(POLICY, MESSAGES, CTX)).rejects.toSatisfy(
      (e: unknown) => isIusiaError(e) && e.code === "PROVIDER_ERROR",
    );
    // empty no es retryable: 1 intento por candidato = 2 llamadas, sin backoff
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(deps.slept.length).toBe(0);
  });
});

/** Extrae y parsea el body JSON del enésimo fetch capturado. */
function bodyOfCall(
  fetchImpl: ReturnType<typeof vi.fn>,
  index: number,
): Record<string, unknown> {
  const call = fetchImpl.mock.calls[index];
  if (!call) throw new Error(`no hubo llamada fetch en índice ${index}`);
  return JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
}

describe("compatibilidad del parámetro de límite de salida (CODE_GAP MODEL_PARAMETER_COMPATIBILITY)", () => {
  // Familia de razonamiento de OpenAI → max_completion_tokens.
  it.each([
    ["openai", "gpt-5"],
    ["openai", "gpt-5-mini"],
    ["openai", "gpt-5-nano"],
    ["openai", "o1"],
    ["openai", "o3-mini"],
    ["openai", "o4-mini"],
  ])("%s/%s exige max_completion_tokens", (provider, model) => {
    expect(requiresMaxCompletionTokens(provider, model)).toBe(true);
    expect(outputTokenParam(provider, model, 16000)).toEqual({ max_completion_tokens: 16000 });
  });

  // Contrato tradicional → max_tokens.
  it.each([
    ["openai", "gpt-4.1"],
    ["openai", "gpt-4o"],
    ["google", "gemini-2.5-pro"],
    ["anthropic", "claude-sonnet-4"],
  ])("%s/%s conserva max_tokens", (provider, model) => {
    expect(requiresMaxCompletionTokens(provider, model)).toBe(false);
    expect(outputTokenParam(provider, model, 16000)).toEqual({ max_tokens: 16000 });
  });

  it("usa el fetch global con binding correcto cuando no se inyecta (no Illegal invocation)", async () => {
    // Regresión del CODE_GAP WORKERS_FETCH_THIS_BINDING. Reproduce la guardia de
    // workerd: el fetch nativo lanza "Illegal invocation" si se invoca con un `this`
    // que no es el objeto global. Si el gateway guardara el fetch como propiedad y lo
    // llamara como `this.fetchImpl(...)`, `this` sería la instancia → lanzaría. El
    // wrapper por defecto invoca `fetch(...)` a secas y preserva el binding global.
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = function (this: unknown): Promise<Response> {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(okResponse("ok"));
    } as unknown as typeof fetch;
    try {
      // Sin deps.fetch → usa el wrapper por defecto sobre el fetch global.
      const gw = new ModelGateway(env(), { maxAttemptsPerCandidate: 1, backoffBaseMs: 1 });
      const r = await gw.complete(POLICY, MESSAGES, CTX);
      expect(r.text).toBe("ok");
    } finally {
      globalThis.fetch = nativeFetch;
    }
  });

  it("nunca emite max_tokens y max_completion_tokens a la vez", () => {
    const cases: Array<[string, string]> = [
      ["openai", "gpt-5"],
      ["openai", "o3"],
      ["openai", "gpt-4.1"],
      ["google", "gemini-2.5-pro"],
    ];
    for (const [p, m] of cases) {
      const param = outputTokenParam(p, m, 100) as Record<string, number>;
      expect(Object.keys(param)).toHaveLength(1);
      const hasBoth = "max_tokens" in param && "max_completion_tokens" in param;
      expect(hasBoth).toBe(false);
    }
  });

  // Restricción (2): la familia de razonamiento sólo admite temperature=default(1).
  it.each([
    ["openai", "gpt-5", true],
    ["openai", "o3-mini", true],
    ["openai", "gpt-4.1", false],
    ["google", "gemini-2.5-pro", false],
  ])("isOpenAiReasoningModel(%s/%s) = %s", (provider, model, expected) => {
    expect(isOpenAiReasoningModel(provider, model)).toBe(expected);
  });

  it("modelRequestParams OMITE temperature para openai/gpt-5 (default 1)", () => {
    const p = modelRequestParams("openai", "gpt-5", { temperature: 0.2, max_output_tokens: 16000 });
    expect(p).toEqual({ max_completion_tokens: 16000 });
    expect("temperature" in p).toBe(false);
  });

  it("modelRequestParams conserva temperature para modelos tradicionales", () => {
    expect(
      modelRequestParams("google", "gemini-2.5-pro", { temperature: 0.2, max_output_tokens: 16000 }),
    ).toEqual({ max_tokens: 16000, temperature: 0.2 });
    expect(
      modelRequestParams("openai", "gpt-4.1", { temperature: 0.7, max_output_tokens: 8000 }),
    ).toEqual({ max_tokens: 8000, temperature: 0.7 });
  });

  it("callOnce: gpt-5 → max_completion_tokens y SIN temperature; nunca max_tokens", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse("ok"));
    const gw = new ModelGateway(env(), fakeDeps(fetchImpl as unknown as typeof fetch));
    await gw.complete(POLICY, MESSAGES, CTX); // POLICY.preferred = openai/gpt-5
    const body = bodyOfCall(fetchImpl, 0);
    expect(body.model).toBe("openai/gpt-5");
    expect(body.max_completion_tokens).toBe(POLICY.max_output_tokens);
    expect("max_tokens" in body).toBe(false);
    expect("temperature" in body).toBe(false);
  });

  it("callOnce: fallback gemini → max_tokens + temperature; nunca max_completion_tokens", async () => {
    // preferred (openai/gpt-5) devuelve 400 no-reintentable → conmuta al fallback gemini.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(statusResponse(400))
      .mockResolvedValueOnce(okResponse("ok"));
    const gw = new ModelGateway(env(), fakeDeps(fetchImpl as unknown as typeof fetch));
    await gw.complete(POLICY, MESSAGES, CTX);
    const body = bodyOfCall(fetchImpl, 1);
    expect(body.model).toBe("google/gemini-2.5-pro");
    expect(body.max_tokens).toBe(POLICY.max_output_tokens);
    expect(body.temperature).toBe(POLICY.temperature);
    expect("max_completion_tokens" in body).toBe(false);
  });
});
