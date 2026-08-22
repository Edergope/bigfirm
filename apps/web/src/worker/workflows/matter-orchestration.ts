import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { getAgentByName } from "agents";
import { newId, type Materiality, type WorkPackage } from "@iusia/domain";
import { getAgentDefinition } from "@iusia/agents";
import {
  dispatchBatches,
  evaluateGate,
  planFor,
  WAVE_GATE,
  type DagNode,
  type Wave,
} from "@iusia/orchestration";
import {
  AuditRepository,
  DocumentRepository,
  ExecutionEventRepository,
  ExecutionRepository,
  MatterRepository,
  createDb,
} from "@iusia/db";
import type { Env } from "../env.js";
import type { LegalWorker, RunResult } from "../agents/legal-worker.js";
import { NotificationService } from "../services/notifications.js";

export interface MatterOrchestrationParams {
  organization_id: string;
  matter_id: string;
  root_execution_id: string;
  started_by: string;
  objective: string;
}

/**
 * DAG jurídico sobre Cloudflare Workflows.
 *
 * Reparto de responsabilidades (Blueprint §06):
 *  - Workflows aporta durabilidad, pasos, reintentos y espera de eventos.
 *  - IUSIA aporta QUÉ agentes corren, en qué orden, qué va en paralelo y qué
 *    gate bloquea el avance.
 *
 * Los gates se evalúan aquí, de forma determinista. El modelo nunca decide si
 * el DAG puede avanzar.
 */
export class MatterOrchestrationWorkflow extends WorkflowEntrypoint<
  Env,
  MatterOrchestrationParams
> {
  override async run(
    event: WorkflowEvent<MatterOrchestrationParams>,
    step: WorkflowStep,
  ): Promise<{ root_execution_id: string; completed: string[]; failed: string[] }> {
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

    // ── Plan de ejecución según materialidad ──
    const plan = await step.do("resolve-plan", async () => {
      const matter = await matters.findById(params.organization_id, params.matter_id);
      if (!matter) throw new Error(`Matter ${params.matter_id} no encontrado`);
      const nodes = planFor(matter.materiality as Materiality);
      return {
        materiality: matter.materiality as Materiality,
        jurisdiction: matter.jurisdiction,
        nodes: nodes.map((n) => ({ ...n, requires: [...n.requires] })) as DagNode[],
      };
    });

    // La raíz pasa de WAITING (esperando al motor durable) a RUNNING en cuanto el
    // Workflow arranca de verdad. La máquina de estados no admite atajos.
    await step.do("start-root-execution", async () => {
      await executions.transition(params.root_execution_id, "RUNNING");
    });

    await step.do("emit-execution-created", async () => {
      await events.append({
        ...eventBase,
        executionId: params.root_execution_id,
        type: "execution.created",
        // Sin agente: la raíz es la orquestación, no un nodo del grafo.
        status: "RUNNING",
        detail: { materiality: plan.materiality, node_count: plan.nodes.length },
      });
    });

    // Contexto documental del matter: sólo referencias autorizadas, no contenido.
    const sources = await step.do("collect-authorized-sources", async () => {
      const docs = await documents.listForMatter(params.organization_id, params.matter_id);
      return docs.map((d) => ({
        ref_id: d.id,
        kind: "DOCUMENT" as const,
        label: d.name,
        locator: d.driveFileId ? `drive://${d.driveFileId}` : `iusia://document/${d.id}`,
      }));
    });

    const batches = dispatchBatches(plan.nodes);
    const completed: string[] = [];
    const failed: string[] = [];

    for (const [batchIndex, batch] of batches.entries()) {
      // Un lote con más de un nodo son ramas realmente paralelas del DAG.
      const results = await Promise.all(
        batch.map((node) =>
          step.do(
            `dispatch-${batchIndex}-${node.agent_id}`,
            {
              retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
              timeout: "10 minutes",
            },
            async (): Promise<RunResult> => {
              const def = getAgentDefinition(node.agent_id);

              const executionId = await executions.create({
                organizationId: params.organization_id,
                matterId: params.matter_id,
                agentId: node.agent_id,
                // Toda ejecución de nodo cuelga de la raíz del grafo, incluido el 00:
                // la raíz representa la orquestación, no a un agente concreto.
                parentExecutionId: params.root_execution_id,
                rootExecutionId: params.root_execution_id,
                startedBy: params.started_by,
                workflowInstanceId: event.instanceId,
              });

              await events.append({
                ...eventBase,
                executionId,
                type: "agent.dispatched",
                fromAgentId:
                  node.agent_id === "pisoso-orquestador-juridico"
                    ? null
                    : "pisoso-orquestador-juridico",
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
                fact_refs: [],
                source_refs: sources,
                document_excerpts: [],
                upstream_outputs: [],
                constraints: [
                  "Trabaja únicamente con las fuentes autorizadas del WorkPackage.",
                  "Declara expresamente lo que no consta en el expediente.",
                ],
                expected_output_schema: def.output_schema_id,
                allowed_tools: def.tools_policy,
                jurisdiction: plan.jurisdiction,
                language: "es-CO",
                created_at: new Date().toISOString(),
              };

              // Sub-agente real: instancia direccionada por execution_id.
              const worker = await getAgentByName<Env, LegalWorker>(
                this.env.LegalWorker,
                executionId,
              );
              return worker.run(workPackage);
            },
          ),
        ),
      );

      for (const r of results) {
        if (r.status === "COMPLETED") completed.push(r.execution_id);
        else failed.push(r.execution_id);
      }

      // ── Gate de la ola, determinista y del lado del servidor ──
      const wave = batch[0]!.wave as Wave;
      const isLastBatchOfWave =
        batchIndex === batches.length - 1 ||
        batches[batchIndex + 1]!.some((n) => n.wave !== wave);

      if (isLastBatchOfWave) {
        const gateResult = await step.do(`gate-${wave}`, async () => {
          // La fila raíz se excluye: comparte agent_id con el 00 y contarla podría
          // dar por satisfecho un nodo que nunca se ejecutó.
          const rows = (await executions.listByRoot(params.root_execution_id)).filter(
            (r) => r.id !== params.root_execution_id,
          );
          const completedAgents = new Set(
            rows.filter((r) => r.status === "COMPLETED").map((r) => r.agentId),
          );
          const failedAgents = new Set(
            rows.filter((r) => r.status === "FAILED").map((r) => r.agentId),
          );
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

        // Approval gate: en asuntos HIGH_STAKES el DAG espera decisión humana.
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
          // Gate bloqueado sin vía de aprobación humana: el DAG se detiene aquí.
          break;
        }
      }
    }

    // Cierra la ejecución raíz: sin esto el grafo quedaría eternamente en WAITING
    // y la UI no podría afirmar que la orquestación terminó.
    await step.do("close-root-execution", async () => {
      await executions.transition(
        params.root_execution_id,
        failed.length > 0 ? "FAILED" : "COMPLETED",
        failed.length > 0
          ? {
              errorCode: "DOWNSTREAM_EXECUTION_FAILED",
              errorMessage: `${failed.length} ejecución(es) de agente fallaron`,
            }
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

    // Notifica al owner del matter el cierre de la orquestación. NO bloquea:
    // sin Resend configurado, la notificación queda NOT_CONFIGURED y el DAG termina igual.
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
        payload: {
          matter_reference: matter?.reference ?? params.matter_id,
          completed: completed.length,
          failed: failed.length,
        },
      });
    });

    return { root_execution_id: params.root_execution_id, completed, failed };
  }
}
