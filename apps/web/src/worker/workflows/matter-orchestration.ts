import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { getAgentByName } from "agents";
import {
  IusiaError,
  ORCHESTRATION_LIMITS,
  canAffordNextExecution,
  computeRootCreditBudget,
  creditsForCost,
  deriveConclusionText,
  buildLawyerContext,
  applyRouting,
  attemptIdempotencyKey,
  routeModel,
  newId,
  ExecutionSafetyLedger,
  type CircuitBreakerReason,
  type DocumentExcerpt,
  type Materiality,
  type TeamPlan,
  type TeamPlanTask,
  type UpstreamOutputRef,
  type WorkPackage,
} from "@iusia/domain";
import {
  buildAgentCatalog,
  eligibleAgentIds,
  getAgentDefinition,
  ORCHESTRATOR_AGENT_ID,
} from "@iusia/agents";
import {
  buildFallbackTeamPlan,
  dispatchBatches,
  evaluateGate,
  planFor,
  teamPlanToDag,
  WAVE_GATE,
  type DagNode,
  type Wave,
} from "@iusia/orchestration";
import {
  AuditRepository,
  AuthorityRepository,
  CreditRepository,
  DocumentRepository,
  ExecutionEventRepository,
  ExecutionRepository,
  FactRepository,
  MatterRepository,
  createDb,
} from "@iusia/db";
import type { Env } from "../env.js";
import type { LegalWorker, RunResult } from "../agents/legal-worker.js";
import { AiSearchRetrievalProvider } from "../integrations/ai-search.js";
import { collectMatterEvidence } from "./rag-evidence.js";
import { freezeEvidenceSet } from "@iusia/domain";
import { NotificationService } from "../services/notifications.js";
import { ModelGateway } from "../services/model-gateway.js";
import { planTeam, type MatterBrief } from "../services/team-planner.js";

export interface MatterOrchestrationParams {
  organization_id: string;
  matter_id: string;
  root_execution_id: string;
  started_by: string;
  objective: string;
}

/** Estimación conservadora de créditos por ejecución (alineada con la ruta HTTP). */
const ESTIMATED_CREDITS_PER_RUN = 300;
const DEFAULT_ROOT_CREDIT_LIMIT = 5000;

/**
 * Techo de COSTO DE PROVEEDOR por expediente analizado, en USD.
 *
 * Los créditos son economía comercial; esto es dinero real facturado por el
 * proveedor. Son cosas distintas y hasta ahora sólo se vigilaba la primera: una
 * cadena de reintentos podía gastar sin que ninguna guarda lo notara, porque un
 * modelo sin tarifa registrada además computaba cero.
 */
const DEFAULT_ROOT_PROVIDER_COST_BUDGET_USD = 1.5;

/**
 * Reserva por intento de costo DESCONOCIDO (timeout, corte de red: el proveedor no
 * devolvió usage). No es una cifra inventada de gasto —el ledger conserva ese asiento
 * como desconocido—, es lo que ese intento consume del PRESUPUESTO para que una
 * cadena de fallos inmedibles no pueda correr indefinidamente.
 *
 * Calibrada sobre el costo observado de una llamada de planificación real
 * (~0,02 USD con gpt-5-mini): conservadora sin volver imposible una ejecución normal.
 */
const UNKNOWN_ATTEMPT_RESERVE_USD = 0.05;

type DagResult = { root_execution_id: string; completed: string[]; failed: string[] };


const TIMING_MILESTONES = {
  EXECUTION_CREATED: "execution_created",
  PLAN_START: "PLAN_START",
  /** Se está llamando al modelo del socio director. Prueba de vida, no de avance. */
  PLAN_MODEL_ATTEMPT: "PLAN_MODEL_ATTEMPT",
  PLAN_MODEL_RESPONSE: "PLAN_MODEL_RESPONSE",
  PLAN_LLM_COMPLETE: "PLAN_LLM_COMPLETE",
  PLAN_COMPLETE: "PLAN_COMPLETE",
  TEAMPLAN_PARSED: "TEAMPLAN_PARSED",
  TEAMPLAN_VALIDATED: "TEAMPLAN_VALIDATED",
  DAG_CREATED: "DAG_CREATED",
  FIRST_SPECIALIST_DISPATCH: "FIRST_SPECIALIST_DISPATCH",
  SPECIALISTS_COMPLETE: "SPECIALISTS_COMPLETE",
  INTEGRATION_START: "INTEGRATION_START",
  INTEGRATION_COMPLETE: "INTEGRATION_COMPLETE",
  ROOT_COMPLETE: "ROOT_COMPLETE",
} as const;

/**
 * DAG jurídico sobre Cloudflare Workflows.
 *
 * Dos modos (feature flag `ORCHESTRATION_MODE`):
 *  - "pilot": DAG estático validado 00→01→03 (se conserva como fallback operacional).
 *  - "dynamic": el Managing Partner planifica el equipo (00 PLAN), el servidor valida
 *    el TeamPlan, se ejecutan los especialistas con dependencias y fan-in, y el 00
 *    INTEGRATE consolida. Con circuit breaker y presupuesto server-side.
 *
 * Los gates se evalúan aquí, de forma determinista. El modelo nunca decide si el DAG
 * puede avanzar, qué agentes existen, ni el scope/modelo/tools.
 */
export class MatterOrchestrationWorkflow extends WorkflowEntrypoint<
  Env,
  MatterOrchestrationParams
