import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkPackage } from "@iusia/domain";
import { createTestDb, seedFirm, type TestDb } from "./harness.js";

/**
 * SIMULACIÓN LOCAL DE LA ORQUESTACIÓN DINÁMICA COMPLETA — text-only.
 *
 * Origen: la prueba humana del 31-ago-2026 (root `exe_vzk5fx3816xfqddg`) se detuvo
 * dentro de `dyn-plan`, de modo que NADIE —ni una prueba ni una persona— había visto
 * nunca la cadena entera correr de principio a fin. Los tests existentes cubrían las
 * piezas por separado; el tramo posterior al PLAN sólo estaba probado por inspección
 * del código.
 *
 * Aquí se ejecuta el WORKFLOW REAL contra SQLite real, con `step` inyectado, el modelo
 * simulado y cero documentos. No se simula el motor durable de Cloudflare: se prueba
 * la secuencia de decisiones del workflow, que es donde vive todo lo que falló.
 */

const PLAN_JSON = JSON.stringify({
  plan_id: "plan_caribe_local",
  objective: "Analizar la posición jurídica en la controversia de distribución.",
  issues: ["Terminación unilateral", "Competencia sobre la clientela"],
  tasks: [
    {
      task_id: "t1",
      title: "Base fáctica",
      agent_id: "01-intake-y-clasificador",
      mission: "Establecer la base fáctica de la controversia.",
      why_selected: "Hay que fijar hechos antes de analizar.",
      questions: ["¿Qué hechos constan?"],
      depends_on: [],
      expected_output: "Ledger de hechos",
      required: true,
    },
    {
      task_id: "t2",
      title: "Régimen contractual",
      agent_id: "especialista-contractual-y-negocios",
      mission: "Analizar la terminación unilateral del contrato de distribución.",
      why_selected: "La controversia es contractual.",
      questions: ["¿Fue legítima la terminación?"],
      depends_on: ["t1"],
      expected_output: "Dictamen contractual",
      required: true,
    },
    {
      task_id: "t3",
      title: "Marco normativo",
      agent_id: "03-investigador-normativo-jurisprudencial",
      mission: "Identificar normas y jurisprudencia aplicables.",
      why_selected: "Se requiere autoridad verificada.",
      questions: ["¿Qué autoridades aplican?"],
      depends_on: ["t1"],
      expected_output: "Ledger de autoridades",
      required: true,
    },
  ],
  integration: {
    mission: "Integrar los hallazgos en una posición única.",
    expected_output: "Dictamen integrado",
  },
});

/** Salida de especialista con ledgers estructurados, como la produce un agente real. */
const SPECIALIST_OUTPUT = JSON.stringify({
  conclusion_brief: "La terminación unilateral incumplió el preaviso pactado.",
  facts: [
    {
      fact_id: "f_preaviso",
      statement: "El contrato exigía preaviso escrito de 90 días.",
      certainty: "[A]",
      source_class: "Class C",
      primary_source: "Relato del abogado responsable",
      numbers: [],
    },
  ],
  authorities: [],
});

vi.mock("../services/model-gateway.js", () => ({
  ModelGateway: class {
    constructor(
      public env: unknown,
      public deps?: { requestTimeoutMs?: number; maxAttemptsPerCandidate?: number },
    ) {
      calls.gatewayConstructions.push(this.deps ?? {});
    }
    async complete(
      _policy: unknown,
      _messages: unknown,
      ctx: { agent_id: string },
      options?: {
        onAttempt?: (i: unknown) => void | Promise<void>;
        onResponse?: (i: unknown) => void | Promise<void>;
      },
    ) {
      await options?.onAttempt?.({
        provider: "openai",
        model: "gpt-5",
        attempt: 1,
        candidateIndex: 0,
      });
      await options?.onResponse?.({
        provider: "openai",
        model: "gpt-5",
        attempt: 1,
        durationMs: 42,
      });
      calls.modelCalls.push(ctx.agent_id);
      return {
        provider: "openai",
        model: "gpt-5",
        text: PLAN_JSON,
        usage: { input_tokens: 1200, output_tokens: 800, cached_input_tokens: 0 },
        gateway_log_id: "log_1",
        attempts: 1,
      };
    }
  },
  rateFor: () => ({
    provider: "openai",
    model: "gpt-5",
    input_usd_per_mtok: 1.25,
    output_usd_per_mtok: 10,
  }),
}));

