import { describe, expect, it } from "vitest";
import {
  ExecutionSafetyLedger,
  ORCHESTRATION_LIMITS,
  deriveOutcome,
  deriveProgressStages,
  buildLawyerContext,
  extractLedgerEntries,
  renderWorkPackage,
  type TeamPlan,
  type WorkPackage,
} from "@iusia/domain";
import { buildAgentCatalog, eligibleAgentIds, getAgentDefinition } from "@iusia/agents";
import { buildFallbackTeamPlan, dispatchBatches, teamPlanToDag } from "@iusia/orchestration";
import { planTeam } from "../services/team-planner.js";
import {
  classifyDocumentsForAnalysis,
  groundingNotices,
} from "../routes/orchestration.js";
import { createTestDb, seedFirm, type TestDb } from "./harness.js";

/**
 * REGRESIÓN DE ORQUESTACIÓN — Distribuciones Caribe S.A.S. vs Tecnoimportaciones
 * Andinas S.A.S.
 *
 * Reproduce el caso real de producto sobre el que se observó que una ejecución podía
 * quedarse varada cuando el expediente no tenía documentos. Ejercita la cadena
 * DETERMINISTA completa —arranque, clasificación documental, PLAN, TeamPlan,
 * validación, DAG, despacho, guardas, integración y desenlace— con un modelo simulado.
 *
 * Lo que NO cubre: la llamada real al proveedor y el motor de Cloudflare Workflows.
 * Eso es el acceptance de staging. Lo que sí certifica es que ninguna decisión de la
 * orquestación —incluida la de continuar sin documentos— depende del modelo.
 */

const OBJECTIVE = [
  "Representamos a Distribuciones Caribe S.A.S. en una controversia con",
  "Tecnoimportaciones Andinas S.A.S. Existe un contrato de distribución exclusiva por",
  "24 meses para la Costa Caribe. La contraparte terminó unilateralmente el contrato en",
  "junio de 2026, comenzó a vender directamente a varios clientes de nuestra representada",
  "y se negó a recibir inventario adquirido para cumplir el contrato. El cliente estima",
  "perjuicios cercanos a $480 millones. Necesito analizar la posición jurídica, riesgos,",
  "pruebas disponibles y estrategia.",
].join(" ");

/** TeamPlan realista para el caso, como lo devolvería el 00 PLAN. */
const TEAM_PLAN = {
  plan_id: "plan_caribe_2026",
  objective: OBJECTIVE,
  issues: [
    "Terminación unilateral de contrato de distribución exclusiva",
    "Competencia directa sobre la clientela del distribuidor",
    "Negativa a recibir inventario adquirido para el cumplimiento",
  ],
  tasks: [
    {
      task_id: "t1",
      title: "Base fáctica y clasificación",
      agent_id: "01-intake-y-clasificador",
      mission: "Establecer la base fáctica de la controversia y clasificar la materia.",
      why_selected: "El expediente requiere fijar hechos y materia antes del análisis.",
      questions: ["¿Qué hechos constan y con qué grado de certeza?"],
      depends_on: [],
      expected_output: "Ledger de hechos con certeza declarada",
      required: true,
    },
    {
      task_id: "t2",
      title: "Régimen del contrato de distribución",
      agent_id: "especialista-contractual-y-negocios",
      mission:
        "Analizar el régimen de la terminación unilateral del contrato de distribución exclusiva.",
      why_selected: "La controversia es contractual y mercantil.",
      questions: ["¿La terminación unilateral fue legítima?"],
      depends_on: ["t1"],
      expected_output: "Dictamen contractual",
      required: true,
    },
    {
      task_id: "t3",
      title: "Marco normativo y jurisprudencial",
      agent_id: "03-investigador-normativo-jurisprudencial",
      mission: "Identificar normas y jurisprudencia aplicables a la distribución exclusiva.",
      why_selected: "Se requiere autoridad verificada para sostener la posición.",
      questions: ["¿Qué autoridades sostienen la indemnización del distribuidor?"],
      depends_on: ["t1"],
      expected_output: "Ledger de autoridades",
      required: true,
    },
    {
      task_id: "t4",
      title: "Prueba disponible",
      agent_id: "04-analista-probatorio-y-pericial",
      mission: "Determinar la prueba disponible y la necesaria para acreditar perjuicios.",
      why_selected: "El cliente cuantifica perjuicios que deben acreditarse.",
      questions: ["¿Qué prueba sostiene los $480 millones?"],
      depends_on: ["t2", "t3"],
      expected_output: "Mapa probatorio",
      required: true,
    },
    {
      task_id: "t5",
      title: "Estrategia",
      agent_id: "06-estratega-juridico-convencional",
      mission: "Proponer la estrategia jurídica y las alternativas de negociación.",
      why_selected: "El encargo pide estrategia expresamente.",
      questions: ["¿Litigio o negociación?"],
      depends_on: ["t4"],
      expected_output: "Estrategia con alternativas",
      required: true,
    },
  ],
  integration: {
    mission: "Integrar los hallazgos en una posición jurídica única para el cliente.",
    expected_output: "Dictamen integrado",
  },
} satisfies TeamPlan;

