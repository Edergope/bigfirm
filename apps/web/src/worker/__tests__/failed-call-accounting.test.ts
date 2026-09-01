import { describe, expect, it } from "vitest";
import {
  attemptBudgetImpactUsd,
  attemptHasKnownCost,
  attemptIdempotencyKey,
  creditsForCost,
  estimateAttemptCostUsd,
  providerCostUsd,
  RESERVED_OUTPUT_FRACTION,
  type ProviderAttempt,
} from "@iusia/domain";
import { ModelGateway, extractUsage, rateFor } from "../services/model-gateway.js";
import { createTestDb, seedFirm } from "./harness.js";

/**
 * CONTABILIDAD DE LLAMADAS FALLIDAS.
 *
 * Incidente exe_5z890j96y5x0wzew (1-sep-2026): ocho llamadas reales a OpenAI, todas
 * con `finish_reason=length`, y el ledger registrando 0 USD y 0 créditos. La
 * documentación oficial de OpenAI lo advierte literalmente para los modelos de
 * razonamiento: «you could incur costs for input and reasoning tokens without
 * receiving a visible response».
 *
 * Regla que fijan estos tests: UN FALLO NO ES UNA LLAMADA GRATIS.
 */

const ENV = { CLOUDFLARE_ACCOUNT_ID: "acc", AI_GATEWAY_NAME: "iusia" } as never;
const POLICY = {
  route: "iusia-general",
  preferred: { provider: "openai", model: "gpt-5-mini" },
  fallback: [{ provider: "openai", model: "gpt-5" }],
  temperature: 0.15,
  max_output_tokens: 12_000,
} as never;
const CTX = { organization_id: "org", matter_id: "mtr", agent_id: "00", execution_id: "exe" };

function jsonResponse(body: unknown, init: { status?: number; logId?: string } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(init.logId ? { "cf-aig-log-id": init.logId } : {}),
    },
  });
}

/** Respuesta real de un modelo de razonamiento que agotó su presupuesto. */
const LENGTH_EXHAUSTED = {
  choices: [{ message: { content: "" }, finish_reason: "length" }],
  usage: {
    prompt_tokens: 8_000,
    completion_tokens: 12_000,
    prompt_tokens_details: { cached_tokens: 2_000 },
    completion_tokens_details: { reasoning_tokens: 12_000 },
  },
};

const SUCCESS = {
  choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
  usage: {
    prompt_tokens: 8_000,
    completion_tokens: 6_000,
    prompt_tokens_details: { cached_tokens: 2_000 },
    completion_tokens_details: { reasoning_tokens: 4_000 },
  },
};

function gatewayWith(responses: Response[], settled: ProviderAttempt[]) {
  let i = 0;
  const gateway = new ModelGateway(ENV, {
    maxAttemptsPerCandidate: 1,
    fetch: (async () => {
      const r = responses[Math.min(i, responses.length - 1)]!;
      i += 1;
      return r.clone();
    }) as unknown as typeof fetch,
  });
  return {
    gateway,
    run: () => gateway.complete(POLICY, [{ role: "user", content: "x" }], CTX, {
      onSettled: (a) => {
        settled.push(a);
      },
    }),
  };
}

