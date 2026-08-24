import { Agent } from "agents";
import {
  IusiaError,
  creditsForCost,
  providerCostUsd,
  renderWorkPackage,
  type ExecutionStatus,
  type WorkPackage,
} from "@iusia/domain";
import { getAgentDefinition, PromptLoader, R2PromptSource } from "@iusia/agents";
import {
  AuditRepository,
  CreditRepository,
  ExecutionEventRepository,
  ExecutionRepository,
  createDb,
} from "@iusia/db";
import type { Env } from "../env.js";
import { ModelGateway, rateFor } from "../services/model-gateway.js";
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
      const messages = [
        { role: "system" as const, content: UNTRUSTED_SYSTEM_GUARD },
        // El agent.md canónico se inyecta íntegro y sin modificaciones.
        { role: "system" as const, content: prompt.text },
        { role: "user" as const, content: renderWorkPackage(workPackage) },
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
      const result = await gateway.complete(def.model_policy, messages, {
        organization_id: execution.organizationId,
        matter_id: execution.matterId,
        agent_id: def.agent_id,
        execution_id: execution.id,
      });

      // 4. Persistir la salida en R2. La tabla sólo guarda el puntero.
      const outputRef = `executions/${execution.organizationId}/${execution.matterId}/${execution.id}.json`;
      await this.env.ARTIFACTS.put(
        outputRef,
        JSON.stringify({
          matter_id: execution.matterId,
          agent_id: def.agent_id,
          execution_id: execution.id,
          output_type: def.output_type,
          text: result.text,
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

      // 5. Costos y créditos. Idempotente por execution_id.
      const rate = rateFor(result.provider, result.model);
      const costUsd = providerCostUsd(rate, result.usage);
      const creditsUsed = creditsForCost(costUsd);
      await credits.post({
        organizationId: execution.organizationId,
        kind: "CONSUMPTION",
        amount: -creditsUsed,
        idempotencyKey: `execution:${execution.id}`,
        matterId: execution.matterId,
        executionId: execution.id,
        userId: execution.startedBy,
        provider: result.provider,
        model: result.model,
        providerCostUsd: costUsd,
        // El saldo ya se verificó antes de despachar; no se aborta un trabajo hecho.
        allowNegative: true,
      });

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
}