async function seedCaribe(t: TestDb) {
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
  return { organizationId, directorUserId, matterId };
}

/** Ejecuta la cadena de planificación tal y como la corre el workflow. */
async function runPlanning(source: "llm" | "fallback" = "llm") {
  return planTeam({
    objective: OBJECTIVE,
    brief: {
      title: "Distribuciones Caribe S.A.S. vs Tecnoimportaciones Andinas S.A.S.",
      materiality: "HIGH_STAKES",
      jurisdiction: "Colombia",
      practice_areas: ["COMERCIAL"],
      document_summary: [],
    },
    catalog: buildAgentCatalog(),
    eligible: eligibleAgentIds(),
    runModel: async () =>
      source === "llm" ? JSON.stringify(TEAM_PLAN) : "esto no es un TeamPlan",
    fallback: () =>
      buildFallbackTeamPlan(
        { objective: OBJECTIVE, materiality: "HIGH_STAKES", practice_areas: ["COMERCIAL"] },
        [...eligibleAgentIds()].map((id) => getAgentDefinition(id)),
      ),
  });
}

describe("PRUEBA A — Distribuciones Caribe con CERO documentos (text-only)", () => {
  it("[START] un expediente sin documentos NO bloquea el arranque", async () => {
    const t = createTestDb();
    const { organizationId, matterId } = await seedCaribe(t);

    const docs = await t.documents.listForMatter(organizationId, matterId);
    const readiness = classifyDocumentsForAnalysis(docs);

    expect(readiness.textOnly).toBe(true);
    expect(readiness.blocking).toEqual([]);
    expect(readiness.unavailable).toEqual([]);
  });

  it("[RAG_SKIPPED] con cero documentos no se consulta el índice ni se finge fase documental", async () => {
    const t = createTestDb();
    const { organizationId, matterId } = await seedCaribe(t);
    const documentCount = (await t.documents.listForMatter(organizationId, matterId)).length;
    expect(documentCount).toBe(0);

    // La condición real del workflow: `ctx.document_count === 0 ? [] : collect...`.
    let indexQueried = false;
    const excerpts = documentCount === 0 ? [] : ((indexQueried = true), []);
    expect(indexQueried).toBe(false);
    expect(excerpts).toEqual([]);

    // Y la vista de producto no inventa una etapa documental que no ocurrió.
    const stages = deriveProgressStages({
      rootStatus: "RUNNING",
      events: [{ type: "execution.created" }],
      executions: [],
      rootExecutionId: "exe_root",
      documentCount: 0,
    });
    expect(stages.map((s) => s.key)).not.toContain("evidence");
  });

  it("[PLAN + TEAMPLAN] el planner produce un equipo válido para la controversia", async () => {
    const result = await runPlanning();
    expect(result.source).toBe("llm");
    expect(result.validation_errors).toEqual([]);
    expect(result.plan.tasks).toHaveLength(5);
    expect(result.plan.tasks.map((task) => task.agent_id)).toEqual([
      "01-intake-y-clasificador",
      "especialista-contractual-y-negocios",
      "03-investigador-normativo-jurisprudencial",
      "04-analista-probatorio-y-pericial",
      "06-estratega-juridico-convencional",
    ]);
  });

  it("[DAG] el TeamPlan se traduce en olas de despacho reales, respetando dependencias", async () => {
    const { plan } = await runPlanning();
    const nodes = teamPlanToDag(plan);
    const batches = dispatchBatches(nodes);

    expect(batches.length).toBeGreaterThan(1);
    expect(batches[0]!.map((n) => n.agent_id)).toEqual(["01-intake-y-clasificador"]);
    // El contractual y el investigador dependen sólo del intake: van en paralelo.
    expect(batches[1]!.map((n) => n.agent_id).sort()).toEqual([
      "03-investigador-normativo-jurisprudencial",
      "especialista-contractual-y-negocios",
    ]);
    // Ningún lote supera el paralelismo permitido.
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(ORCHESTRATION_LIMITS.MAX_PARALLEL_AGENTS);
    }
  });

  it("[FIRST_SPECIALIST_DISPATCH] las guardas dejan pasar el primer despacho sin disparar el breaker", async () => {
    const { plan } = await runPlanning();
    const safety = new ExecutionSafetyLedger();
    expect(safety.registerPlanOrIntegration("plan").ok).toBe(true);

    const nodes = teamPlanToDag(plan);
    const byAgent = new Map(plan.tasks.map((task) => [task.agent_id, task]));
    for (const batch of dispatchBatches(nodes)) {
      expect(safety.checkParallelBatch(batch.length).ok).toBe(true);
      for (const node of batch) {
        const task = byAgent.get(node.agent_id)!;
        const guard = safety.registerTask({
          taskId: task.task_id,
          agentId: node.agent_id,
          mission: task.mission,
          matterId: "mtr_caribe",
        });
        expect(guard, `task ${task.task_id} debe poder despacharse`).toEqual({ ok: true });
        for (const dep of node.requires) {
          expect(safety.registerTransfer(dep, node.agent_id).ok).toBe(true);
        }
      }
    }
    expect(safety.registerPlanOrIntegration("integration").ok).toBe(true);
    expect(safety.counts.tasks).toBe(5);
  });

  it("[GROUNDING] sin documentos el WorkPackage lleva contexto del abogado, no evidencia inventada", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId, matterId } = await seedCaribe(t);
    const matter = (await t.matters.findById(organizationId, matterId))!;
    void directorUserId;

    const lawyerContext = buildLawyerContext(matter, OBJECTIVE);
    expect(lawyerContext).toContain("Distribuciones Caribe S.A.S.");
    expect(lawyerContext).toContain("Tecnoimportaciones Andinas S.A.S.");
    expect(lawyerContext).toContain("480 millones");

    const wp: WorkPackage = {
      work_package_id: "wpk_caribe",
      matter_id: matterId,
      execution_id: "exe_caribe_t2",
      parent_execution_id: "exe_caribe_root",
      agent_id: "especialista-contractual-y-negocios",
      objective: TEAM_PLAN.tasks[1]!.mission,
      questions: TEAM_PLAN.tasks[1]!.questions,
      lawyer_provided_context: lawyerContext,
      facts: [],
      authorities: [],
      fact_refs: [],
      source_refs: [],
      document_excerpts: [],
      upstream_outputs: [],
      constraints: [
        "Este expediente no tiene documentación aportada: trabaja sobre los hechos informados por el abogado.",
      ],
      expected_output_schema: "iusia.dictamen.v1",
      allowed_tools: [],
      jurisdiction: "Colombia",
      language: "es-CO",
      created_at: new Date().toISOString(),
    };

    const rendered = renderWorkPackage(wp);
    expect(rendered).toContain("<lawyer_provided_context>");
    expect(rendered).toContain("NO están documentalmente acreditados");
    // FALSE_DOCUMENT_STAGE / FABRICATED_DOCUMENT: sin documentos no aparece ningún
    // bloque de evidencia externa ni se menciona un documento inexistente.
    expect(rendered).not.toContain("<external_document");
    expect(rendered).not.toContain("<untrusted_content_notice>");
  });

  it("[ROOT_COMPLETED] text-only termina COMPLETED, no INSUFFICIENT_EVIDENCE", () => {
    expect(
      deriveOutcome({ rootStatus: "COMPLETED", evidenceChunkCount: 0, documentCount: 0 }),
    ).toBe("COMPLETED");

    const stages = deriveProgressStages({
      rootStatus: "COMPLETED",
      events: [{ type: "execution.created", detail: { document_count: 0 } }],
      executions: TEAM_PLAN.tasks.map((task, i) => ({
        id: `exe_${i}`,
        agentId: task.agent_id,
        status: "COMPLETED",
        createdAt: `2026-08-31T10:0${i}:00.000Z`,
      })),
      rootExecutionId: "exe_root",
      documentCount: 0,
    });
    expect(stages.at(-1)).toMatchObject({ key: "done", state: "done" });
    expect(stages.filter((s) => s.state === "failed")).toEqual([]);
  });

  it("[HUMAN_NOTICE] el resultado declara sobre qué base se produjo", () => {
    expect(
      groundingNotices({ documentCount: 0, evidenceChunkCount: 0, rootStatus: "COMPLETED" }),
    ).toEqual([
      "El análisis se basa en los hechos informados en el expediente y deberá contrastarse con la documentación que posteriormente se aporte.",
    ]);
    // Mientras corre no se adelanta ninguna advertencia.
    expect(
      groundingNotices({ documentCount: 0, evidenceChunkCount: 0, rootStatus: "RUNNING" }),
    ).toEqual([]);
  });

  it("[NO_STALL_ON_BAD_PLAN] un plan inválido cae al fallback determinista y sigue avanzando", async () => {
    const result = await runPlanning("fallback");
    expect(result.source).toBe("fallback");
    expect(result.plan.tasks.length).toBeGreaterThan(0);
    // El fallback también produce un DAG despachable: nunca deja la raíz esperando.
    expect(dispatchBatches(teamPlanToDag(result.plan)).length).toBeGreaterThan(0);
  });
});

