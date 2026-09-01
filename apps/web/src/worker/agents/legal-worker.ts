import { Agent } from "agents";
import {
  IusiaError,
  applyRouting,
  attemptIdempotencyKey,
  routeModel,
  creditsForCost,
  authorizedRefsOf,
  envelopeFieldsFor,
  extractEnvelope,
  projectEnvelope,
  renderWorkPackage,
  riskLevelFrom,
  stripEnvelope,
  type ExecutionStatus,
  type ExtractedEnvelope,
  type ProjectionResult,
  type ProviderAttempt,
  type WorkPackage,
} from "@iusia/domain";
import { getAgentDefinition, PromptLoader, R2PromptSource } from "@iusia/agents";
import {
  AuditRepository,
  AuthorityRepository,
  CreditRepository,
  ExecutionEventRepository,
  ExecutionRepository,
  FactRepository,
  MatterRepository,
  TaskRepository,
  createDb,
} from "@iusia/db";
import type { Env } from "../env.js";
import { ModelGateway } from "../services/model-gateway.js";
import { UNTRUSTED_SYSTEM_GUARD } from "./guards.js";

/** Nodo integrador del DAG. Las aristas del grafo convergen y salen de él. */
const ORCHESTRATOR_AGENT_ID = "pisoso-orquestador-juridico";

/**
 * LegalWorker — runtime genérico de agentes de IUSIA.
 *
 * NO existe una clase por agente. Existe UN runtime que recibe `agent_id`,
 * resuelve el Agent Registry, carga el `agent.md` canónico desde R2 verificando
 * su SHA-256, arma los mensajes y ejecuta. Añadir los 27 agentes restantes no
 * requiere tocar esta clase.
 *
 * Cada instancia se direcciona por `execution_id`, de modo que cada ejecución es
 * un sub-agente real con identidad, estado y registro propios — nunca una
 * simulación dentro de una sola llamada monolítica.
 */

export interface LegalWorkerState {
  execution_id: string | null;
  agent_id: string | null;
  status: ExecutionStatus;
  last_event_at: string | null;
}

export interface RunResult {
  execution_id: string;
  status: ExecutionStatus;
  output_ref: string | null;
  credits_consumed: number;
  error?: { code: string; message: string };
}

export class LegalWorker extends Agent<Env, LegalWorkerState> {
  override initialState: LegalWorkerState = {
    execution_id: null,
    agent_id: null,
    status: "PENDING",
    last_event_at: null,
  };