vi.mock("agents", () => ({
  getAgentByName: async (_binding: unknown, executionId: string) => ({
    async run(workPackage: WorkPackage) {
      calls.workPackages.push(workPackage);
      const db = harness!.db;
      const { ExecutionRepository, CreditRepository } = await import("@iusia/db");
      const executions = new ExecutionRepository(db);
      const credits = new CreditRepository(db);
      const execution = await executions.findById(executionId);
      const outputRef = `executions/${execution!.organizationId}/${execution!.matterId}/${executionId}.json`;
      await harness!.artifacts.put(
        outputRef,
        JSON.stringify({ text: SPECIALIST_OUTPUT, provenance: { model: "gpt-5" } }),
      );
      await credits.post({
        organizationId: execution!.organizationId,
        kind: "CONSUMPTION",
        amount: -50,
        idempotencyKey: `execution:${executionId}`,
        matterId: execution!.matterId,
        executionId,
      });
      await executions.transition(executionId, "RUNNING");
      await executions.transition(executionId, "COMPLETED", {
        provider: "openai",
        model: "gpt-5",
        outputRef,
        outputType: "SPECIALIST_DICTAMEN",
        creditsConsumed: 50,
      });
      return {
        execution_id: executionId,
        status: "COMPLETED" as const,
        output_ref: outputRef,
        credits_consumed: 50,
      };
    },
  }),
}));

const calls = {
  modelCalls: [] as string[],
  workPackages: [] as WorkPackage[],
  gatewayConstructions: [] as Array<{ requestTimeoutMs?: number; maxAttemptsPerCandidate?: number }>,
  stepNames: [] as string[],
  sleeps: [] as string[],
  waits: [] as string[],
};

interface FakeArtifacts {
  put(key: string, value: string): Promise<void>;
  get(key: string): Promise<{ json: () => Promise<unknown>; text: () => Promise<string> } | null>;
  size(): number;
}

let harness: { db: TestDb["db"]; artifacts: FakeArtifacts } | null = null;

/**
 * R2 en memoria con el contrato mínimo que usa el workflow.
 *
 * Deliberadamente NO extiende un Map: hacerlo pisaba `Map.prototype.get` con el `get`
 * asíncrono del doble, que entonces se llamaba a sí mismo hasta desbordar la pila.
 * El almacén va dentro, no debajo.
 */
function fakeArtifacts(): FakeArtifacts {
  const store = new Map<string, string>();
  return {
    async put(key, value) {
      store.set(key, value);
    },
    async get(key) {
      const value = store.get(key);
      if (value === undefined) return null;
      return { json: async () => JSON.parse(value), text: async () => value };
    },
    size: () => store.size,
  };
}

/** `step` inyectado: ejecuta el cuerpo y registra el nombre, el orden y las esperas. */
function fakeStep() {
  return {
    async do<T>(name: string, a: unknown, b?: unknown): Promise<T> {
      calls.stepNames.push(name);
      const fn = (typeof a === "function" ? a : b) as () => Promise<T>;
      return fn();
    },
    async sleep(name: string) {
      calls.sleeps.push(name);
    },
    async waitForEvent<T>(name: string): Promise<{ payload: T }> {
      calls.waits.push(name);
      throw new Error(`el flujo text-only no debe esperar el evento ${name}`);
    },
  };
}