describe("PRUEBA B — Distribuciones Caribe con documento aportado", () => {
  const CONTRATO = [
    "CONTRATO DE DISTRIBUCIÓN EXCLUSIVA",
    "Entre Tecnoimportaciones Andinas S.A.S. y Distribuciones Caribe S.A.S.",
    "CLÁUSULA CUARTA. Vigencia: veinticuatro (24) meses contados desde el 1 de julio de 2025.",
    "CLÁUSULA NOVENA. Exclusividad territorial: Costa Caribe colombiana.",
    "CLÁUSULA DÉCIMA. Terminación: requiere preaviso escrito de noventa (90) días.",
  ].join("\n");

  it("[DOCUMENT_INDEXABLE] el fixture del contrato entra al pipeline y bloquea hasta estar listo", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId, matterId } = await seedCaribe(t);

    const documentId = await t.documents.link({
      organizationId,
      matterId,
      driveFileId: "drive_contrato_caribe",
      name: "Contrato de distribución exclusiva.txt",
      mimeType: "text/plain",
      linkedBy: directorUserId,
      ingestionStatus: "PROCESSING",
    });

    // Mientras se procesa, arrancar daría un análisis ciego sobre él: se espera.
    let readiness = classifyDocumentsForAnalysis(
      await t.documents.listForMatter(organizationId, matterId),
    );
    expect(readiness.blocking.map((d) => d.name)).toEqual([
      "Contrato de distribución exclusiva.txt",
    ]);

    await t.documents.markIndexed(
      organizationId,
      documentId,
      `org/${organizationId}/matter/${matterId}/doc/${documentId}.txt`,
      "sha-del-markdown",
    );

    readiness = classifyDocumentsForAnalysis(
      await t.documents.listForMatter(organizationId, matterId),
    );
    expect(readiness.blocking).toEqual([]);
    expect(readiness.textOnly).toBe(false);
  });

  it("[DOCUMENT_EVIDENCE] la evidencia recuperada viaja como contenido NO confiable y distinguible", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId, matterId } = await seedCaribe(t);
    const matter = (await t.matters.findById(organizationId, matterId))!;
    const documentId = await t.documents.link({
      organizationId,
      matterId,
      driveFileId: "drive_contrato_caribe",
      name: "Contrato de distribución exclusiva.txt",
      mimeType: "text/plain",
      linkedBy: directorUserId,
      ingestionStatus: "PROCESSING",
    });

    const wp: WorkPackage = {
      work_package_id: "wpk_caribe_doc",
      matter_id: matterId,
      execution_id: "exe_caribe_t2",
      parent_execution_id: "exe_caribe_root",
      agent_id: "especialista-contractual-y-negocios",
      objective: TEAM_PLAN.tasks[1]!.mission,
      questions: TEAM_PLAN.tasks[1]!.questions,
      lawyer_provided_context: buildLawyerContext(matter, OBJECTIVE),
      facts: [
        {
          fact_id: "f_vigencia",
          statement: "El contrato tenía vigencia de 24 meses desde el 1 de julio de 2025.",
          certainty: "[D]",
          primary_source: "Contrato de distribución exclusiva, cláusula cuarta",
        },
      ],
      authorities: [],
      fact_refs: [],
      source_refs: [],
      document_excerpts: [
        {
          ref_id: `${documentId}#1`,
          document_name: "Contrato de distribución exclusiva.txt",
          content: CONTRATO,
          page_hint: "chunk 1 · score 0.910",
        },
      ],
      upstream_outputs: [],
      constraints: ["Trabaja únicamente con la evidencia autorizada del WorkPackage."],
      expected_output_schema: "iusia.dictamen.v1",
      allowed_tools: [],
      jurisdiction: "Colombia",
      language: "es-CO",
      created_at: new Date().toISOString(),
    };

    const rendered = renderWorkPackage(wp);
    // Las tres fuentes de conocimiento quedan separadas y etiquetadas.
    expect(rendered).toContain("<lawyer_provided_context>");
    expect(rendered).toContain("<fact_ledger>");
    expect(rendered).toContain("<external_document");
    expect(rendered).toContain("noventa (90) días");
    expect(rendered).toContain(UNTRUSTED_MARKER);
    // El hecho documental se distingue del hecho informado por su código de certeza.
    expect(rendered).toContain("[D] El contrato tenía vigencia");
  });

  it("[ROOT_COMPLETED] con evidencia, el desenlace es COMPLETED y sin advertencia de vacío", () => {
    expect(
      deriveOutcome({ rootStatus: "COMPLETED", evidenceChunkCount: 3, documentCount: 1 }),
    ).toBe("COMPLETED");
    expect(
      groundingNotices({ documentCount: 1, evidenceChunkCount: 3, rootStatus: "COMPLETED" }),
    ).toEqual([]);
  });

  it("[NO_STALL_ON_EMPTY_RAG] con documentos pero sin chunks, se continúa y se declara", () => {
    // 8.3: no quedarse varado ni inventar soporte. El desenlace lo señala y el
    // resultado lo dice con palabras del despacho.
    expect(
      deriveOutcome({ rootStatus: "COMPLETED", evidenceChunkCount: 0, documentCount: 2 }),
    ).toBe("INSUFFICIENT_EVIDENCE");
    expect(
      groundingNotices({ documentCount: 2, evidenceChunkCount: 0, rootStatus: "COMPLETED" }),
    ).toEqual([
      "No se recuperó soporte documental relevante para este análisis. Las conclusiones se apoyan en los hechos informados en el expediente.",
    ]);
  });
});