  /**
   * Ejecuta un WorkPackage. Invocado por el Workflow durable, que garantiza
   * reintentos y durabilidad; este método hace el trabajo real de un agente.
   */
  async run(workPackage: WorkPackage): Promise<RunResult> {
    const db = createDb(this.env.DB);
    const executions = new ExecutionRepository(db);
    const events = new ExecutionEventRepository(db);
    const credits = new CreditRepository(db);
    const audit = new AuditRepository(db);

    const execution = await executions.findById(workPackage.execution_id);
    if (!execution) {
      throw new IusiaError(
        "NOT_FOUND",
        `La ejecución ${workPackage.execution_id} no existe en el ledger`,
      );
    }

    const def = getAgentDefinition(workPackage.agent_id);
    const eventBase = {
      organizationId: execution.organizationId,
      matterId: execution.matterId,
      rootExecutionId: execution.rootExecutionId,
      executionId: execution.id,
    };

    this.setState({
      execution_id: execution.id,
      agent_id: def.agent_id,
      status: "RUNNING",
      last_event_at: new Date().toISOString(),
    });

    await executions.transition(execution.id, "RUNNING", {
      promptVersion: def.prompt_version,
      promptSha256: def.prompt_sha256,
      workPackageRef: workPackage.work_package_id,
    });
    await events.append({
      ...eventBase,
      type: "agent.started",
      toAgentId: def.agent_id,
      status: "RUNNING",
      detail: { node_code: def.node_code },
    });

    try {
      // 1. Cargar el prompt canónico. Falla cerrada si el hash no coincide.
      const loader = new PromptLoader(new R2PromptSource(this.env.PROMPTS));
      const prompt = await loader.load(def);

      // 2. Componer los mensajes manteniendo las cuatro capas separadas.
      //
      //    El contrato del Structured Execution Envelope se pide AQUÍ, en el
      //    WorkPackage, y no en el prompt: el `agent.md` canónico sigue inyectándose
      //    íntegro y verificado por SHA. Qué campos se piden lo decide el
      //    `runtime_role` del registry —a un agente de intake no se le piden
      //    autoridades, que es invitarlo a inventarlas— y todo viaja en la MISMA
      //    llamada, sin una segunda pasada de modelo sobre la prosa.
      const envelopeFields = envelopeFieldsFor(def.runtime_role);
      const dispatched: WorkPackage = { ...workPackage, envelope_fields: [...envelopeFields] };
      const messages = [
        { role: "system" as const, content: UNTRUSTED_SYSTEM_GUARD },
        // El agent.md canónico se inyecta íntegro y sin modificaciones.
        { role: "system" as const, content: prompt.text },
        { role: "user" as const, content: renderWorkPackage(dispatched) },
      ];

      await events.append({
        ...eventBase,
        type: "work_package.sent",
        // El 00 no se envía trabajo a sí mismo: sin arista de origen, sin lazo.
        fromAgentId: def.agent_id === ORCHESTRATOR_AGENT_ID ? null : ORCHESTRATOR_AGENT_ID,
        toAgentId: def.agent_id,
        status: "RUNNING",
        detail: {
          objective_length: workPackage.objective.length,
          source_count: workPackage.source_refs.length,
          document_count: workPackage.document_excerpts.length,
          // Referencias de la evidencia recibida: prueba por-agente del grounding.
          evidence_refs: workPackage.document_excerpts.map((d) => d.ref_id).join(","),
        },
      });

      // 3. Ejecutar contra la capa de modelos.
      const gateway = new ModelGateway(this.env);
      // El modelo lo decide el SERVIDOR por clase de trabajo y materialidad del
      // expediente, no el agent.md ni el propio modelo. Sin `task_class` se conserva
      // la política canónica intacta.
      const policy = workPackage.task_class
        ? applyRouting(
            def.model_policy,
            routeModel({
              taskClass: workPackage.task_class as never,
              materiality: workPackage.materiality,
            }),
          )
        : def.model_policy;
      // Cada intento REAL se contabiliza en cuanto ocurre, sirva o no su resultado.
      // Un fallo funcional que consumió tokens de razonamiento costó dinero: dejarlo
      // sin registrar fue el defecto que permitió nueve minutos de gasto invisible.
      const settleAttempt = async (attempt: ProviderAttempt) => {
        await this.chargeAttempt(credits, execution, attempt);
        await events.append({
          ...eventBase,
          type: "agent.tool.called",
          status: attempt.outcome === "SUCCESS" ? "RUNNING" : "FAILED",
          detail: {
            tool: "model.attempt",
            provider: attempt.provider,
            model: attempt.model,
            outcome: attempt.outcome,
            latency_ms: attempt.latency_ms,
            input_tokens: attempt.usage?.input_tokens ?? 0,
            output_tokens: attempt.usage?.output_tokens ?? 0,
            reasoning_tokens: attempt.usage?.reasoning_tokens ?? 0,
            cost_known: attempt.provider_cost_usd !== null,
            provider_cost_usd: attempt.provider_cost_usd ?? 0,
          },
        });
      };

      const result = await gateway.complete(
        policy,
        messages,
        {
          organization_id: execution.organizationId,
          matter_id: execution.matterId,
          agent_id: def.agent_id,
          execution_id: execution.id,
        },
        { onSettled: settleAttempt },
      );

      // 4. El cobro YA ocurrió, intento a intento, dentro de `settleAttempt`. Aquí
      //    sólo se totaliza lo consumido por esta ejecución —éxitos y fallos— para
      //    dejarlo en la fila del ledger.
      const costUsd = result.attempts_detail.reduce(
        (sum, a) => sum + (a.provider_cost_usd ?? 0),
        0,
      );
      const creditsUsed = result.attempts_detail.reduce(
        (sum, a) => sum + (a.provider_cost_usd === null ? 0 : creditsForCost(a.provider_cost_usd)),
        0,
      );

      // 5. Persistir la salida en R2. La tabla sólo guarda el puntero.
      const outputRef = `executions/${execution.organizationId}/${execution.matterId}/${execution.id}.json`;
      // El bloque estructurado se separa de la prosa: el abogado lee un dictamen, no un
      // apéndice de JSON con identificadores internos. `text` queda narrativo puro y el
      // envelope viaja aparte, disponible para proyección y auditoría.
      const extracted = extractEnvelope(result.text);
      const narrative = extracted.present ? stripEnvelope(result.text) : result.text;
      await this.env.ARTIFACTS.put(
        outputRef,
        JSON.stringify({
          matter_id: execution.matterId,
          agent_id: def.agent_id,
          execution_id: execution.id,
          output_type: def.output_type,
          text: narrative,
          envelope: extracted.envelope,
          provenance: {
            produced_by: def.agent_id,
            execution_id: execution.id,
            prompt_sha256: prompt.sha256,
            prompt_version: prompt.version,
            model: result.model,
            provider: result.provider,
            produced_at: new Date().toISOString(),
          },
        }),
        { httpMetadata: { contentType: "application/json" } },
      );

      // 6. Persistir los hechos y autoridades ESTRUCTURADOS que produjo el agente.
      //    Sólo se acepta lo que valida contra el contrato canónico: la prosa libre
      //    del modelo nunca se convierte en un hecho del expediente. Sin este paso,
      //    el Fact Ledger quedaba permanentemente vacío y el Case Brief —que alimenta
      //    la redacción de entregables— no tenía nada que aportar.
      const ledgers = await this.persistLedgers(db, execution, extracted, dispatched);
      if (ledgers.touched) {
        await events.append({
          ...eventBase,
          type: "agent.output.received",
          toAgentId: def.agent_id,
          status: "RUNNING",
          detail: {
            envelope_present: extracted.present,
            envelope_rejected: extracted.rejected,
            ledger_facts: ledgers.facts,
            ledger_authorities: ledgers.authorities,
            projected_tasks: ledgers.tasks,
            projected_risk: ledgers.risk ?? "",
            // Por qué NO se proyectó lo demás. Es lo que hace auditable el filtro:
            // un cero en hechos con `dropped_unsourced` alto significa que el agente
            // afirmó sin citar, no que el sistema se haya quedado callado.
            dropped_unsourced: ledgers.dropped.unsourced,
            dropped_duplicate: ledgers.dropped.duplicate,
            dropped_unknown_refs: ledgers.dropped.unknown_refs,
            dropped_over_cap: ledgers.dropped.over_cap,
          },
        });
      }

      // Analytics Engine es observabilidad opcional: si el binding no está aprovisionado
      // (p.ej. staging sin Analytics Engine habilitado) la escritura es un no-op seguro.
      this.env.USAGE_ANALYTICS?.writeDataPoint({
        blobs: [
          execution.organizationId,
          execution.matterId,
          def.agent_id,
          result.provider,
          result.model,
        ],
        doubles: [result.usage.input_tokens, result.usage.output_tokens, costUsd, creditsUsed],
        indexes: [execution.organizationId],
      });

      await executions.transition(execution.id, "COMPLETED", {
        provider: result.provider,
        model: result.model,
        outputRef,
        outputType: def.output_type,
        inputTokens: result.usage.input_tokens,
        outputTokens: result.usage.output_tokens,
        cachedInputTokens: result.usage.cached_input_tokens,
        providerCostUsd: costUsd,
        creditsConsumed: creditsUsed,
      });

      await events.append({
        ...eventBase,
        type: "agent.output.received",
        fromAgentId: def.agent_id === ORCHESTRATOR_AGENT_ID ? null : def.agent_id,
        toAgentId: ORCHESTRATOR_AGENT_ID,
        status: "COMPLETED",
        detail: { output_type: def.output_type, credits: creditsUsed },
      });
      await events.append({
        ...eventBase,
        type: "agent.completed",
        toAgentId: def.agent_id,
        status: "COMPLETED",
        detail: { provider: result.provider, model: result.model },
      });

      await audit.record({
        organizationId: execution.organizationId,
        matterId: execution.matterId,
        actorExecutionId: execution.id,
        action: "agent.execution.completed",
        resourceType: "execution",
        resourceId: execution.id,
        outcome: "SUCCESS",
        detail: { agent_id: def.agent_id, credits: creditsUsed },
      });

      this.setState({
        execution_id: execution.id,
        agent_id: def.agent_id,
        status: "COMPLETED",
        last_event_at: new Date().toISOString(),
      });

      return {
        execution_id: execution.id,
        status: "COMPLETED",
        output_ref: outputRef,
        credits_consumed: creditsUsed,
      };
    } catch (error) {
      const code = error instanceof IusiaError ? error.code : "INTERNAL";
      const message = error instanceof Error ? error.message : "error desconocido";

      await executions.transition(execution.id, "FAILED", {
        errorCode: code,
        errorMessage: message,
      });
      await events.append({
        ...eventBase,
        type: "agent.failed",
        toAgentId: def.agent_id,
        status: "FAILED",
        detail: { error_code: code },
      });
      await audit.record({
        organizationId: execution.organizationId,
        matterId: execution.matterId,
        actorExecutionId: execution.id,
        action: "agent.execution.failed",
        resourceType: "execution",
        resourceId: execution.id,
        outcome: "FAILURE",
        reason: code,
      });

      this.setState({
        execution_id: execution.id,
        agent_id: def.agent_id,
        status: "FAILED",
        last_event_at: new Date().toISOString(),
      });

      return {
        execution_id: execution.id,
        status: "FAILED",
        output_ref: null,
        credits_consumed: 0,
        error: { code, message },
      };
    }
  }

