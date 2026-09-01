import { describe, expect, it } from "vitest";
import {
  applyRouting,
  creditsForCost,
  providerCostUsd,
  routeModel,
  TASK_CLASSES,
  documentIntelligenceState,
  shouldPollIngestion,
  canRetryIngestion,
  DOCUMENT_INTELLIGENCE_TERMS,
} from "@iusia/domain";
import { MODEL_RATES, hasKnownRate, rateFor } from "../services/model-gateway.js";

/**
 * COSTO DE MODELO — el dinero real, no los créditos comerciales.
 *
 * Medición de partida en staging: 79 llamadas, TODAS a `gpt-5` con
 * `max_output_tokens: 16000`. 377.599 tokens de salida = 82 % de los 4,62 USD
 * contabilizados. El problema no era elegir mal el modelo: era pagar salida de modelo
 * premium para todo, incluida la selección de un equipo.
 */

describe("TARIFAS — ningún modelo puede costar cero por desconocimiento", () => {
  it("[FAIL_CLOSED] un modelo sin tarifa registrada no se ejecuta", () => {
    expect(() => rateFor("openai", "modelo-inventado")).toThrow(/tarifa registrada/i);
    expect(() => rateFor("acme", "gpt-5")).toThrow(/tarifa registrada/i);
    // El error identifica el modelo y no finge un precio.
    try {
      rateFor("openai", "modelo-inventado");
    } catch (error) {
      expect((error as { code: string }).code).toBe("UNKNOWN_MODEL_RATE");
    }
  });

  it("[NO_FREE_MODEL] ninguna tarifa registrada tiene precio cero", () => {
    for (const [key, rate] of Object.entries(MODEL_RATES)) {
      expect(rate.input_usd_per_mtok, key).toBeGreaterThan(0);
      expect(rate.output_usd_per_mtok, key).toBeGreaterThan(0);
      expect(rate.cached_input_usd_per_mtok, key).toBeGreaterThan(0);
      // La entrada cacheada nunca puede ser MÁS cara que la fresca.
      expect(rate.cached_input_usd_per_mtok, key).toBeLessThanOrEqual(rate.input_usd_per_mtok);
      expect(rate.source_date, key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("[ROUTED_MODELS_HAVE_RATES] todo modelo que el routing puede elegir sabe costearse", () => {
    for (const taskClass of TASK_CLASSES) {
      for (const materiality of ["SIMPLE", "MATERIAL", "HIGH_STAKES"]) {
        const decision = routeModel({ taskClass, materiality });
        for (const candidate of [decision.preferred, ...decision.fallback]) {
          expect(
            hasKnownRate(candidate.provider, candidate.model),
            `${taskClass}/${materiality} → ${candidate.provider}/${candidate.model}`,
          ).toBe(true);
        }
      }
    }
  });

  it("[CACHED_INPUT] la entrada cacheada se cobra a su tarifa, no a la plena", () => {
    const rate = rateFor("openai", "gpt-5");
    // 100k de entrada de los cuales 80k cacheados, 10k de salida.
    const cost = providerCostUsd(rate, {
      input_tokens: 100_000,
      cached_input_tokens: 80_000,
      output_tokens: 10_000,
    });
    // 20k frescos × 1,25 + 80k cacheados × 0,125 + 10k salida × 10, por millón.
    const expected = (20_000 / 1e6) * 1.25 + (80_000 / 1e6) * 0.125 + (10_000 / 1e6) * 10;
    expect(cost).toBeCloseTo(expected, 10);

    // Y es estrictamente más barato que ignorar el caché, que era el cálculo anterior.
    const naive = (100_000 / 1e6) * 1.25 + (10_000 / 1e6) * 10;
    expect(cost).toBeLessThan(naive);
  });

  it("[CACHED_NEVER_EXCEEDS_INPUT] un caché mayor que la entrada no produce costo negativo", () => {
    const rate = rateFor("openai", "gpt-5");
    const cost = providerCostUsd(rate, {
      input_tokens: 1_000,
      cached_input_tokens: 99_999,
      output_tokens: 0,
    });
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan((1_000 / 1e6) * 1.25);
  });

  it("[CREDITS_SEPARATE] los créditos derivan del costo, y un costo mínimo nunca sale gratis", () => {
    expect(creditsForCost(0)).toBeGreaterThanOrEqual(1);
    expect(creditsForCost(0.001)).toBeGreaterThanOrEqual(1);
    expect(creditsForCost(1)).toBe(1000);
  });
});

describe("ROUTING — el modelo más barato que supera el listón de cada trabajo", () => {
  it("[EXTRACTION] la extracción estructurada usa el modelo económico", () => {
    const d = routeModel({ taskClass: "EXTRACTION" });
    expect(d.preferred).toEqual({ provider: "openai", model: "gpt-5-nano" });
    expect(d.max_output_tokens).toBeLessThanOrEqual(2_000);
    expect(d.temperature).toBe(0);
  });

  it("[PLAN] planificar es seleccionar y validar, no redactar un tratado", () => {
    const d = routeModel({ taskClass: "PLAN", materiality: "MATERIAL" });
    expect(d.preferred.model).toBe("gpt-5-mini");
    // El techo de salida baja de 16.000 a 4.000: ahí vivía el 82 % del costo.
    expect(d.max_output_tokens).toBe(4_000);
    expect(d.fallback[0]!.model).toBe("gpt-5");
  });

  it("[ESCALATION_BY_MATERIALITY] un asunto de alta criticidad sube de modelo", () => {
    const standard = routeModel({ taskClass: "SPECIALIST", materiality: "MATERIAL" });
    const escalated = routeModel({ taskClass: "SPECIALIST", materiality: "HIGH_STAKES" });
    expect(standard.preferred.model).toBe("gpt-5-mini");
    expect(escalated.preferred.model).toBe("gpt-5");
    expect(escalated.max_output_tokens).toBeGreaterThan(standard.max_output_tokens);
    expect(escalated.reason).toMatch(/materialidad/);
  });

  it("[ESCALATION_BY_VALIDATION] un fallo de salida estructurada escala; la 'confianza' del modelo no", () => {
    const escalated = routeModel({ taskClass: "PLAN", structuredOutputFailed: true });
    expect(escalated.preferred.model).toBe("gpt-5");
    // El disparador es un hecho verificable del servidor, no una opinión del modelo.
    expect(escalated.reason).not.toMatch(/confian|confidence/i);
  });

  it("[INTEGRATION] la conclusión final conserva el modelo superior, y ocurre una vez", () => {
    for (const materiality of ["SIMPLE", "MATERIAL", "HIGH_STAKES"]) {
      expect(routeModel({ taskClass: "INTEGRATION", materiality }).preferred.model).toBe("gpt-5");
    }
  });

  it("[NO_CHEAPEST_EVERYWHERE] la política no colapsa a un solo modelo barato", () => {
    const models = new Set(
      TASK_CLASSES.map((taskClass) => routeModel({ taskClass, materiality: "MATERIAL" }).preferred.model),
    );
    expect(models.size).toBeGreaterThan(1);
    expect(models.has("gpt-5")).toBe(true);
  });

  it("[OUTPUT_CEILINGS] ningún trabajo conserva el techo de 16.000 tokens", () => {
    for (const taskClass of TASK_CLASSES) {
      for (const materiality of ["SIMPLE", "HIGH_STAKES"]) {
        expect(routeModel({ taskClass, materiality }).max_output_tokens).toBeLessThanOrEqual(10_000);
      }
    }
  });

  it("[APPLY_ROUTING] la política canónica conserva su `route` y sólo cambia de destino", () => {
    const canonical = {
      route: "iusia-general",
      preferred: { provider: "openai", model: "gpt-5" },
      fallback: [{ provider: "google", model: "gemini-2.5-pro" }],
      temperature: 0.15,
      max_output_tokens: 16000,
    };
    const routed = applyRouting(canonical, routeModel({ taskClass: "PLAN", materiality: "SIMPLE" }));
    expect(routed.route).toBe("iusia-general");
    expect(routed.preferred.model).toBe("gpt-5-mini");
    expect(routed.max_output_tokens).toBe(4_000);
    // El objeto canónico NO se muta: el registro de agentes es inmutable.
    expect(canonical.preferred.model).toBe("gpt-5");
    expect(canonical.max_output_tokens).toBe(16000);
  });
});

describe("SIMULACIÓN DE COSTO — con las tarifas oficiales", () => {
  /** Perfil medido en la ejecución real exe_xvsedz5wsqgfks2s. */
  const MEASURED = {
    plan: { input: 8_022, output: 8_528 },
    specialists: [
      { input: 12_080, output: 10_283 },
      { input: 16_496, output: 7_096 },
      { input: 12_749, output: 7_463 },
      { input: 13_532, output: 6_571 },
    ],
    integration: { input: 7_291, output: 6_679 },
  };

  function cost(model: string, input: number, output: number): number {
    const [provider, ...rest] = model.split("/");
    return providerCostUsd(rateFor(provider!, rest.join("/")), {
      input_tokens: input,
      output_tokens: output,
      cached_input_tokens: 0,
    });
  }

  it("[TEXT_ONLY] el routing propuesto reduce el costo del expediente real medido", () => {
    const current =
      cost("openai/gpt-5", MEASURED.plan.input, MEASURED.plan.output) +
      MEASURED.specialists.reduce((s, x) => s + cost("openai/gpt-5", x.input, x.output), 0) +
      cost("openai/gpt-5", MEASURED.integration.input, MEASURED.integration.output);

    const proposed =
      cost("openai/gpt-5-mini", MEASURED.plan.input, MEASURED.plan.output) +
      MEASURED.specialists.reduce((s, x) => s + cost("openai/gpt-5-mini", x.input, x.output), 0) +
      cost("openai/gpt-5", MEASURED.integration.input, MEASURED.integration.output);

    // El costo medido de esa raíz fue ~0,55 USD; el propuesto debe bajar de forma
    // sustancial sin tocar la integración, que conserva el modelo superior.
    expect(current).toBeGreaterThan(proposed);
    const reduction = 1 - proposed / current;
    expect(reduction).toBeGreaterThan(0.5);
  });

  it("[RAG_SCALING] más documentos no multiplican la generación de texto", () => {
    // La salida no depende del número de documentos: depende del número de agentes.
    // Sólo la entrada crece, y acotada por los chunks recuperados.
    const outputTokens = MEASURED.specialists.reduce((s, x) => s + x.output, 0);
    const withOneDoc = MEASURED.specialists.reduce(
      (s, x) => s + cost("openai/gpt-5-mini", x.input, x.output),
      0,
    );
    // 15 documentos: la evidencia recuperada por misión sigue acotada (5 chunks),
    // así que la entrada crece poco y la salida no crece nada.
    const withFifteenDocs = MEASURED.specialists.reduce(
      (s, x) => s + cost("openai/gpt-5-mini", x.input + 4_000, x.output),
      0,
    );
    expect(withFifteenDocs / withOneDoc).toBeLessThan(1.5);
    expect(outputTokens).toBe(31_413);
  });
});

describe("INTELIGENCIA DOCUMENTAL — el estado que el abogado necesita leer", () => {
  it("[INDEXED] un documento indexado no se muestra como pendiente de revisión", () => {
    // El caso real de IUS-2026-014: ingestion_status AI_INDEXED, status EN_REVISION.
    const state = documentIntelligenceState("AI_INDEXED", "2026-09-01T03:07:41.597Z");
    expect(state).toBe("INDEXED");
    expect(DOCUMENT_INTELLIGENCE_TERMS[state].label).toBe("Indexado por IUSIA");
    expect(DOCUMENT_INTELLIGENCE_TERMS[state].tone).toBe("success");
  });

  it("[STATES] cada estado técnico tiene su frase, y ninguna dice 'En revisión'", () => {
    const labels = Object.values(DOCUMENT_INTELLIGENCE_TERMS).map((t) => t.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label).not.toMatch(/en revisi[óo]n/i);
  });

  it("[BOUNDED_LIFECYCLE] procesar no puede durar para siempre", () => {
    const now = new Date("2026-09-01T03:20:00.000Z");
    expect(documentIntelligenceState("PROCESSING", "2026-09-01T03:18:00.000Z", now)).toBe(
      "PROCESSING",
    );
    // Pasado el margen, se declara detenido en vez de fingir que sigue avanzando.
    expect(documentIntelligenceState("PROCESSING", "2026-09-01T03:05:00.000Z", now)).toBe(
      "STALLED",
    );
    expect(canRetryIngestion("STALLED")).toBe(true);
    expect(canRetryIngestion("ERROR")).toBe(true);
    expect(canRetryIngestion("INDEXED")).toBe(false);
    expect(canRetryIngestion("PROCESSING")).toBe(false);
  });

  it("[TERMINAL] error y no indexable son terminales, no se reintentan solos", () => {
    expect(documentIntelligenceState("ERROR", "2026-01-01T00:00:00.000Z")).toBe("ERROR");
    expect(documentIntelligenceState("NOT_INDEXABLE", "2026-01-01T00:00:00.000Z")).toBe(
      "NOT_INDEXABLE",
    );
  });

  it("[POLLING] se consulta mientras algo pueda cambiar solo, y se detiene después", () => {
    const now = new Date("2026-09-01T03:10:00.000Z");
    expect(
      shouldPollIngestion(
        [{ ingestion_status: "PROCESSING", updated_at: "2026-09-01T03:09:00.000Z" }],
        now,
      ),
    ).toBe(true);
    expect(
      shouldPollIngestion(
        [
          { ingestion_status: "AI_INDEXED", updated_at: "2026-09-01T03:09:00.000Z" },
          { ingestion_status: "NOT_INDEXABLE", updated_at: "2026-09-01T03:09:00.000Z" },
        ],
        now,
      ),
    ).toBe(false);
    // Un documento atascado tampoco mantiene el sondeo: ya no va a cambiar solo.
    expect(
      shouldPollIngestion(
        [{ ingestion_status: "PROCESSING", updated_at: "2026-09-01T02:00:00.000Z" }],
        now,
      ),
    ).toBe(false);
    expect(shouldPollIngestion([], now)).toBe(false);
  });
});