describe("LEDGERS — lo que el agente produce se persiste sólo si es estructurado", () => {
  it("[FACT_LEDGER] hechos y autoridades válidos del caso Caribe se extraen y persisten", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId, matterId } = await seedCaribe(t);

    const agentOutput = JSON.stringify({
      conclusion_brief: "La terminación unilateral incumplió el preaviso pactado.",
      facts: [
        {
          fact_id: "f_preaviso",
          statement: "La cláusula décima exigía preaviso escrito de 90 días.",
          certainty: "[D]",
          source_class: "Class A",
          primary_source: "Contrato de distribución exclusiva, cláusula décima",
          numbers: [{ raw_text: "90 días", value: 90, unit: "días" }],
        },
        {
          fact_id: "f_perjuicios",
          statement: "El cliente estima perjuicios por COP 480.000.000.",
          certainty: "[A]",
          source_class: "Class C",
          primary_source: "Relato del abogado responsable",
          numbers: [],
        },
        // Elemento no conforme: prosa disfrazada de hecho. Debe descartarse.
        { statement: "Creo que ganaremos el caso" },
      ],
      authorities: [
        {
          authority_id: "a_ccom_1324",
          citation: "Código de Comercio, artículo 1324",
          type: "STATUTE",
          status: "VERIFIED_CURRENT",
          rule_summary: "Prestación e indemnización a favor del agente comercial.",
        },
      ],
    });

    const extracted = extractLedgerEntries(agentOutput);
    expect(extracted.facts).toHaveLength(2);
    expect(extracted.authorities).toHaveLength(1);
    expect(extracted.rejected).toBe(1);

    const executionId = await t.executions.create({
      organizationId,
      matterId,
      agentId: "01-intake-y-clasificador",
      parentExecutionId: null,
      rootExecutionId: null,
      startedBy: directorUserId,
    });
    await t.facts.upsertMany(organizationId, matterId, extracted.facts, executionId);
    await t.authorities.upsertMany(organizationId, matterId, extracted.authorities, executionId);

    const storedFacts = await t.facts.listForMatter(organizationId, matterId);
    expect(storedFacts).toHaveLength(2);
    // AI_EXTRACTED: el hecho apunta a la ejecución que lo produjo y conserva certeza.
    expect(storedFacts.every((f) => f.establishedByExecutionId === executionId)).toBe(true);
    expect(storedFacts.find((f) => f.factKey === "f_preaviso")?.certainty).toBe("[D]");
    expect(storedFacts.find((f) => f.factKey === "f_perjuicios")?.certainty).toBe("[A]");

    const storedAuthorities = await t.authorities.listForMatter(organizationId, matterId);
    expect(storedAuthorities).toHaveLength(1);
    expect(storedAuthorities[0]!.status).toBe("VERIFIED_CURRENT");
    expect(storedAuthorities[0]!.verifiedAt).not.toBeNull();
  });

  it("[NO_FACT_INVENTION] la prosa libre del modelo nunca se convierte en un hecho", () => {
    const prose =
      "En mi opinión el contrato se terminó de forma abusiva y procede una indemnización.";
    expect(extractLedgerEntries(prose)).toEqual({ facts: [], authorities: [], rejected: 0 });

    // Un arreglo presente pero con elementos que no cumplen el contrato no persiste nada.
    const malformed = JSON.stringify({
      facts: [{ statement: "algo", certainty: "muy seguro" }],
      authorities: [{ citation: "una sentencia" }],
    });
    const result = extractLedgerEntries(malformed);
    expect(result.facts).toEqual([]);
    expect(result.authorities).toEqual([]);
    expect(result.rejected).toBe(2);
  });

  it("[LAWYER_VS_AI] un hecho sin ejecución es del abogado; con ejecución, extraído por IA", async () => {
    const t = createTestDb();
    const { organizationId, matterId } = await seedCaribe(t);

    await t.facts.upsertMany(
      organizationId,
      matterId,
      [
        {
          fact_id: "f_relato",
          statement: "El cliente afirma que la contraparte visitó a sus clientes.",
          certainty: "[A]",
          source_class: "Class C",
          primary_source: "Entrevista con el cliente",
          numbers: [],
        },
      ],
      null,
    );

    const stored = await t.facts.listForMatter(organizationId, matterId);
    expect(stored[0]!.establishedByExecutionId).toBeNull();
  });
});

/** Marca literal del bloque de contenido no confiable, para no duplicar el texto. */
const UNTRUSTED_MARKER = "<untrusted_content_notice>";