  /**
   * Cobra UN intento de proveedor.
   *
   * Con usage real se debita el costo observado. Sin usage —timeout, corte de red— se
   * registra un asiento de costo DESCONOCIDO (`providerCostUsd: null`) sin debitar
   * créditos: no se inventa una cifra, pero tampoco se afirma que costó cero. La
   * clave de idempotencia es la identidad de la petición real, de modo que reejecutar
   * la contabilización no cobra dos veces y una petición NUEVA sí se cobra.
   */
  private async chargeAttempt(
    credits: CreditRepository,
    execution: { id: string; organizationId: string; matterId: string; startedBy: string | null },
    attempt: ProviderAttempt,
  ): Promise<void> {
    const key = attemptIdempotencyKey(execution.id, attempt);
    const known = attempt.provider_cost_usd !== null;
    await credits.post({
      organizationId: execution.organizationId,
      kind: "CONSUMPTION",
      amount: known ? -creditsForCost(attempt.provider_cost_usd!) : 0,
      idempotencyKey: key,
      matterId: execution.matterId,
      executionId: execution.id,
      userId: execution.startedBy,
      provider: attempt.provider,
      model: attempt.model,
      providerCostUsd: attempt.provider_cost_usd,
      // El saldo ya se verificó antes de despachar; no se aborta un trabajo hecho.
      allowNegative: true,
    });
  }

