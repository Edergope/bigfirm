import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ORCHESTRATION_LIMITS,
  analysisCompletionNotice,
  planningWaitHint,
  type EventView,
} from "@iusia/domain";
import { ModelGateway } from "../services/model-gateway.js";

/**
 * REGRESIÓN DEL TRAMO PLAN → DESPACHO.
 *
 * Origen: prueba humana real en staging (root `exe_vzk5fx3816xfqddg`, 31-ago-2026).
 * El expediente era text-only; el DAG nunca llegó a despachar especialistas porque la
 * fase 00 PLAN seguía esperando la respuesta del modelo a los 90 s, sin emitir una
 * sola señal entre `PLAN_START` y `PLAN_LLM_COMPLETE`. El abogado, ante una pantalla
 * clavada en «Identificando los especialistas», canceló un análisis que funcionaba.
 *
 * Estos tests fijan las tres invariantes que evitan que vuelva a pasar:
 *  1. la planificación emite evidencia de vida antes de cada intento;
 *  2. la espera está ACOTADA, no heredada de los valores por defecto del gateway;
 *  3. entre DAG_CREATED y el primer despacho no hay ninguna espera lógica.
 */

const WORKFLOW_SRC = readFileSync(
  join(process.cwd(), "apps/web/src/worker/workflows/matter-orchestration.ts"),
  "utf8",
);

/** Cuerpo de `runDynamic`, que es donde vive el tramo auditado. */
function dynamicSource(): string {
  const start = WORKFLOW_SRC.indexOf("private async runDynamic(");
  expect(start).toBeGreaterThan(-1);
  return WORKFLOW_SRC.slice(start);
}

describe("PLANIFICACIÓN — evidencia de vida y espera acotada", () => {
  it("[PLAN_MODEL_ATTEMPT] el gateway avisa ANTES de llamar al modelo, no sólo al volver", async () => {
    const seen: string[] = [];
    const gateway = new ModelGateway(
      { CLOUDFLARE_ACCOUNT_ID: "acc", AI_GATEWAY_NAME: "iusia" } as never,
      {
        fetch: (async () => {
          seen.push("model-call");
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: "{}" } }],
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }) as unknown as typeof fetch,
      },
    );

    await gateway.complete(
      { route: "r", preferred: { provider: "openai", model: "gpt-5" }, fallback: [] } as never,
      [{ role: "user", content: "hola" }],
      { organization_id: "o", matter_id: "m", agent_id: "00", execution_id: "e" },
      {
        onAttempt: (info) => {
          seen.push(`attempt:${info.provider}/${info.model}#${info.attempt}`);
        },
        onResponse: (info) => {
          seen.push(`response:${info.durationMs >= 0}`);
        },
      },
    );

    // El aviso debe preceder a la llamada: es lo único que el producto puede mostrar
    // durante los 30–130 s que tarda un modelo de razonamiento en contestar.
    expect(seen).toEqual(["attempt:openai/gpt-5#1", "model-call", "response:true"]);
  });

  it("[HOOK_NEVER_BREAKS] un fallo del gancho de observabilidad no rompe la ejecución", async () => {
    const gateway = new ModelGateway(
      { CLOUDFLARE_ACCOUNT_ID: "acc", AI_GATEWAY_NAME: "iusia" } as never,
      {
        fetch: (async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "ok" } }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )) as unknown as typeof fetch,
      },
    );

    const result = await gateway.complete(
      { route: "r", preferred: { provider: "openai", model: "gpt-5" }, fallback: [] } as never,
      [{ role: "user", content: "hola" }],
      { organization_id: "o", matter_id: "m", agent_id: "00", execution_id: "e" },
      {
        onAttempt: () => {
          throw new Error("el ledger falló");
        },
      },
    );
    expect(result.text).toBe("ok");
  });

  it("[BOUNDED_PLANNING] la espera de planificación está acotada y calibrada", () => {
    // Medición real en staging para 00/gpt-5: n=12, min 33 s, mediana 79 s, max 127 s.
    // El límite debe cubrir el peor caso observado con holgura…
    expect(ORCHESTRATION_LIMITS.PLANNER_REQUEST_TIMEOUT_MS).toBeGreaterThan(130_000);
    // …y no heredar los 300 s por intento del gateway.
    expect(ORCHESTRATION_LIMITS.PLANNER_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(180_000);
    expect(ORCHESTRATION_LIMITS.PLANNER_MAX_ATTEMPTS_PER_CANDIDATE).toBeLessThanOrEqual(2);

    // Peor caso total con dos candidatos, por debajo de la cota de silencio admisible.
    const worstCaseMs =
      ORCHESTRATION_LIMITS.PLANNER_REQUEST_TIMEOUT_MS *
      ORCHESTRATION_LIMITS.PLANNER_MAX_ATTEMPTS_PER_CANDIDATE *
      2;
    expect(worstCaseMs).toBeLessThanOrEqual(
      ORCHESTRATION_LIMITS.MAX_PLANNING_WALL_TIME_MINUTES * 60_000,
    );
  });

  it("[PLANNER_USES_BOUNDED_GATEWAY] el workflow construye el gateway del planner con esos límites", () => {
    const src = dynamicSource();
    const planStep = src.slice(src.indexOf("planWithFailureClosed("), src.indexOf("spentCredits +="));
    expect(planStep).toContain("ORCHESTRATION_LIMITS.PLANNER_REQUEST_TIMEOUT_MS");
    expect(planStep).toContain("ORCHESTRATION_LIMITS.PLANNER_MAX_ATTEMPTS_PER_CANDIDATE");
    expect(planStep).toContain("PLAN_MODEL_ATTEMPT");
  });
});