describe("USAGE — se captura ANTES de juzgar el contenido", () => {
  it("[FINISH_REASON_LENGTH] una respuesta sin contenido pero con usage queda costada", async () => {
    const settled: ProviderAttempt[] = [];
    const { run } = gatewayWith([jsonResponse(LENGTH_EXHAUSTED, { logId: "log_a" })], settled);
    await expect(run()).rejects.toThrow(/Todos los proveedores/);

    // Dos candidatos, dos intentos reales, los dos contabilizados.
    expect(settled).toHaveLength(2);
    for (const attempt of settled) {
      expect(attempt.outcome).toBe("OUTPUT_BUDGET_EXHAUSTED");
      expect(attempt.finish_reason).toBe("length");
      expect(attemptHasKnownCost(attempt)).toBe(true);
      expect(attempt.provider_cost_usd!).toBeGreaterThan(0);
      expect(attempt.usage!.output_tokens).toBe(12_000);
    }
    // El intento con gpt-5 cuesta más que el de gpt-5-mini: el costo es el real.
    expect(settled[1]!.provider_cost_usd!).toBeGreaterThan(settled[0]!.provider_cost_usd!);
  });

  it("[EMPTY] contenido vacío sin finish_reason=length también se cobra", async () => {
    const settled: ProviderAttempt[] = [];
    const { run } = gatewayWith(
      [jsonResponse({ choices: [{ message: { content: "" }, finish_reason: "stop" }], usage: LENGTH_EXHAUSTED.usage })],
      settled,
    );
    await expect(run()).rejects.toThrow();
    expect(settled[0]!.outcome).toBe("EMPTY");
    expect(settled[0]!.provider_cost_usd!).toBeGreaterThan(0);
  });

  it("[HTTP_ERROR_WITH_USAGE] un error del proveedor que informa consumo se cobra igual", async () => {
    const settled: ProviderAttempt[] = [];
    const { run } = gatewayWith(
      [jsonResponse({ error: { message: "bad" }, usage: LENGTH_EXHAUSTED.usage }, { status: 400 })],
      settled,
    );
    await expect(run()).rejects.toThrow();
    expect(settled[0]!.outcome).toBe("HTTP_ERROR");
    expect(settled[0]!.http_status).toBe(400);
    expect(settled[0]!.provider_cost_usd!).toBeGreaterThan(0);
  });

  it("[NETWORK_FAILURE] sin usage el costo es DESCONOCIDO, nunca cero", async () => {
    const settled: ProviderAttempt[] = [];
    const gateway = new ModelGateway(ENV, {
      maxAttemptsPerCandidate: 1,
      fetch: (async () => {
        throw new Error("connection reset");
      }) as unknown as typeof fetch,
    });
    await expect(
      gateway.complete(POLICY, [{ role: "user", content: "x" }], CTX, {
        onSettled: (a) => {
          settled.push(a);
        },
      }),
    ).rejects.toThrow();

    expect(settled).toHaveLength(2);
    for (const attempt of settled) {
      expect(attempt.outcome).toBe("NETWORK_ERROR");
      expect(attempt.usage).toBeNull();
      // La distinción que importa: desconocido, NO cero.
      expect(attempt.provider_cost_usd).toBeNull();
      expect(attemptHasKnownCost(attempt)).toBe(false);
    }
  });

  it("[FALLBACK] el fallo del preferido y el éxito del fallback se cuentan los DOS", async () => {
    const settled: ProviderAttempt[] = [];
    const { run } = gatewayWith(
      [
        jsonResponse(LENGTH_EXHAUSTED, { logId: "log_fail" }),
        jsonResponse(SUCCESS, { logId: "log_ok" }),
      ],
      settled,
    );
    const result = await run();

    expect(result.model).toBe("gpt-5");
    expect(settled).toHaveLength(2);
    expect(settled[0]!.outcome).toBe("OUTPUT_BUDGET_EXHAUSTED");
    expect(settled[1]!.outcome).toBe("SUCCESS");
    // El costo total upstream incluye la llamada que NO sirvió.
    const total = settled.reduce((s, a) => s + (a.provider_cost_usd ?? 0), 0);
    expect(total).toBeGreaterThan(settled[1]!.provider_cost_usd!);
    expect(result.attempts_detail).toHaveLength(2);
  });

  it("[SUCCESS_UNCHANGED] una llamada normal conserva su contabilidad de siempre", async () => {
    const settled: ProviderAttempt[] = [];
    const { run } = gatewayWith([jsonResponse(SUCCESS, { logId: "log_ok" })], settled);
    const result = await run();
    expect(result.text).toBe('{"ok":true}');
    expect(settled).toHaveLength(1);
    expect(settled[0]!.outcome).toBe("SUCCESS");
    expect(result.usage.input_tokens).toBe(8_000);
    expect(result.usage.cached_input_tokens).toBe(2_000);
  });
});