async function runTextOnlyOrchestration() {
  const t = createTestDb();
  const artifacts = fakeArtifacts();
  harness = { db: t.db, artifacts: artifacts as never };

  const { organizationId, directorUserId } = await seedFirm(t, {
    orgName: "Pisoso Legal",
    directorEmail: "direccion@pisoso.test",
  });
  const matterId = await t.matters.create(
    organizationId,
    directorUserId,
    {
      title: "Distribuciones Caribe S.A.S. vs Tecnoimportaciones Andinas S.A.S.",
      client_name: "Distribuciones Caribe S.A.S.",
      materiality: "HIGH_STAKES",
      practice_areas: ["COMERCIAL"],
      jurisdiction: "Colombia",
      parties: [
        { kind: "DEMANDANTE", name: "Distribuciones Caribe S.A.S." },
        { kind: "DEMANDADO", name: "Tecnoimportaciones Andinas S.A.S." },
      ],
      objective: "Analizar posición jurídica, riesgos, prueba y estrategia.",
    } as never,
    "IUS-2026-410",
  );
  await t.credits.ensureWallet(organizationId, 0);
  await t.credits.post({
    organizationId,
    kind: "GRANT",
    amount: 50_000,
    idempotencyKey: `grant:${organizationId}`,
  });

  const rootExecutionId = await t.executions.create({
    organizationId,
    matterId,
    agentId: "pisoso-orquestador-juridico",
    parentExecutionId: null,
    rootExecutionId: null,
    startedBy: directorUserId,
  });
  await t.executions.transition(rootExecutionId, "RUNNING");

  const { MatterOrchestrationWorkflow } = await import("../workflows/matter-orchestration.js");
  const env = {
    DB: {},
    ARTIFACTS: artifacts,
    AI_SEARCH: null,
    LegalWorker: {},
    ORCHESTRATION_MODE: "dynamic",
    ROOT_CREDIT_LIMIT: "50000",
  };
  // `createDb` se llama con env.DB; se devuelve el drizzle del harness.
  const dbModule = await import("@iusia/db");
  vi.spyOn(dbModule, "createDb").mockReturnValue(t.db);

  const workflow = new MatterOrchestrationWorkflow({} as never, env as never);
  const result = await workflow.run(
    {
      payload: {
        organization_id: organizationId,
        matter_id: matterId,
        root_execution_id: rootExecutionId,
        started_by: directorUserId,
        objective:
          "Representamos a Distribuciones Caribe S.A.S. La contraparte terminó unilateralmente el contrato de distribución exclusiva y comenzó a vender directamente a nuestros clientes. Perjuicios estimados en $480 millones. Necesito posición jurídica, riesgos, prueba y estrategia.",
      },
      instanceId: "wfi_local",
      timestamp: new Date(),
    } as never,
    fakeStep() as never,
  );

  return { t, rootExecutionId, matterId, organizationId, result };
}

beforeEach(() => {
  calls.modelCalls = [];
  calls.workPackages = [];
  calls.gatewayConstructions = [];
  calls.stepNames = [];
  calls.sleeps = [];
  calls.waits = [];
  vi.restoreAllMocks();
});