describe("DAG_CREATED → FIRST_SPECIALIST_DISPATCH — sin esperas lógicas", () => {
  /**
   * El tramo entre la creación del DAG y el primer despacho. No se mide velocidad de
   * CPU —sería frágil— sino que NO exista ninguna operación de espera, sondeo o
   * recuperación en el camino: las esperas son el mecanismo por el que el tramo se
   * volvió invisible durante minutos.
   */
  function dispatchSegment(): string {
    const src = dynamicSource();
    const from = src.indexOf("TIMING_MILESTONES.DAG_CREATED");
    const to = src.indexOf("TIMING_MILESTONES.FIRST_SPECIALIST_DISPATCH");
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    return src.slice(from, to);
  }

  it("[NO_SLEEP] no hay sleep ni espera de evento entre el DAG y el primer despacho", () => {
    const segment = dispatchSegment();
    expect(segment).not.toMatch(/step\.sleep/);
    expect(segment).not.toMatch(/waitForEvent/);
    expect(segment).not.toMatch(/setTimeout/);
  });

  it("[NO_RETRIEVAL_BEFORE_DISPATCH] no se consulta el índice antes del primer despacho", () => {
    // Con cero documentos no puede haber ninguna llamada a recuperación en el camino;
    // con documentos, la recuperación ocurre DENTRO del despacho, no antes de él.
    expect(dispatchSegment()).not.toMatch(/collectMatterEvidence/);
  });

  it("[NO_NESTED_STEP] el cuerpo del despacho no anida ningún step.do", () => {
    const src = dynamicSource();
    const start = src.indexOf('`dyn-dispatch-${batchIndex}-${node.agent_id}`');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("for (const r of results)", start));
    // Éste fue el defecto original: un step de comprobación dentro del step de
    // despacho. Workflows no admite anidamiento y el despacho quedaba atrapado.
    expect(body).not.toMatch(/step\.do\(/);
    expect(body).toContain("isCancelledNow()");
  });

  it("[CANCEL_CHECK_IS_DIRECT_READ] isCancelledNow no envuelve la lectura en un step", () => {
    const src = dynamicSource();
    const helper = src.slice(
      src.indexOf("const isCancelledNow"),
      src.indexOf("const isCancelled ="),
    );
    expect(helper).toContain("executions.findById");
    expect(helper).not.toMatch(/step\.do\(/);
  });

  it("[NO_INGESTION_WAIT] el workflow no espera ingestión en ningún punto", () => {
    const src = dynamicSource();
    expect(src).not.toMatch(/DOCUMENT_INGESTION/);
    expect(src).not.toMatch(/waitForIngestion/);
  });

  it("[ZERO_DOCS_SKIPS_RETRIEVAL] sin evidencia citable no se instancia el proveedor de índice", () => {
    const src = dynamicSource();
    /*
      La guarda era `ctx.document_count === 0`, que cuenta TODOS los documentos del
      expediente. Un expediente con tres imágenes tiene tres documentos y cero
      evidencia: se abría una llamada al índice para no encontrar nada. Ahora la guarda
      es el conjunto congelado, que sólo cuenta lo que se puede citar.
    */
    const uses = [...src.matchAll(/collectMatterEvidence\(/g)];
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) {
      const before = src.slice(Math.max(0, use.index! - 260), use.index!);
      expect(before).toMatch(/evidenceCount === 0\s*\n?\s*\?\s*\[\]/);
    }
  });
});

describe("UX — el aviso no puede contradecir a la ventana", () => {
  it("[CANCELLED] un análisis detenido se anuncia como detenido, no como terminado", () => {
    expect(analysisCompletionNotice("CANCELLED")).toEqual({
      title: "El análisis de IUSIA fue detenido",
      tone: "navy",
    });
  });

  it("[COMPLETED] un análisis concluido sí se anuncia como terminado", () => {
    expect(analysisCompletionNotice("COMPLETED")).toEqual({
      title: "El análisis de IUSIA terminó",
      tone: "success",
    });
  });

  it("[FAILED] un fallo se anuncia como fallo", () => {
    expect(analysisCompletionNotice("FAILED").title).toMatch(/no pudo completarse/i);
    expect(analysisCompletionNotice("FAILED").tone).toBe("critical");
    expect(analysisCompletionNotice("BLOCKED").tone).toBe("critical");
  });

  it("[UNKNOWN] sin estado resoluble no se afirma un desenlace", () => {
    const notice = analysisCompletionNotice("");
    expect(notice.title).not.toMatch(/terminó|detenido|no pudo/i);
    expect(notice.tone).toBe("navy");
  });

  it("[PLANNING_HINT] mientras el socio director piensa, la espera se declara", () => {
    const events: EventView[] = [
      { type: "agent.milestone", detail: { milestone: "PLAN_START" } },
      { type: "agent.milestone", detail: { milestone: "PLAN_MODEL_ATTEMPT", attempt: 1 } },
    ];
    expect(planningWaitHint({ events, rootStatus: "RUNNING" })).toMatch(/uno y dos minutos/i);

    // Cuando el plan ya cerró, el aviso desaparece: no se explica una espera que acabó.
    expect(
      planningWaitHint({
        events: [...events, { type: "agent.milestone", detail: { milestone: "PLAN_COMPLETE" } }],
        rootStatus: "RUNNING",
      }),
    ).toBeNull();

    // Y nunca aparece sobre una ejecución ya terminada.
    expect(planningWaitHint({ events, rootStatus: "CANCELLED" })).toBeNull();
    expect(planningWaitHint({ events: [], rootStatus: "RUNNING" })).toBeNull();
  });
});

describe("TEXT-ONLY — la secuencia real que falló, ahora completa", () => {
  it("[MILESTONE_ORDER] la cadena de hitos no deja huecos mudos en la planificación", () => {
    const src = dynamicSource();
    const order = [
      "EXECUTION_CREATED",
      "PLAN_START",
      "PLAN_MODEL_ATTEMPT",
      "PLAN_MODEL_RESPONSE",
      "PLAN_LLM_COMPLETE",
      "TEAMPLAN_PARSED",
      "TEAMPLAN_VALIDATED",
      // PLAN_COMPLETE cierra la fase: es el ancla de POST_PLAN_DELAY_MS y debe ser el
      // último hito del paso de planificación, no un punto intermedio.
      "PLAN_COMPLETE",
      "DAG_CREATED",
      "FIRST_SPECIALIST_DISPATCH",
      "SPECIALISTS_COMPLETE",
      "INTEGRATION_START",
      "INTEGRATION_COMPLETE",
      "ROOT_COMPLETE",
    ];
    let cursor = -1;
    for (const milestone of order) {
      const at = src.indexOf(`TIMING_MILESTONES.${milestone}`, cursor + 1);
      expect(at, `falta el hito ${milestone} en la ruta dinámica`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it("[POST_PLAN_DELAY_MS] el primer despacho reporta su latencia desde el cierre del PLAN", () => {
    const src = dynamicSource();
    const block = src.slice(
      src.indexOf("TIMING_MILESTONES.FIRST_SPECIALIST_DISPATCH"),
      src.indexOf("TIMING_MILESTONES.FIRST_SPECIALIST_DISPATCH") + 600,
    );
    expect(block).toContain("post_plan_delay_ms");
    expect(block).toContain("planned.planCompletedAtMs");
  });

  it("[NO_FAKE_TIMERS_NEEDED] la guarda es estructural, no una aserción de velocidad", () => {
    // Deliberado: no se mide tiempo de CPU. Se prueba que no existe la operación que
    // produce la espera. Un test de velocidad sería frágil y no describiría el defecto.
    expect(vi.isFakeTimers()).toBe(false);
  });
});