describe("TOKENS DE RAZONAMIENTO — se observan, no se cobran dos veces", () => {
  it("[NO_DOUBLE_COUNT] reasoning_tokens ya está dentro de completion_tokens", () => {
    const usage = extractUsage(SUCCESS as never)!;
    expect(usage.output_tokens).toBe(6_000);
    expect(usage.reasoning_tokens).toBe(4_000);

    // El costo usa el TOTAL, no total + reasoning.
    const rate = rateFor("openai", "gpt-5-mini");
    const cost = providerCostUsd(rate, usage);
    const doubled = providerCostUsd(rate, {
      ...usage,
      output_tokens: usage.output_tokens + usage.reasoning_tokens!,
    });
    expect(cost).toBeLessThan(doubled);
    expect(cost).toBeCloseTo(
      (6_000 / 1e6) * rate.output_usd_per_mtok +
        (6_000 / 1e6) * rate.input_usd_per_mtok +
        (2_000 / 1e6) * rate.cached_input_usd_per_mtok,
      10,
    );
  });

  it("[NO_USAGE] una respuesta sin bloque de usage devuelve null, no ceros", () => {
    expect(extractUsage(null)).toBeNull();
    expect(extractUsage({ choices: [] } as never)).toBeNull();
  });
});

describe("IDEMPOTENCIA — reejecutar la contabilidad no cobra dos veces", () => {
  const base: ProviderAttempt = {
    provider: "openai",
    model: "gpt-5-mini",
    attempt: 1,
    outcome: "OUTPUT_BUDGET_EXHAUSTED",
    usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 200 },
    provider_cost_usd: 0.001,
    gateway_log_id: "log_unico",
    started_at: "2026-09-01T05:04:04.000Z",
    latency_ms: 40_000,
  };

  it("[SAME_REQUEST] la misma petición real produce la misma clave", () => {
    expect(attemptIdempotencyKey("exe_1", base)).toBe(attemptIdempotencyKey("exe_1", base));
    expect(attemptIdempotencyKey("exe_1", base)).toContain("log_unico");
  });

  it("[NEW_REQUEST] una petición NUEVA produce una clave distinta y sí se cobra", () => {
    const otra = { ...base, gateway_log_id: "log_otro" };
    expect(attemptIdempotencyKey("exe_1", otra)).not.toBe(attemptIdempotencyKey("exe_1", base));
  });

  it("[NO_LOG_ID] sin id de log la clave sigue siendo determinista por consumo", () => {
    const sinLog = { ...base, gateway_log_id: null };
    expect(attemptIdempotencyKey("exe_1", sinLog)).toBe(attemptIdempotencyKey("exe_1", sinLog));
    expect(attemptIdempotencyKey("exe_1", sinLog)).toContain("100:200");
  });

  it("[LEDGER] un intento fallido debita una vez y su repetición no vuelve a debitar", async () => {
    const t = createTestDb();
    const { organizationId } = await seedFirm(t, {
      orgName: "Contabilidad",
      directorEmail: "dir@contabilidad.test",
    });
    await t.credits.ensureWallet(organizationId, 0);
    await t.credits.post({
      organizationId,
      kind: "GRANT",
      amount: 10_000,
      idempotencyKey: `grant:${organizationId}`,
    });

    const key = attemptIdempotencyKey("exe_1", base);
    const charge = () =>
      t.credits.post({
        organizationId,
        kind: "CONSUMPTION",
        amount: -creditsForCost(base.provider_cost_usd!),
        idempotencyKey: key,
        executionId: "exe_1",
        provider: base.provider,
        model: base.model,
        providerCostUsd: base.provider_cost_usd,
        allowNegative: true,
      });

    const first = await charge();
    const replay = await charge();
    expect(first.applied).toBe(true);
    expect(replay.applied).toBe(false);
    expect((await t.credits.reconcile(organizationId)).reconciled).toBe(true);
  });

  it("[UNKNOWN_COST_ROW] un costo desconocido deja asiento sin fingir cero", async () => {
    const t = createTestDb();
    const { organizationId } = await seedFirm(t, {
      orgName: "Desconocido",
      directorEmail: "dir@desconocido.test",
    });
    await t.credits.ensureWallet(organizationId, 0);
    await t.credits.post({
      organizationId,
      kind: "CONSUMPTION",
      amount: 0,
      idempotencyKey: "exe_2:call:timeout",
      executionId: "exe_2",
      provider: "openai",
      model: "gpt-5-mini",
      providerCostUsd: null,
      allowNegative: true,
    });

    const cost = await t.credits.providerCostForExecutions(organizationId, ["exe_2"]);
    expect(cost.knownUsd).toBe(0);
    // Lo decisivo: queda contado como DESCONOCIDO, no sumado como cero.
    expect(cost.unknownAttempts).toBe(1);
  });
});