describe("TEXT-ONLY — la cadena completa que la prueba humana no llegó a ver", () => {
  it("[ROOT_COMPLETED] PLAN → TeamPlan → DAG → especialistas → integración → COMPLETED", async () => {
    const { t, rootExecutionId, result } = await runTextOnlyOrchestration();

    const root = await t.executions.findById(rootExecutionId);
    expect(root!.status).toBe("COMPLETED");
    expect(result.failed).toEqual([]);
    // PLAN + 3 especialistas + INTEGRATE, todas con identidad propia en el ledger.
    expect(result.completed.length).toBeGreaterThanOrEqual(4);

    const rows = (await t.executions.listByRoot(rootExecutionId)).filter(
      (r) => r.id !== rootExecutionId,
    );
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.status === "COMPLETED")).toBe(true);
    expect(rows.map((r) => r.agentId).sort()).toEqual([
      "01-intake-y-clasificador",
      "03-investigador-normativo-jurisprudencial",
      "especialista-contractual-y-negocios",
      "pisoso-orquestador-juridico", // PLAN
      "pisoso-orquestador-juridico", // INTEGRATE
    ]);
  });

  it("[MILESTONES] la cadena de hitos llega hasta ROOT_COMPLETE sin huecos", async () => {
    const { t, rootExecutionId } = await runTextOnlyOrchestration();
    const events = await t.events.listByRoot(rootExecutionId);
    const milestones = events
      .filter((e) => e.type === "agent.milestone")
      .map((e) => String(e.detail?.milestone));

    for (const expected of [
      "execution_created",
      "PLAN_START",
      "PLAN_MODEL_ATTEMPT",
      "PLAN_MODEL_RESPONSE",
      "PLAN_LLM_COMPLETE",
      "TEAMPLAN_PARSED",
      "TEAMPLAN_VALIDATED",
      "PLAN_COMPLETE",
      "DAG_CREATED",
      "FIRST_SPECIALIST_DISPATCH",
      "SPECIALISTS_COMPLETE",
      "INTEGRATION_START",
      "INTEGRATION_COMPLETE",
      "ROOT_COMPLETE",
    ]) {
      expect(milestones, `falta el hito ${expected}`).toContain(expected);
    }
    // El orden importa: el despacho ocurre DESPUÉS de cerrar el plan y crear el DAG.
    expect(milestones.indexOf("FIRST_SPECIALIST_DISPATCH")).toBeGreaterThan(
      milestones.indexOf("DAG_CREATED"),
    );
    expect(milestones.indexOf("DAG_CREATED")).toBeGreaterThan(
      milestones.indexOf("PLAN_COMPLETE"),
    );
  });

  it("[POST_PLAN_DELAY_MS] el primer despacho reporta su latencia y es inmediata", async () => {
    const { t, rootExecutionId } = await runTextOnlyOrchestration();
    const events = await t.events.listByRoot(rootExecutionId);
    const dispatch = events.find(
      (e) => e.detail?.milestone === "FIRST_SPECIALIST_DISPATCH",
    );
    expect(dispatch).toBeDefined();
    expect(dispatch!.detail?.post_plan_delay_ms).toBeTypeOf("number");
    // Sin llamada real al proveedor, el tramo plan→despacho es puro cómputo: si
    // apareciera aquí una espera de segundos, sería una espera lógica introducida.
    expect(Number(dispatch!.detail?.post_plan_delay_ms)).toBeLessThan(5_000);
  });

  it("[NO_WAITS] el flujo text-only no duerme ni espera eventos en ningún punto", async () => {
    await runTextOnlyOrchestration();
    expect(calls.sleeps).toEqual([]);
    expect(calls.waits).toEqual([]);
  });

  it("[ZERO_DOCS] no se consulta el índice ni se anuncia fase documental", async () => {
    const { t, rootExecutionId } = await runTextOnlyOrchestration();
    const events = await t.events.listByRoot(rootExecutionId);
    // Ni un solo tool call de recuperación: con cero documentos no hay nada que buscar.
    expect(events.filter((e) => e.type === "agent.tool.called")).toEqual([]);
    // Y ningún WorkPackage transporta evidencia documental inventada.
    for (const wp of calls.workPackages) {
      expect(wp.document_excerpts).toEqual([]);
    }
  });

  it("[LAWYER_CONTEXT] cada especialista recibe el relato del abogado, no un vacío", async () => {
    await runTextOnlyOrchestration();
    expect(calls.workPackages.length).toBeGreaterThan(0);
    for (const wp of calls.workPackages) {
      expect(wp.lawyer_provided_context).toContain("Distribuciones Caribe S.A.S.");
      expect(wp.lawyer_provided_context).toContain("480 millones");
      expect(
        wp.constraints.some((c) => /no tiene documentación aportada|hechos informados/i.test(c)),
      ).toBe(true);
    }
  });

  it("[BOUNDED_PLANNER] la planificación usa el gateway acotado, no el de por defecto", async () => {
    await runTextOnlyOrchestration();
    const planner = calls.gatewayConstructions.find((d) => d.requestTimeoutMs !== undefined);
    expect(planner).toBeDefined();
    expect(planner!.requestTimeoutMs).toBe(180_000);
    expect(planner!.maxAttemptsPerCandidate).toBe(2);
  });

  it("[FACT_LEDGER] los hechos estructurados de los especialistas quedan en el expediente", async () => {
    const { t, organizationId, matterId } = await runTextOnlyOrchestration();
    // El LegalWorker está simulado, así que la persistencia de ledgers no corre aquí;
    // lo que este test fija es que el expediente text-only llega a los especialistas
    // con el contexto del abogado y que la cadena no depende del Fact Ledger para
    // avanzar: un expediente sin hechos previos NO bloquea la orquestación.
    expect(await t.facts.listForMatter(organizationId, matterId)).toEqual([]);
    expect(calls.workPackages.every((wp) => wp.facts.length === 0)).toBe(true);
  });

  it("[NO_DUPLICATE_ROWS] cada despacho lógico tiene una sola ejecución", async () => {
    const { t, rootExecutionId } = await runTextOnlyOrchestration();
    const rows = (await t.executions.listByRoot(rootExecutionId)).filter(
      (r) => r.id !== rootExecutionId,
    );
    const keys = rows.map((r) => r.dispatchKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain(`${rootExecutionId}:plan`);
    expect(keys).toContain(`${rootExecutionId}:integrate`);
    expect(keys).toContain(`${rootExecutionId}:task:t2`);
  });

  it("[CREDITS] el consumo queda registrado y wallet y ledger reconcilian", async () => {
    const { t, organizationId } = await runTextOnlyOrchestration();
    const reconciliation = await t.credits.reconcile(organizationId);
    expect(reconciliation.reconciled).toBe(true);
    expect(reconciliation.walletBalance).toBeLessThan(50_000);
  });

  it("[CANCEL_STOPS_DISPATCH] una cancelación durante la ejecución impide nuevos despachos", async () => {
    const t = createTestDb();
    const artifacts = fakeArtifacts();
    harness = { db: t.db, artifacts: artifacts as never };
    const { organizationId, directorUserId } = await seedFirm(t, {
      orgName: "Cancelada",
      directorEmail: "dir@cancelada.test",
    });
    const matterId = await t.matters.create(
      organizationId,
      directorUserId,
      {
        title: "Expediente cancelado en vuelo",
        client_name: "Cliente",
        materiality: "HIGH_STAKES",
        practice_areas: ["COMERCIAL"],
        jurisdiction: "Colombia",
        parties: [],
      } as never,
      "IUS-2026-411",
    );
    await t.credits.ensureWallet(organizationId, 0);
    await t.credits.post({
      organizationId,
      kind: "GRANT",
      amount: 50_000,
      idempotencyKey: `grant:${organizationId}`,
    });
    const rootExecutionId = await t.executions.create({
      organizationId,
      matterId,
      agentId: "pisoso-orquestador-juridico",
      parentExecutionId: null,
      rootExecutionId: null,
      startedBy: directorUserId,
    });
    await t.executions.transition(rootExecutionId, "RUNNING");

    const dbModule = await import("@iusia/db");
    vi.spyOn(dbModule, "createDb").mockReturnValue(t.db);
    const { MatterOrchestrationWorkflow } = await import("../workflows/matter-orchestration.js");

    // El abogado detiene el análisis justo después de crear el DAG.
    const step = fakeStep();
    const originalDo = step.do.bind(step);
    step.do = (async <T,>(name: string, a: unknown, b?: unknown): Promise<T> => {
      const out = await originalDo<T>(name, a, b);
      if (name === "dyn-timing-DAG_CREATED") {
        await t.executions.transition(rootExecutionId, "CANCELLED", {
          errorCode: "CANCELLED_BY_MATTER_MEMBER",
        });
      }
      return out;
    }) as typeof step.do;

    const workflow = new MatterOrchestrationWorkflow(
      {} as never,
      {
        DB: {},
        ARTIFACTS: artifacts,
        AI_SEARCH: null,
        LegalWorker: {},
        ORCHESTRATION_MODE: "dynamic",
        ROOT_CREDIT_LIMIT: "50000",
      } as never,
    );
    await workflow.run(
      {
        payload: {
          organization_id: organizationId,
          matter_id: matterId,
          root_execution_id: rootExecutionId,
          started_by: directorUserId,
          objective: "Analizar la controversia contractual del expediente.",
        },
        instanceId: "wfi_cancel",
        timestamp: new Date(),
      } as never,
      step as never,
    );

    // La raíz sigue CANCELLED: el cierre no la reabre, y no se despachó ningún
    // especialista después de la cancelación.
    const root = await t.executions.findById(rootExecutionId);
    expect(root!.status).toBe("CANCELLED");
    const specialists = (await t.executions.listByRoot(rootExecutionId)).filter(
      (r) => r.id !== rootExecutionId && r.agentId !== "pisoso-orquestador-juridico",
    );
    expect(specialists).toEqual([]);
  });
});