  /**
   * Escribe el Fact Ledger y el Authority Ledger del expediente a partir de la salida
   * del agente.
   *
   * Reglas: sólo elementos ESTRUCTURADOS y válidos contra el contrato canónico
   * (`CanonicalFact` / `Authority`); `certainty` y `status` los declara el agente y se
   * conservan tal cual —[F] acreditado, [D] documental, [A] alegado, [U] no
   * verificado—, sin promoverlos nunca a una certeza mayor. `establishedByExecutionId`
   * queda apuntando a la ejecución que lo produjo: un hecho con ejecución es
   * AI_EXTRACTED y trazable hasta su prompt; un hecho sin ella es LAWYER_PROVIDED.
   *
   * Un fallo aquí NO invalida la ejecución: el dictamen ya está persistido y cobrado.
   */
  private async persistLedgers(
    db: ReturnType<typeof createDb>,
    execution: {
      id: string;
      organizationId: string;
      matterId: string;
      startedBy: string | null;
    },
    extracted: ExtractedEnvelope,
    workPackage: WorkPackage,
  ): Promise<{
    touched: boolean;
    facts: number;
    authorities: number;
    tasks: number;
    risk: string | null;
    dropped: ProjectionResult["dropped"];
  }> {
    const empty = {
      touched: extracted.rejected > 0,
      facts: 0,
      authorities: 0,
      tasks: 0,
      risk: null,
      dropped: { unsourced: 0, duplicate: 0, over_cap: 0, unknown_refs: 0 },
    };
    if (!extracted.envelope) return empty;

    try {
      const tasks = new TaskRepository(db);
      const matters = new MatterRepository(db);
      const existing = await tasks.listForMatter(execution.organizationId, execution.matterId);

      // Las referencias que se aceptan al proyectar son EXACTAMENTE las que se
      // entregaron en el WorkPackage. Se recalculan de la misma fuente que las
      // renderizó, así que el agente no puede citar nada que el servidor no le diera.
      const projection = projectEnvelope({
        envelope: extracted.envelope,
        authorizedRefs: authorizedRefsOf(workPackage),
        existingTaskTitles: existing.map((t) => t.title),
      });

      const factRepo = new FactRepository(db);
      const authorityRepo = new AuthorityRepository(db);
      const [factCount, authorityCount] = await Promise.all([
        projection.facts.length
          ? factRepo.upsertMany(
              execution.organizationId,
              execution.matterId,
              projection.facts,
              execution.id,
            )
          : Promise.resolve(0),
        projection.authorities.length
          ? authorityRepo.upsertMany(
              execution.organizationId,
              execution.matterId,
              projection.authorities,
              execution.id,
            )
          : Promise.resolve(0),
      ]);

      // Tareas: se atribuyen al abogado que pidió el análisis, porque se generan por
      // encargo suyo. Quedan PENDIENTE y sin responsable: IUSIA propone trabajo, no
      // se lo asigna a nadie.
      // Sin autor no se crean tareas: una tarea del expediente responde a alguien, y
      // atribuirla a un usuario inventado sería peor que no crearla.
      const author = execution.startedBy;
      let taskCount = 0;
      for (const t of author ? projection.tasks : []) {
        await tasks.create({
          organizationId: execution.organizationId,
          matterId: execution.matterId,
          title: t.title,
          description: `${t.description}\n\nPrioridad sugerida: ${t.priority}. Origen: análisis de IUSIA (${execution.id}), fuentes: ${t.source_refs.join(", ")}.`,
          createdBy: author!,
        });
        taskCount += 1;
      }

      // Riesgo: NUNCA se pisa una calificación humana. Sólo se escribe donde nadie ha
      // decidido todavía; si el abogado ya calificó el expediente, su criterio manda.
      let risk: string | null = null;
      const proposed = riskLevelFrom(projection.risks);
      if (proposed) {
        const matter = await matters.findById(execution.organizationId, execution.matterId);
        if (matter && matter.riskLevel === "UNASSESSED") {
          await matters.setRisk(
            execution.organizationId,
            execution.matterId,
            proposed.level,
            proposed.rationale,
          );
          risk = proposed.level;
        }
      }

      return {
        touched: true,
        facts: factCount,
        authorities: authorityCount,
        tasks: taskCount,
        risk,
        dropped: projection.dropped,
      };
    } catch (error) {
      console.warn("ledger_persist_failed", {
        execution_id: execution.id,
        safe_message: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      });
      return empty;
    }
  }
}