> {
  override async run(
    event: WorkflowEvent<MatterOrchestrationParams>,
    step: WorkflowStep,
  ): Promise<DagResult> {
    const dynamic = this.env.ORCHESTRATION_MODE === "dynamic";
    return dynamic ? this.runDynamic(event, step) : this.runPilot(event, step);
  }

  // ────────────────────────────────────────────────────────────────────────
  // RUTA PILOTO (validada en Bloques 7/7.5/7.6). Intacta como fallback.
  // ────────────────────────────────────────────────────────────────────────
  private async runPilot(
    event: WorkflowEvent<MatterOrchestrationParams>,
    step: WorkflowStep,
  ): Promise<DagResult> {
    const params = event.payload;
    const db = createDb(this.env.DB);
    const matters = new MatterRepository(db);
    const executions = new ExecutionRepository(db);
    const events = new ExecutionEventRepository(db);
    const documents = new DocumentRepository(db);
    const audit = new AuditRepository(db);

    const eventBase = {
      organizationId: params.organization_id,
      matterId: params.matter_id,
      rootExecutionId: params.root_execution_id,
    };

    const facts = new FactRepository(db);
    const authorities = new AuthorityRepository(db);

    const plan = await step.do("resolve-plan", async () => {
      const matter = await matters.findById(params.organization_id, params.matter_id);
      if (!matter) throw new Error(`Matter ${params.matter_id} no encontrado`);
      const nodes = planFor(matter.materiality as Materiality);
      const factRows = await facts.listForMatter(params.organization_id, params.matter_id);
      const authorityRows = await authorities.listForMatter(
        params.organization_id,
        params.matter_id,
      );
      return {
        materiality: matter.materiality as Materiality,
        jurisdiction: matter.jurisdiction,
        nodes: nodes.map((n) => ({ ...n, requires: [...n.requires] })) as DagNode[],
        lawyer_context: buildLawyerContext(matter, params.objective),
        facts: factRows.map((f) => ({
          fact_id: f.factKey,
          statement: f.statement,
          certainty: f.certainty,
          primary_source: f.primarySource,
        })),
        authorities: authorityRows.map((a) => ({
          authority_id: a.authorityKey,
          citation: a.citation,
          type: a.type,
          status: a.status,
        })),
      };
    });

    /** Cancelación server-side también en la ruta piloto (lectura directa, sin step). */
    const pilotCancelled = async (): Promise<boolean> => {
      const root = await executions.findById(params.root_execution_id);
      return !root || root.status === "CANCELLED";
    };

    await step.do("start-root-execution", async () => {
      await executions.transition(params.root_execution_id, "RUNNING");
    });

    await step.do("emit-execution-created", async () => {
      await events.append({
        ...eventBase,
        executionId: params.root_execution_id,
        type: "execution.created",
        status: "RUNNING",
        detail: { materiality: plan.materiality, node_count: plan.nodes.length },
      });
    });

    /*
      CONJUNTO DE EVIDENCIA CONGELADO.

      Se fija aquí, dentro de un `step.do`, así que sobrevive a los reintentos del
      workflow y vale lo mismo en el minuto cero que en el minuto doce. Antes cada
      misión preguntaba al expediente vivo: un documento que acabara de indexarse a los
      treinta segundos entraba a mitad de ejecución sin que nadie lo hubiera decidido, y
      el dictamen podía citar una fuente que no existía cuando el abogado pulsó el botón.
    */
    const sourceContext = await step.do("collect-authorized-sources", async () => {
      const docs = await documents.listForMatter(params.organization_id, params.matter_id);
      return { documentCount: docs.length, evidenceSet: freezeEvidenceSet(docs), sources: docs.map((d) => ({
        ref_id: d.id,
        kind: "DOCUMENT" as const,
        label: d.name,
        locator: d.driveFileId ? `drive://${d.driveFileId}` : `iusia://document/${d.id}`,
      })) };
    });

    const evidence = await step.do(
      "collect-rag-evidence",
      async (): Promise<DocumentExcerpt[]> => {
        if (sourceContext.documentCount === 0) return [];
        const docs = await documents.listForMatter(params.organization_id, params.matter_id);
        // Sólo los del conjunto congelado. Los nombres se leen ahora —cambiar el
        // nombre visible de un documento no altera qué se citó—, pero la pertenencia
        // la decidió el arranque.
        const frozen = new Set(sourceContext.evidenceSet.map((m) => m.document_id));
        return collectMatterEvidence({
          retrieval: new AiSearchRetrievalProvider(this.env.AI_SEARCH ?? null),
          organizationId: params.organization_id,
          matterId: params.matter_id,
          objective: params.objective,
          documentNames: new Map(
            docs.filter((d) => frozen.has(d.id)).map((d) => [d.id, d.name]),
          ),
          maxResults: 5,
        });
      },
    );

    await step.do("emit-rag-retrieval", async () => {
      if (sourceContext.documentCount === 0) return;
      await events.append({
        ...eventBase,
        executionId: params.root_execution_id,
        type: "agent.tool.called",
        status: "RUNNING",
        detail: {
          tool: "ai_search.retrieval",
          chunk_count: evidence.length,
          document_ids: [...new Set(evidence.map((e) => e.ref_id.split("#")[0] ?? e.ref_id))].join(","),
          query_source: "execution.objective",
          // El conjunto congelado queda escrito y ligado a la ejecución raíz: con esto
          // el análisis se puede reproducir, y se puede demostrar que un documento que
          // se indexó más tarde NO participó.
          evidence_set_size: sourceContext.evidenceSet.length,
          evidence_set: sourceContext.evidenceSet
            .map((m) => `${m.document_id}@v${m.version}`)
            .join(","),
        },
      });
    });

    const batches = dispatchBatches(plan.nodes);
    const completed: string[] = [];
    const failed: string[] = [];

    for (const [batchIndex, batch] of batches.entries()) {
      // Cancelar debe impedir NUEVOS despachos también en la ruta piloto.
      if (await step.do(`pilot-cancel-check-${batchIndex}`, pilotCancelled)) break;
      const results = await Promise.all(
        batch.map((node) =>
          step.do(
            `dispatch-${batchIndex}-${node.agent_id}`,
            { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }, timeout: "10 minutes" },
            async (): Promise<RunResult> => {
              const def = getAgentDefinition(node.agent_id);
              const executionId = await executions.create({
                organizationId: params.organization_id,
                matterId: params.matter_id,
                agentId: node.agent_id,
                parentExecutionId: params.root_execution_id,
                rootExecutionId: params.root_execution_id,
                startedBy: params.started_by,
                workflowInstanceId: event.instanceId,
                // Misma invariante que en la ruta dinámica: el reintento del step
                // reutiliza la ejecución en vez de duplicarla.
                dispatchKey: `${params.root_execution_id}:pilot:${node.agent_id}`,
              });
              await events.append({
                ...eventBase,
                executionId,
                type: "agent.dispatched",
                fromAgentId: node.agent_id === ORCHESTRATOR_AGENT_ID ? null : ORCHESTRATOR_AGENT_ID,
                toAgentId: node.agent_id,
                status: "PENDING",
                detail: { wave: node.wave, batch: batchIndex },
              });
              const workPackage: WorkPackage = {
                work_package_id: newId("workPackage"),
                matter_id: params.matter_id,
                execution_id: executionId,
                parent_execution_id: params.root_execution_id,
                agent_id: node.agent_id,
                objective: params.objective,
                questions: [],
                lawyer_provided_context: plan.lawyer_context,
                facts: plan.facts,
                authorities: plan.authorities,
                fact_refs: [],
                source_refs: sourceContext.sources,
                document_excerpts: evidence,
                upstream_outputs: [],
                constraints: [
                  sourceContext.documentCount === 0
                    ? "Este expediente no tiene documentación aportada: trabaja sobre los hechos informados por el abogado y señala qué requeriría prueba documental."
                    : "Trabaja únicamente con las fuentes autorizadas del WorkPackage.",
                  "Declara expresamente lo que no consta en el expediente.",
                ],
                expected_output_schema: def.output_schema_id,
                allowed_tools: def.tools_policy,
                jurisdiction: plan.jurisdiction,
                language: "es-CO",
                created_at: new Date().toISOString(),
              };
              const worker = await getAgentByName<Env, LegalWorker>(this.env.LegalWorker, executionId);
              return worker.run(workPackage);
            },
          ),
        ),
      );

      for (const r of results) {
        if (r.status === "COMPLETED") completed.push(r.execution_id);
        else failed.push(r.execution_id);
      }

      const wave = batch[0]!.wave as Wave;
      const isLastBatchOfWave =
        batchIndex === batches.length - 1 || batches[batchIndex + 1]!.some((n) => n.wave !== wave);

      if (isLastBatchOfWave) {
        const gateResult = await step.do(`gate-${wave}`, async () => {
          const rows = (await executions.listByRoot(params.root_execution_id)).filter(
            (r) => r.id !== params.root_execution_id,
          );
          const completedAgents = new Set(rows.filter((r) => r.status === "COMPLETED").map((r) => r.agentId));
          const failedAgents = new Set(rows.filter((r) => r.status === "FAILED").map((r) => r.agentId));
          return evaluateGate({
            wave,
            materiality: plan.materiality,
            requiredNodes: plan.nodes.filter((n) => n.wave === wave),
            completedAgentIds: completedAgents,
            failedAgentIds: failedAgents,
            humanApproval: null,
          });
        });

        await step.do(`gate-event-${wave}`, async () => {
          await events.append({
            ...eventBase,
            executionId: params.root_execution_id,
            type: gateResult.passed ? "gate.passed" : "gate.blocked",
            status: gateResult.passed ? "RUNNING" : "BLOCKED",
            detail: { gate: gateResult.gate, reason: gateResult.reason },
          });
        });

        if (!gateResult.passed && gateResult.requiresHumanApproval) {
          const approval = await step.waitForEvent<{ approved: boolean; user_id: string }>(
            `human-approval-${wave}`,
            { type: `gate.approval.${WAVE_GATE[wave]}`, timeout: "7 days" },
          );
          await step.do(`gate-approval-audit-${wave}`, async () => {
            await audit.record({
              organizationId: params.organization_id,
              matterId: params.matter_id,
              actorUserId: approval.payload.user_id,
              action: "gate.approval",
              resourceType: "gate",
              resourceId: WAVE_GATE[wave],
              outcome: approval.payload.approved ? "ALLOWED" : "DENIED",
              detail: { wave },
            });
          });
          if (!approval.payload.approved) break;
        } else if (!gateResult.passed) {
          break;
        }
      }
    }

    await step.do("close-root-execution", async () => {
      // Un resultado tardío NO puede resucitar una raíz ya cancelada.
      if (await pilotCancelled()) return;
      await executions.transition(
        params.root_execution_id,
        failed.length > 0 ? "FAILED" : "COMPLETED",
        failed.length > 0
          ? { errorCode: "DOWNSTREAM_EXECUTION_FAILED", errorMessage: `${failed.length} ejecución(es) de agente fallaron` }
          : {},
      );
    });

    await step.do("emit-execution-completed", async () => {
      await events.append({
        ...eventBase,
        executionId: params.root_execution_id,
        type: failed.length > 0 ? "execution.failed" : "execution.completed",
        status: failed.length > 0 ? "FAILED" : "COMPLETED",
        detail: { completed: completed.length, failed: failed.length },
      });
    });

    await step.do("notify-owner", async () => {
      const matter = await matters.findById(params.organization_id, params.matter_id);
      const email = await matters.ownerEmail(params.matter_id);
      if (!email) return;
      const svc = NotificationService.forEnv(this.env);
      await svc.notify({
        firm_id: params.organization_id,
        matter_id: params.matter_id,
        recipient: email,
        event: failed.length > 0 ? "EXECUTION_FAILED" : "EXECUTION_COMPLETED",
        execution_id: params.root_execution_id,
        correlation_id: event.instanceId,
        payload: { matter_reference: matter?.reference ?? params.matter_id, completed: completed.length, failed: failed.length },
      });
    });

    return { root_execution_id: params.root_execution_id, completed, failed };
  }

  // ────────────────────────────────────────────────────────────────────────
  // RUTA DINÁMICA (multiagente) — con circuit breaker y presupuesto server-side.
  // ────────────────────────────────────────────────────────────────────────
  private async runDynamic(
    event: WorkflowEvent<MatterOrchestrationParams>,
    step: WorkflowStep,
  ): Promise<DagResult> {
    const params = event.payload;
    const db = createDb(this.env.DB);
    const matters = new MatterRepository(db);
    const executions = new ExecutionRepository(db);
    const events = new ExecutionEventRepository(db);
    const documents = new DocumentRepository(db);
    const credits = new CreditRepository(db);
    const facts = new FactRepository(db);
    const authorities = new AuthorityRepository(db);

    const eventBase = {
      organizationId: params.organization_id,
      matterId: params.matter_id,
      rootExecutionId: params.root_execution_id,
    };
    const safety = new ExecutionSafetyLedger();
    const completed: string[] = [];
    const failed: string[] = [];
    let spentCredits = 0;

    const startedAtMs = await step.do("dyn-start", async () => {
      await executions.transition(params.root_execution_id, "RUNNING");
      await events.append({
        ...eventBase,
        executionId: params.root_execution_id,
        type: "execution.created",
        status: "RUNNING",
        detail: { mode: "dynamic" },
      });
      const now = Date.now();
      await events.append({
        ...eventBase,
        executionId: params.root_execution_id,
        type: "agent.milestone",
        status: "RUNNING",
        detail: { milestone: TIMING_MILESTONES.EXECUTION_CREATED, elapsed_ms: 0 },
      });
      return now;
    });

    const timing = (milestone: string, extra: Record<string, string | number | boolean> = {}) =>
      step.do(`dyn-timing-${milestone}`, async () => {
        await events.append({
          ...eventBase,
          executionId: params.root_execution_id,
          type: "agent.milestone",
          status: "RUNNING",
          detail: { milestone, elapsed_ms: Date.now() - startedAtMs, ...extra },
        });
      });

    // Cancelación server-side: re-lee la raíz antes de cada nueva llamada/despacho.
    //
    // `isCancelledNow` es una LECTURA DIRECTA, sin `step.do`. Es deliberado: el
    // Workflow no admite anidar steps, y la versión anterior llamaba a un step de
    // comprobación DENTRO del cuerpo del step de despacho. Ese anidamiento era la
    // causa real de que, tras terminar el 00 PLAN, pasaran minutos sin que apareciera
    // ningún especialista: el primer despacho quedaba atrapado y sólo avanzaba por
    // reintento. La comprobación sigue siendo server-side y sigue ocurriendo antes de
    // cada llamada al modelo; lo que cambia es que ya no crea un step anidado.
    const isCancelledNow = async (): Promise<boolean> => {
      const root = await executions.findById(params.root_execution_id);
      return !root || root.status === "CANCELLED";
    };
    /** Comprobación de cancelación como step propio. Sólo en el nivel superior. */
    const isCancelled = async (label: string): Promise<boolean> =>
      step.do(`dyn-cancel-check-${label}`, isCancelledNow);

    const abort = async (
      reason: CircuitBreakerReason,
      detail: string,
    ): Promise<DagResult> => {
      await step.do(`dyn-abort-${reason}`, async () => {
        const status = reason === "USER_CANCELLED" ? "CANCELLED" : "FAILED";
        const root = await executions.findById(params.root_execution_id);
        if (root && root.status !== "CANCELLED" && root.status !== "COMPLETED" && root.status !== "FAILED") {
          await executions.transition(params.root_execution_id, status, {
            errorCode: reason,
            errorMessage: detail,
          });
        }
        await events.append({
          ...eventBase,
          executionId: params.root_execution_id,
          type: reason === "USER_CANCELLED" ? "agent.cancelled" : "gate.blocked",
          status: reason === "USER_CANCELLED" ? "CANCELLED" : "BLOCKED",
          detail: { circuit_breaker_reason: reason, detail: detail.slice(0, 200) },
        });
        if (reason !== "USER_CANCELLED") {
          await events.append({
            ...eventBase,
            executionId: params.root_execution_id,
            type: "execution.failed",
            status: "FAILED",
            detail: { circuit_breaker_reason: reason, completed: completed.length },
          });
        }
      });
      return { root_execution_id: params.root_execution_id, completed, failed };
    };

    // Contexto del expediente.
    const ctx = await step.do("dyn-resolve-context", async () => {
      const matter = await matters.findById(params.organization_id, params.matter_id);
      if (!matter) throw new IusiaError("NOT_FOUND", `Matter ${params.matter_id} no encontrado`);
      const docs = await documents.listForMatter(params.organization_id, params.matter_id);
      const factRows = await facts.listForMatter(params.organization_id, params.matter_id);
      const authorityRows = await authorities.listForMatter(
        params.organization_id,
        params.matter_id,
      );
      return {
        materiality: matter.materiality as Materiality,
        jurisdiction: matter.jurisdiction,
        title: matter.title,
        practice_areas: matter.practiceAreas ?? [],
        document_count: docs.length,
        document_summary: docs.map((d) => `${d.name} (${d.classification})`),
        // El conjunto de evidencia se congela aquí, dentro del `step.do`, por la misma
        // razón que en la ruta piloto: lo que se cita no puede depender del minuto en
        // que cada misión llegue a preguntar.
        evidence_set: freezeEvidenceSet(docs),
        document_names: docs
          .filter((d) => d.ingestionStatus === "AI_INDEXED" && !d.retiredAt)
          .map((d) => [d.id, d.name] as const),
        // GROUNDING PACKAGE. El relato del abogado es contexto legítimo: un
        // expediente sin documentos NO es un expediente sin información.
        lawyer_context: buildLawyerContext(matter, params.objective),
        facts: factRows.map((f) => ({
          fact_id: f.factKey,
          statement: f.statement,
          certainty: f.certainty,
          primary_source: f.primarySource,
        })),
        authorities: authorityRows.map((a) => ({
          authority_id: a.authorityKey,
          citation: a.citation,
          type: a.type,
          status: a.status,
        })),
      };
    });
    const documentNames = new Map(ctx.document_names);
    /*
      Lo que se puede CITAR, que no es lo mismo que lo que hay en el expediente. Un
      expediente con tres imágenes tiene tres documentos y cero evidencia: preguntarle
      al índice por ellos es gastar una llamada para no encontrar nada, y presentarlos
      como fuentes disponibles le promete al abogado algo que no va a recibir.
    */
    const evidenceCount = ctx.evidence_set.length;

    if (await isCancelled("pre-plan")) return abort("USER_CANCELLED", "cancelado antes de planificar");

    // ── FASE 00 PLAN ──
    const orchestratorDef = getAgentDefinition(ORCHESTRATOR_AGENT_ID);
    await timing(TIMING_MILESTONES.PLAN_START, { document_count: ctx.document_count });
    const planExecutionId = await step.do("dyn-create-plan-exec", async () =>
      executions.create({
        organizationId: params.organization_id,
        matterId: params.matter_id,
        agentId: ORCHESTRATOR_AGENT_ID,
        parentExecutionId: params.root_execution_id,
        rootExecutionId: params.root_execution_id,
        startedBy: params.started_by,
        workflowInstanceId: event.instanceId,
        dispatchKey: `${params.root_execution_id}:plan`,
      }),
    );

    // Reintentos ACOTADOS. Sin opciones, `step.do` hereda la política por defecto del
    // motor y este paso quedó reintentando en bucle durante minutos con la raíz en
    // RUNNING: para el abogado, una rueda girando para siempre. Un plan que no sale en
    // tres intentos no va a salir en el décimo, y cada intento cuesta dinero real.
    const planned = await this.planWithFailureClosed(step, abort, async () => {
      // Planificación ACOTADA. La medida histórica de esta llamada en staging es
      // 33–127 s (mediana 79 s) contra un modelo de razonamiento. Con los valores por
      // defecto —300 s por intento, 3 intentos, 2 candidatos— el silencio podía
      // llegar a media hora; ningún abogado espera eso, y de hecho ninguno esperó.
      // 180 s da holgura sobre el peor caso observado y acota el total a ~12 min,
      // tras los cuales el SAFE_FALLBACK determinista garantiza que haya equipo.
      const gateway = new ModelGateway(this.env, {
        requestTimeoutMs: ORCHESTRATION_LIMITS.PLANNER_REQUEST_TIMEOUT_MS,
        maxAttemptsPerCandidate: ORCHESTRATION_LIMITS.PLANNER_MAX_ATTEMPTS_PER_CANDIDATE,
      });
      const brief: MatterBrief = {
        title: ctx.title,
        materiality: ctx.materiality,
        jurisdiction: ctx.jurisdiction,
        practice_areas: ctx.practice_areas,
        document_summary: ctx.document_summary,
      };
      let usage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 };
      let provider = "";
      let model = "";
      /** Costo REAL de la fase, incluidos los intentos que no sirvieron. */
      let settledCostUsd = 0;
      const result = await planTeam({
        objective: params.objective,
        brief,
        catalog: buildAgentCatalog(),
        eligible: eligibleAgentIds(),
        runModel: async (messages) => {
          const r = await gateway.complete(
            applyRouting(
              orchestratorDef.model_policy,
              routeModel({ taskClass: "PLAN", materiality: ctx.materiality }),
            ),
            messages,
            {
              organization_id: params.organization_id,
              matter_id: params.matter_id,
              agent_id: ORCHESTRATOR_AGENT_ID,
              execution_id: planExecutionId,
            },
            {
              // Cada intento real del planner se cobra en cuanto ocurre. Los ocho
              // intentos fallidos del 1-sep no dejaron rastro económico porque el
              // costo sólo se registraba al completar.
              onSettled: async (settledAttempt) => {
                await credits.post({
                  organizationId: params.organization_id,
                  kind: "CONSUMPTION",
                  amount:
                    settledAttempt.provider_cost_usd === null
                      ? 0
                      : -creditsForCost(settledAttempt.provider_cost_usd),
                  idempotencyKey: attemptIdempotencyKey(planExecutionId, settledAttempt),
                  matterId: params.matter_id,
                  executionId: planExecutionId,
                  userId: params.started_by,
                  provider: settledAttempt.provider,
                  model: settledAttempt.model,
                  providerCostUsd: settledAttempt.provider_cost_usd,
                  allowNegative: true,
                });
                settledCostUsd += settledAttempt.provider_cost_usd ?? 0;
                await events.append({
                  ...eventBase,
                  executionId: planExecutionId,
                  type: "agent.tool.called",
                  status: settledAttempt.outcome === "SUCCESS" ? "RUNNING" : "FAILED",
                  detail: {
                    tool: "model.attempt",
                    phase: "plan",
                    provider: settledAttempt.provider,
                    model: settledAttempt.model,
                    outcome: settledAttempt.outcome,
                    latency_ms: settledAttempt.latency_ms,
                    output_tokens: settledAttempt.usage?.output_tokens ?? 0,
                    reasoning_tokens: settledAttempt.usage?.reasoning_tokens ?? 0,
                    cost_known: settledAttempt.provider_cost_usd !== null,
                    provider_cost_usd: settledAttempt.provider_cost_usd ?? 0,
                  },
                });
              },
              // Evidencia de vida durante la planificación: sin esto el ledger
              // callaba entre PLAN_START y PLAN_LLM_COMPLETE, y la UI se quedaba
              // clavada en "Identificando los especialistas" durante minutos.
              onAttempt: async (info) => {
                await events.append({
                  ...eventBase,
                  executionId: planExecutionId,
                  type: "agent.milestone",
                  status: "RUNNING",
                  detail: {
                    milestone: TIMING_MILESTONES.PLAN_MODEL_ATTEMPT,
                    elapsed_ms: Date.now() - startedAtMs,
                    provider: info.provider,
                    model: info.model,
                    attempt: info.attempt,
                  },
                });
              },
              onResponse: async (info) => {
                await events.append({
                  ...eventBase,
                  executionId: planExecutionId,
                  type: "agent.milestone",
                  status: "RUNNING",
                  detail: {
                    milestone: TIMING_MILESTONES.PLAN_MODEL_RESPONSE,
                    elapsed_ms: Date.now() - startedAtMs,
                    model_duration_ms: info.durationMs,
                    provider: info.provider,
                    model: info.model,
                  },
                });
              },
            },
          );
          usage = {
            input_tokens: usage.input_tokens + r.usage.input_tokens,
            output_tokens: usage.output_tokens + r.usage.output_tokens,
            cached_input_tokens: usage.cached_input_tokens + r.usage.cached_input_tokens,
          };
          provider = r.provider;
          model = r.model;
          return r.text;
        },
        fallback: () =>
          buildFallbackTeamPlan(
            { objective: params.objective, materiality: ctx.materiality, practice_areas: ctx.practice_areas },
            [orchestratorDef, ...buildAgentCatalog().map((c) => getAgentDefinition(c.agent_id))],
          ),
      });
      await events.append({
        ...eventBase,
        executionId: params.root_execution_id,
        type: "agent.milestone",
        status: "RUNNING",
        detail: {
          milestone: TIMING_MILESTONES.PLAN_LLM_COMPLETE,
          elapsed_ms: Date.now() - startedAtMs,
          plan_source: result.source,
        },
      });
      await events.append({
        ...eventBase,
        executionId: params.root_execution_id,
        type: "agent.milestone",
        status: "RUNNING",
        detail: {
          milestone: TIMING_MILESTONES.TEAMPLAN_PARSED,
          elapsed_ms: Date.now() - startedAtMs,
          specialist_count: result.plan.tasks.length,
        },
      });
      await events.append({
        ...eventBase,
        executionId: params.root_execution_id,
        type: "agent.milestone",
        status: "RUNNING",
        detail: {
          milestone: TIMING_MILESTONES.TEAMPLAN_VALIDATED,
          elapsed_ms: Date.now() - startedAtMs,
          validation_error_count: result.validation_errors.length,
        },
      });

      // Persistir el TeamPlan como artefacto de control + costear la planificación.
      const outputRef = `executions/${params.organization_id}/${params.matter_id}/${planExecutionId}.json`;
      await this.env.ARTIFACTS.put(
        outputRef,
        JSON.stringify({ kind: "team_plan", plan_source: result.source, plan: result.plan }),
        { httpMetadata: { contentType: "application/json" } },
      );
      // El cobro ya ocurrió intento a intento en `onSettled`; aquí sólo se totaliza
      // lo que consumió la fase, éxitos y fallos incluidos.
      const costUsd = settledCostUsd;
      const creditsUsed = creditsForCost(costUsd);
      await executions.transition(planExecutionId, "RUNNING");
      await executions.transition(planExecutionId, "COMPLETED", {
        provider,
        model,
        outputRef,
        outputType: "STRATEGY",
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        providerCostUsd: costUsd,
        creditsConsumed: creditsUsed,
      });
      await events.append({
        ...eventBase,
        executionId: planExecutionId,
        type: "agent.dispatched",
        toAgentId: ORCHESTRATOR_AGENT_ID,
        status: "COMPLETED",
        detail: { phase: "plan", plan_source: result.source, specialist_count: result.plan.tasks.length },
      });
      await events.append({
        ...eventBase,
        executionId: planExecutionId,
        type: "agent.output.received",
        toAgentId: ORCHESTRATOR_AGENT_ID,
        status: "COMPLETED",
        detail: { phase: "plan", credits: creditsUsed },
      });
      // Instante en que la fase PLAN queda REALMENTE cerrada. Es el ancla de
      // POST_PLAN_DELAY_MS: la latencia entre que el Managing Partner termina y el
      // primer especialista se despacha es la métrica que delató el step anidado.
      await events.append({
        ...eventBase,
        executionId: params.root_execution_id,
        type: "agent.milestone",
        status: "RUNNING",
        detail: {
          milestone: TIMING_MILESTONES.PLAN_COMPLETE,
          elapsed_ms: Date.now() - startedAtMs,
        },
      });
      return { plan: result.plan, source: result.source, creditsUsed, planCompletedAtMs: Date.now() };
    });
    if (!planned) {
      return { root_execution_id: params.root_execution_id, completed, failed };
    }

    spentCredits += planned.creditsUsed;
    const plan: TeamPlan = planned.plan;
    const taskByAgent = new Map<string, TeamPlanTask>(plan.tasks.map((t) => [t.agent_id, t]));

    const planGuard = safety.registerPlanOrIntegration("plan");
    if (!planGuard.ok) return abort(planGuard.reason, planGuard.detail);

    // ── Presupuesto de la root ──
    const estimatedRemaining = plan.tasks.length + 1; // specialists + INTEGRATE
    const hardBudget = computeRootCreditBudget({
      estimatedExecutions: estimatedRemaining + 1,
      perExecutionCredits: ESTIMATED_CREDITS_PER_RUN,
      configuredRootLimit: Number(this.env.ROOT_CREDIT_LIMIT ?? DEFAULT_ROOT_CREDIT_LIMIT),
    });
    const balanceOk = await step.do("dyn-budget-check", async () => {
      const balance = await credits.balance(params.organization_id);
      return balance >= estimatedRemaining * ESTIMATED_CREDITS_PER_RUN;
    });
    if (!balanceOk) return abort("CREDIT_BUDGET_EXCEEDED", "saldo insuficiente para el equipo planificado");

    // ── DAG dinámico ──
    const providerCostBudgetUsd = Number(
      this.env.ROOT_PROVIDER_COST_BUDGET_USD ?? DEFAULT_ROOT_PROVIDER_COST_BUDGET_USD,
    );
    /**
     * Costo de proveedor YA consumido por esta raíz, según el Credit Ledger — que
     * ahora incluye los intentos fallidos. Leerlo de `executions.provider_cost_usd`
     * dejaba fuera precisamente lo que hay que vigilar: el dinero gastado en fallar.
     *
     * Los asientos de costo DESCONOCIDO (timeout, corte de red) no se ignoran: cada
     * uno computa una reserva conservadora, de modo que una cadena de fallos sin
     * usage tampoco puede gastar sin límite.
     */
    const providerCostSoFar = async (): Promise<number> => {
      const rows = await executions.listByRoot(params.root_execution_id);
      const { knownUsd, unknownAttempts } = await credits.providerCostForExecutions(
        params.organization_id,
        rows.map((r) => r.id),
      );
      return knownUsd + unknownAttempts * UNKNOWN_ATTEMPT_RESERVE_USD;
    };

    const nodes = teamPlanToDag(plan);
    const batches = dispatchBatches(nodes);
    await timing(TIMING_MILESTONES.DAG_CREATED, { node_count: nodes.length, batch_count: batches.length });
    const outputByAgent = new Map<string, { execution_id: string; output_ref: string; output_type: string }>();
    let firstSpecialistDispatchEmitted = false;

    for (const [batchIndex, batch] of batches.entries()) {
      if (await isCancelled(`batch-${batchIndex}`)) return abort("USER_CANCELLED", "cancelado durante la ejecución");

      const elapsedMin = (await step.do(`dyn-clock-${batchIndex}`, async () => Date.now())) - startedAtMs;
      if (elapsedMin / 60000 > ORCHESTRATION_LIMITS.MAX_ROOT_WALL_TIME_MINUTES) {
        return abort("WALL_TIME_EXCEEDED", `> ${ORCHESTRATION_LIMITS.MAX_ROOT_WALL_TIME_MINUTES} min`);
      }

      // Cap de concurrencia real: subdividir el batch en chunks ≤ MAX_PARALLEL_AGENTS.
      for (let i = 0; i < batch.length; i += ORCHESTRATION_LIMITS.MAX_PARALLEL_AGENTS) {
        const chunk = batch.slice(i, i + ORCHESTRATION_LIMITS.MAX_PARALLEL_AGENTS);
        const parGuard = safety.checkParallelBatch(chunk.length);
        if (!parGuard.ok) return abort(parGuard.reason, parGuard.detail);

        // Guardas por task antes de despachar (duplicados, ejecuciones, presupuesto).
        for (const node of chunk) {
          const task = taskByAgent.get(node.agent_id);
          if (!task) return abort("PLAN_VIOLATION", `nodo fuera del TeamPlan: ${node.agent_id}`);
          const g = safety.registerTask({
            taskId: task.task_id,
            agentId: node.agent_id,
            mission: task.mission,
            matterId: params.matter_id,
          });
          if (!g.ok) return abort(g.reason, g.detail);
          if (!canAffordNextExecution({ spentCredits, nextEstimatedCredits: ESTIMATED_CREDITS_PER_RUN, hardBudget })) {
            return abort("CREDIT_BUDGET_EXCEEDED", `presupuesto ${hardBudget} agotado`);
          }
          // Dinero real, no créditos comerciales: se lee del ledger antes de gastar más.
          const spentUsd = await step.do(`dyn-cost-${task.task_id}`, providerCostSoFar);
          if (spentUsd >= providerCostBudgetUsd) {
            return abort(
              "CREDIT_BUDGET_EXCEEDED",
              `costo de proveedor ${spentUsd.toFixed(4)} USD alcanzó el techo de ${providerCostBudgetUsd} USD`,
            );
          }
          for (const depAgent of node.requires) {
            const t = safety.registerTransfer(depAgent, node.agent_id);
            if (!t.ok) return abort(t.reason, t.detail);
          }
        }

        const results = await Promise.all(
          chunk.map((node) => {
            const task = taskByAgent.get(node.agent_id)!;
            // Dependencias resueltas (ya ejecutadas en batches previos, topológico).
            const deps = node.requires
              .map((depAgent) => {
                const o = outputByAgent.get(depAgent);
                return o ? { agent_id: depAgent, ...o } : null;
              })
              .filter((d): d is NonNullable<typeof d> => Boolean(d));
            return step.do(
              `dyn-dispatch-${batchIndex}-${node.agent_id}`,
              { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }, timeout: "10 minutes" },
              async (): Promise<RunResult & { agent_id: string; output_ref: string | null }> => {
                // Lectura directa: anidar un `step.do` aquí dejaba el despacho colgado.
                if (await isCancelledNow()) {
                  return { execution_id: "", status: "CANCELLED", output_ref: null, credits_consumed: 0, agent_id: node.agent_id };
                }
                if (!firstSpecialistDispatchEmitted) {
                  firstSpecialistDispatchEmitted = true;
                  await events.append({
                    ...eventBase,
                    executionId: params.root_execution_id,
                    type: "agent.milestone",
                    status: "RUNNING",
                    detail: {
                      milestone: TIMING_MILESTONES.FIRST_SPECIALIST_DISPATCH,
                      elapsed_ms: Date.now() - startedAtMs,
                      // Latencia entre el cierre del PLAN y el primer despacho real.
                      // Debe ser de segundos; minutos delatan una espera indebida.
                      post_plan_delay_ms: Date.now() - planned.planCompletedAtMs,
                      agent_id: node.agent_id,
                    },
                  });
                }
                const def = getAgentDefinition(node.agent_id);
                // Identidad LÓGICA del despacho: si el step se reintenta, se reutiliza
                // esta misma ejecución (y su clave de idempotencia de créditos) en vez
                // de crear una fila nueva. Un reintento técnico no es una ejecución
                // jurídica nueva.
                const executionId = await executions.create({
                  organizationId: params.organization_id,
                  matterId: params.matter_id,
                  agentId: node.agent_id,
                  parentExecutionId: params.root_execution_id,
                  rootExecutionId: params.root_execution_id,
                  startedBy: params.started_by,
                  workflowInstanceId: event.instanceId,
                  dispatchKey: `${params.root_execution_id}:task:${task.task_id}`,
                });
                await events.append({
                  ...eventBase,
                  executionId,
                  type: "agent.dispatched",
                  fromAgentId: ORCHESTRATOR_AGENT_ID,
                  toAgentId: node.agent_id,
                  status: "PENDING",
                  detail: {
                    phase: "specialist",
                    task_id: task.task_id,
                    why_selected: task.why_selected.slice(0, 200),
                    depends_on: node.requires.join(","),
                  },
                });
                // Transferencias de dependencias (fan-in parcial specialist→specialist).
                for (const depAgent of node.requires) {
                  await events.append({
                    ...eventBase,
                    executionId,
                    type: "message.transferred",
                    fromAgentId: depAgent,
                    toAgentId: node.agent_id,
                    status: "RUNNING",
                    detail: { task_id: task.task_id },
                  });
                }
                // Upstream outputs reales (leídos de R2, acotados).
                const resolvedUpstream: UpstreamOutputRef[] = [];
                for (const dep of deps) {
                  resolvedUpstream.push({
                    execution_id: dep.execution_id,
                    agent_id: dep.agent_id,
                    output_type: dep.output_type,
                    output_ref: dep.output_ref,
                    summary: await this.readUpstreamSummary(dep.output_ref),
                  });
                }
                // RAG por misión.
                const excerpts = evidenceCount === 0
                  ? []
                  : await collectMatterEvidence({
                      retrieval: new AiSearchRetrievalProvider(this.env.AI_SEARCH ?? null),
                      organizationId: params.organization_id,
                      matterId: params.matter_id,
                      objective: `${task.mission} ${task.questions.join(" ")}`.trim(),
                      documentNames,
                      maxResults: 5,
                    });
                if (evidenceCount > 0) {
                  await events.append({
                    ...eventBase,
                    executionId,
                    type: "agent.tool.called",
                    status: "RUNNING",
                    detail: {
                      tool: "ai_search.retrieval",
                      chunk_count: excerpts.length,
                      document_ids: [...new Set(excerpts.map((e) => e.ref_id.split("#")[0] ?? e.ref_id))].join(","),
                      query_source: "task.mission",
                    },
                  });
                }
                const workPackage: WorkPackage = {
                  work_package_id: newId("workPackage"),
                  matter_id: params.matter_id,
                  execution_id: executionId,
                  parent_execution_id: params.root_execution_id,
                  agent_id: node.agent_id,
                  objective: task.mission,
                  questions: task.questions,
                  // GROUNDING PACKAGE: cada fuente etiquetada por separado.
                  lawyer_provided_context: ctx.lawyer_context,
                  facts: ctx.facts,
                  authorities: ctx.authorities,
                  fact_refs: [],
                  source_refs: [],
                  document_excerpts: excerpts,
                  upstream_outputs: resolvedUpstream,
                  constraints: [
                    `Contexto del encargo global (subordinado a tu rol): ${params.objective}`,
                    // Un expediente con tres imágenes tiene documentos y no tiene
                    // evidencia. Decirle al especialista «no se recuperó soporte
                    // relevante» le hace suponer que buscó y no encontró, cuando en
                    // realidad no había nada que buscar.
                    evidenceCount === 0
                      ? ctx.document_count === 0
                        ? "Este expediente no tiene documentación aportada: trabaja sobre los hechos informados por el abogado, califícalos como tales y señala qué requeriría prueba documental. La ausencia de documentos NO te impide emitir tu análisis."
                        : "El expediente tiene documentos, pero ninguno es analizable por su formato: trabaja sobre los hechos informados, dilo expresamente y señala qué requeriría prueba documental."
                      : excerpts.length === 0
                        ? "No se recuperó soporte documental relevante para tu misión: trabaja sobre los hechos informados y dilo expresamente. No supongas el contenido de los documentos del expediente."
                        : "Trabaja únicamente con la evidencia autorizada del WorkPackage.",
                    "Declara expresamente lo que no consta en el expediente.",
                  ],
                  expected_output_schema: def.output_schema_id,
                  allowed_tools: def.tools_policy,
                  jurisdiction: ctx.jurisdiction,
                  language: "es-CO",
                  created_at: new Date().toISOString(),
                  task_class: "SPECIALIST",
                  materiality: ctx.materiality,
                };
                const worker = await getAgentByName<Env, LegalWorker>(this.env.LegalWorker, executionId);
                const rr = await worker.run(workPackage);
                return { ...rr, agent_id: node.agent_id, output_ref: rr.output_ref };
              },
            );
          }),
        );

        for (const r of results) {
          if (r.status === "CANCELLED") continue;
          spentCredits += r.credits_consumed;
          if (r.status === "COMPLETED") {
            completed.push(r.execution_id);
            if (r.output_ref) {
              outputByAgent.set(r.agent_id, {
                execution_id: r.execution_id,
                output_ref: r.output_ref,
                output_type: getAgentDefinition(r.agent_id).output_type,
              });
            }
          } else {
            failed.push(r.execution_id);
          }
        }
        if (await isCancelled(`post-batch-${batchIndex}-${i}`)) {
          return abort("USER_CANCELLED", "cancelado después de una respuesta tardía");
        }
      }

      // Gate de la ola (determinista). Un required fallido bloquea.
      const wave = batch[0]!.wave as Wave;
      const isLastBatchOfWave =
        batchIndex === batches.length - 1 || batches[batchIndex + 1]!.some((n) => n.wave !== wave);
      if (isLastBatchOfWave) {
        const gateResult = await step.do(`dyn-gate-${wave}`, async () => {
          const rows = (await executions.listByRoot(params.root_execution_id)).filter(
            (r) => r.id !== params.root_execution_id && r.id !== planExecutionId,
          );
          const completedAgents = new Set(rows.filter((r) => r.status === "COMPLETED").map((r) => r.agentId));
          const failedAgents = new Set(rows.filter((r) => r.status === "FAILED").map((r) => r.agentId));
          const requiredNodes = nodes.filter(
            (n) => n.wave === wave && (taskByAgent.get(n.agent_id)?.required ?? true),
          );
          return evaluateGate({
            wave,
            materiality: ctx.materiality,
            requiredNodes,
            completedAgentIds: completedAgents,
            failedAgentIds: failedAgents,
            humanApproval: null,
          });
        });
        await step.do(`dyn-gate-event-${wave}`, async () => {
          await events.append({
            ...eventBase,
            executionId: params.root_execution_id,
            type: gateResult.passed ? "gate.passed" : "gate.blocked",
            status: gateResult.passed ? "RUNNING" : "BLOCKED",
            detail: { gate: gateResult.gate, reason: gateResult.reason },
          });
        });
        if (!gateResult.passed) {
          return abort("PLAN_VIOLATION", `gate ${gateResult.gate}: ${gateResult.reason}`);
        }
      }
    }

    if (await isCancelled("pre-integrate")) return abort("USER_CANCELLED", "cancelado antes de integrar");
    await timing(TIMING_MILESTONES.SPECIALISTS_COMPLETE, { completed: completed.length, failed: failed.length });

    // ── FASE 00 INTEGRATE (usa el agent.md canónico del 00, sin modificarlo) ──
    const intGuard = safety.registerPlanOrIntegration("integration");
    if (!intGuard.ok) return abort(intGuard.reason, intGuard.detail);
    if (!canAffordNextExecution({ spentCredits, nextEstimatedCredits: ESTIMATED_CREDITS_PER_RUN, hardBudget })) {
      return abort("CREDIT_BUDGET_EXCEEDED", `presupuesto ${hardBudget} agotado antes de integrar`);
    }
    const spentBeforeIntegration = await step.do("dyn-cost-integrate", providerCostSoFar);
    if (spentBeforeIntegration >= providerCostBudgetUsd) {
      return abort(
        "CREDIT_BUDGET_EXCEEDED",
        `costo de proveedor ${spentBeforeIntegration.toFixed(4)} USD alcanzó el techo antes de integrar`,
      );
    }

    const integration = await step.do(
      "dyn-integrate",
      { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }, timeout: "10 minutes" },
      async (): Promise<RunResult> => {
        await events.append({
          ...eventBase,
          executionId: params.root_execution_id,
          type: "agent.milestone",
          status: "RUNNING",
          detail: { milestone: TIMING_MILESTONES.INTEGRATION_START, elapsed_ms: Date.now() - startedAtMs },
        });
        const executionId = await executions.create({
          organizationId: params.organization_id,
          matterId: params.matter_id,
          agentId: ORCHESTRATOR_AGENT_ID,
          parentExecutionId: params.root_execution_id,
          rootExecutionId: params.root_execution_id,
          startedBy: params.started_by,
          workflowInstanceId: event.instanceId,
          dispatchKey: `${params.root_execution_id}:integrate`,
        });
        await events.append({
          ...eventBase,
          executionId,
          type: "agent.started",
          toAgentId: ORCHESTRATOR_AGENT_ID,
          status: "RUNNING",
          detail: { phase: "integrate" },
        });
        // Fan-in: todos los outputs de especialistas como upstream (no confiables).
        const upstream: UpstreamOutputRef[] = [];
        for (const [agentId, o] of outputByAgent.entries()) {
          upstream.push({
            execution_id: o.execution_id,
            agent_id: agentId,
            output_type: o.output_type,
            output_ref: o.output_ref,
            summary: await this.readUpstreamSummary(o.output_ref),
          });
        }
        const excerpts = evidenceCount === 0
          ? []
          : await collectMatterEvidence({
              retrieval: new AiSearchRetrievalProvider(this.env.AI_SEARCH ?? null),
              organizationId: params.organization_id,
              matterId: params.matter_id,
              objective: params.objective,
              documentNames,
              maxResults: 5,
            });
        const def = getAgentDefinition(ORCHESTRATOR_AGENT_ID);
        const workPackage: WorkPackage = {
          work_package_id: newId("workPackage"),
          matter_id: params.matter_id,
          execution_id: executionId,
          parent_execution_id: params.root_execution_id,
          agent_id: ORCHESTRATOR_AGENT_ID,
          objective: params.objective,
          questions: [],
          lawyer_provided_context: ctx.lawyer_context,
          facts: ctx.facts,
          authorities: ctx.authorities,
          fact_refs: [],
          source_refs: [],
          document_excerpts: excerpts,
          upstream_outputs: upstream,
          constraints: [
            "Integra los hallazgos de los especialistas: compara, detecta contradicciones y prioriza la evidencia del expediente.",
            evidenceCount === 0
              ? ctx.document_count === 0
                ? "Este análisis se basa en los hechos informados en el expediente y deberá contrastarse con la documentación que posteriormente se aporte. Dilo expresamente en tu conclusión."
                : "El expediente tiene documentos aportados, pero ninguno pudo incorporarse al análisis por su formato. Apoya las conclusiones en los hechos informados y dilo expresamente."
              : excerpts.length === 0
                ? "No se recuperó soporte documental relevante: apoya las conclusiones en los hechos informados y declara la ausencia de soporte documental."
                : "Usa la evidencia documental recuperada únicamente cuando exista en el WorkPackage.",
            "No asumas que un especialista tiene razón; marca la incertidumbre y la evidencia faltante.",
            failed.length > 0 ? `Ejecuciones fallidas: ${failed.length} (repórtalas).` : "Todas las tareas requeridas se completaron.",
          ],
          expected_output_schema: def.output_schema_id,
          allowed_tools: def.tools_policy,
          jurisdiction: ctx.jurisdiction,
          language: "es-CO",
          created_at: new Date().toISOString(),
          task_class: "INTEGRATION",
          materiality: ctx.materiality,
        };
        const worker = await getAgentByName<Env, LegalWorker>(this.env.LegalWorker, executionId);
        return worker.run(workPackage);
      },
    );
    if (await isCancelled("post-integrate")) return abort("USER_CANCELLED", "cancelado después de integrar");
    spentCredits += integration.credits_consumed;
    if (integration.status === "COMPLETED") completed.push(integration.execution_id);
    else failed.push(integration.execution_id);

    await step.do("dyn-close-root", async () => {
      // Idem: si la raíz se canceló mientras integrábamos, el cierre no la reabre.
      if (await isCancelledNow()) return;
      await executions.transition(
        params.root_execution_id,
        integration.status === "COMPLETED" ? "COMPLETED" : "FAILED",
        integration.status === "COMPLETED"
          ? {}
          : { errorCode: "INTEGRATION_FAILED", errorMessage: "la integración final falló" },
      );
      await events.append({
        ...eventBase,
        executionId: params.root_execution_id,
        type: integration.status === "COMPLETED" ? "execution.completed" : "execution.failed",
        status: integration.status === "COMPLETED" ? "COMPLETED" : "FAILED",
        detail: {
          completed: completed.length,
          failed: failed.length,
          specialists: outputByAgent.size,
          spent_credits: spentCredits,
        },
      });
      await events.append({
        ...eventBase,
        executionId: params.root_execution_id,
        type: "agent.milestone",
        status: integration.status === "COMPLETED" ? "COMPLETED" : "FAILED",
        detail: {
          milestone: TIMING_MILESTONES.INTEGRATION_COMPLETE,
          elapsed_ms: Date.now() - startedAtMs,
        },
      });
      await events.append({
        ...eventBase,
        executionId: params.root_execution_id,
        type: "agent.milestone",
        status: integration.status === "COMPLETED" ? "COMPLETED" : "FAILED",
        detail: {
          milestone: TIMING_MILESTONES.ROOT_COMPLETE,
          elapsed_ms: Date.now() - startedAtMs,
        },
      });
    });

    return { root_execution_id: params.root_execution_id, completed, failed };
  }


  /**
   * Ejecuta la fase de planificación con reintentos ACOTADOS y cierre explícito.
   *
   * Sin opciones, `step.do` hereda la política de reintento por defecto del motor: en
   * el incidente del 1-sep el paso se repitió durante minutos con la raíz en RUNNING
   * —una rueda girando para siempre en la pantalla del abogado— y cada intento
   * costaba dinero real. Peor: cuando el paso agota sus intentos, la excepción sale
   * de `run()` y NADIE cierra la raíz, que se queda RUNNING indefinidamente.
   *
   * Aquí el fallo se convierte en un final explícito y recuperable: la raíz pasa a
   * FAILED con su causa y el producto puede decir qué ocurrió.
   */
  private async planWithFailureClosed<T extends Rpc.Serializable<T>>(
    step: WorkflowStep,
    abort: (reason: CircuitBreakerReason, detail: string) => Promise<DagResult>,
    body: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return (await step.do(
        "dyn-plan",
        { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "10 minutes" },
        body,
      )) as T;
    } catch (error) {
      await abort(
        "PLAN_VIOLATION",
        error instanceof Error ? error.message : "la planificación falló sin causa legible",
      );
      return null;
    }
  }

  /** Lee un output de especialista desde R2 y devuelve un resumen humano acotado. */
  private async readUpstreamSummary(outputRef: string): Promise<string> {
    try {
      const obj = await this.env.ARTIFACTS.get(outputRef);
      if (!obj) return "";
      const stored = await obj.json<{ text?: string }>();
      return deriveConclusionText(stored.text ?? "").slice(0, ORCHESTRATION_LIMITS.MAX_UPSTREAM_OUTPUT_SIZE);
    } catch {
      return "";
    }
  }
}