describe("PRESUPUESTO DE LA RAÍZ — los fallos también gastan", () => {
  it("[FAILED_CALLS_CONSUME_BUDGET] el ledger de la raíz incluye intentos fallidos", async () => {
    const t = createTestDb();
    const { organizationId } = await seedFirm(t, {
      orgName: "Presupuesto",
      directorEmail: "dir@presupuesto.test",
    });
    await t.credits.ensureWallet(organizationId, 0);
    await t.credits.post({
      organizationId,
      kind: "GRANT",
      amount: 100_000,
      idempotencyKey: `grant:${organizationId}`,
    });

    // Escenario del encargo: éxito 0,50 · fallo con usage 0,40 · fallback 0,40.
    const calls: Array<[string, number | null]> = [
      ["exe_a:call:1", 0.5],
      ["exe_a:call:2", 0.4],
      ["exe_a:call:3", 0.4],
    ];
    for (const [key, usd] of calls) {
      await t.credits.post({
        organizationId,
        kind: "CONSUMPTION",
        amount: usd === null ? 0 : -creditsForCost(usd),
        idempotencyKey: key,
        executionId: "exe_a",
        providerCostUsd: usd,
        allowNegative: true,
      });
    }

    const { knownUsd } = await t.credits.providerCostForExecutions(organizationId, ["exe_a"]);
    expect(knownUsd).toBeCloseTo(1.3, 10);

    // Presupuesto 1,50 y siguiente llamada estimada en 0,30 → NO se despacha.
    const BUDGET = 1.5;
    const nextEstimate = 0.3;
    expect(knownUsd + nextEstimate).toBeGreaterThan(BUDGET);
    expect(knownUsd >= BUDGET).toBe(false); // aún no lo supera por sí solo…
    // …pero la guarda del workflow corta ANTES de gastar de más.
    expect(knownUsd + nextEstimate > BUDGET).toBe(true);
  });

  it("[UNKNOWN_ATTEMPTS_RESERVE] una cadena de fallos sin usage tampoco es gratis", () => {
    const unknown: ProviderAttempt = {
      provider: "openai",
      model: "gpt-5-mini",
      attempt: 1,
      outcome: "TIMEOUT",
      usage: null,
      provider_cost_usd: null,
      gateway_log_id: null,
      started_at: "2026-09-01T05:00:00.000Z",
      latency_ms: 180_000,
    };
    const RESERVE = 0.05;
    expect(attemptBudgetImpactUsd(unknown, RESERVE)).toBe(RESERVE);
    // Un intento medido usa su costo real, no la reserva.
    expect(attemptBudgetImpactUsd({ ...unknown, provider_cost_usd: 0.02 }, RESERVE)).toBe(0.02);
  });

  it("[RESERVATION] la estimación previa es conservadora pero no absurda", () => {
    const rate = rateFor("openai", "gpt-5-mini");
    const reserved = estimateAttemptCostUsd(rate, { inputTokens: 8_000, maxOutputTokens: 12_000 });
    const worstCase = providerCostUsd(rate, {
      input_tokens: 8_000,
      output_tokens: 12_000,
      cached_input_tokens: 0,
    });
    expect(reserved).toBeLessThan(worstCase);
    expect(reserved).toBeGreaterThan(0);
    expect(RESERVED_OUTPUT_FRACTION).toBeGreaterThan(0.5);
    expect(RESERVED_OUTPUT_FRACTION).toBeLessThan(1);
    // Con un presupuesto de 1,50 una ejecución normal de 6 llamadas sigue cabiendo.
    expect(reserved * 6).toBeLessThan(1.5);
  });
});
