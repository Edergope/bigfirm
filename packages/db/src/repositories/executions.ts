import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  IusiaError,
  assertDetailIsSafe,
  canTransition,
  newId,
  type ExecutionEvent,
  type ExecutionEventType,
  type ExecutionStatus,
} from "@iusia/domain";
import type { IusiaDb } from "../client.js";
import { executionEvents, executions } from "../schema/iusia.js";

export interface CreateExecutionInput {
  organizationId: string;
  matterId: string;
  agentId: string;
  parentExecutionId: string | null;
  rootExecutionId: string | null;
  startedBy: string | null;
  workflowInstanceId?: string | null;
}

/**
 * Execution Ledger. Toda ejecución real de agente pasa por aquí.
 * Si algo no está en esta tabla, la UI no puede afirmar que ocurrió.
 */
export class ExecutionRepository {
  constructor(private readonly db: IusiaDb) {}

  async create(input: CreateExecutionInput): Promise<string> {
    const id = newId("execution");
    await this.db.insert(executions).values({
      id,
      organizationId: input.organizationId,
      matterId: input.matterId,
      agentId: input.agentId,
      parentExecutionId: input.parentExecutionId,
      // Una ejecución sin padre es raíz de su propio grafo.
      rootExecutionId: input.rootExecutionId ?? id,
      workflowInstanceId: input.workflowInstanceId ?? null,
      status: "PENDING",
      retries: 0,
      startedBy: input.startedBy,
      createdAt: new Date().toISOString(),
    });
    return id;
  }

  async findById(executionId: string) {
    const [row] = await this.db
      .select()
      .from(executions)
      .where(eq(executions.id, executionId))
      .limit(1);
    return row ?? null;
  }

  async listByRoot(rootExecutionId: string) {
    return this.db
      .select()
      .from(executions)
      .where(eq(executions.rootExecutionId, rootExecutionId))
      .orderBy(asc(executions.createdAt));
  }

  async listByMatter(organizationId: string, matterId: string, limit = 50) {
    return this.db
      .select()
      .from(executions)
      .where(
        and(eq(executions.organizationId, organizationId), eq(executions.matterId, matterId)),
      )
      .orderBy(desc(executions.createdAt))
      .limit(limit);
  }

  /**
   * Raíces de orquestación aún en curso en la organización.
   *
   * Alimenta el indicador global "IUSIA · N análisis": el usuario debe poder
   * abandonar la vista sin perder de vista lo que la firma tiene trabajando.
   * Devuelve sólo raíces (sin padre); el filtrado por acceso a expediente lo aplica
   * la capa de rutas, que es donde vive la autorización.
   */
  async listActiveRoots(organizationId: string, limit = 20) {
    return this.db
      .select()
      .from(executions)
      .where(
        and(
          eq(executions.organizationId, organizationId),
          isNull(executions.parentExecutionId),
          inArray(executions.status, ["PENDING", "RUNNING", "WAITING", "BLOCKED"]),
        ),
      )
      .orderBy(desc(executions.createdAt))
      .limit(limit);
  }

  /** Raíces de orquestación recientes de la organización, en cualquier estado. */
  async listRecentRoots(organizationId: string, limit = 25) {
    return this.db
      .select()
      .from(executions)
      .where(
        and(
          eq(executions.organizationId, organizationId),
          isNull(executions.parentExecutionId),
        ),
      )
      .orderBy(desc(executions.createdAt))
      .limit(limit);
  }

  /** Transición de estado validada contra la máquina de estados del dominio. */
  async transition(
    executionId: string,
    to: ExecutionStatus,
    patch: Partial<{
      provider: string;
      model: string;
      promptVersion: string;
      promptSha256: string;
      workPackageRef: string;
      outputRef: string;
      outputType: string;
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens: number;
      providerCostUsd: number;
      creditsConsumed: number;
      errorCode: string;
      errorMessage: string;
      workflowInstanceId: string;
    }> = {},
  ): Promise<void> {
    const current = await this.findById(executionId);
    if (!current) {
      throw new IusiaError("NOT_FOUND", `Ejecución ${executionId} no encontrada`);
    }
    const from = current.status as ExecutionStatus;
    if (from === to) return;
    if (!canTransition(from, to)) {
      throw new IusiaError(
        "CONFLICT",
        `Transición de ejecución inválida: ${from} -> ${to}`,
        { execution_id: executionId },
      );
    }

    const now = new Date().toISOString();
    await this.db
      .update(executions)
      .set({
        ...patch,
        status: to,
        startedAt: to === "RUNNING" && !current.startedAt ? now : current.startedAt,
        completedAt:
          to === "COMPLETED" || to === "FAILED" || to === "CANCELLED" ? now : null,
      })
      .where(eq(executions.id, executionId));
  }

  async incrementRetries(executionId: string): Promise<void> {
    await this.db
      .update(executions)
      .set({ retries: sql`${executions.retries} + 1` })
      .where(eq(executions.id, executionId));
  }
}

/**
 * Event log de ejecución. Alimenta la Strategy Room.
 * La secuencia es monótona por grafo para permitir replay determinista.
 */
export class ExecutionEventRepository {
  constructor(private readonly db: IusiaDb) {}

  async append(input: {
    organizationId: string;
    matterId: string;
    rootExecutionId: string;
    executionId: string;
    type: ExecutionEventType;
    fromAgentId?: string | null;
    toAgentId?: string | null;
    status?: ExecutionStatus | null;
    detail?: Record<string, string | number | boolean>;
  }): Promise<number> {
    const detail = input.detail ?? {};
    assertDetailIsSafe(detail);

    const [row] = await this.db
      .select({ maxSeq: sql<number>`coalesce(max(${executionEvents.sequence}), -1)` })
      .from(executionEvents)
      .where(eq(executionEvents.rootExecutionId, input.rootExecutionId));

    const sequence = (row?.maxSeq ?? -1) + 1;
    await this.db.insert(executionEvents).values({
      id: newId("event"),
      organizationId: input.organizationId,
      matterId: input.matterId,
      rootExecutionId: input.rootExecutionId,
      executionId: input.executionId,
      type: input.type,
      fromAgentId: input.fromAgentId ?? null,
      toAgentId: input.toAgentId ?? null,
      status: input.status ?? null,
      detail,
      sequence,
      occurredAt: new Date().toISOString(),
    });
    return sequence;
  }

  async listByRoot(rootExecutionId: string, sinceSequence = -1) {
    const rows = await this.db
      .select()
      .from(executionEvents)
      .where(
        and(
          eq(executionEvents.rootExecutionId, rootExecutionId),
          sql`${executionEvents.sequence} > ${sinceSequence}`,
        ),
      )
      .orderBy(asc(executionEvents.sequence));

    return rows.map(
      (r): ExecutionEvent => ({
        event_id: r.id,
        matter_id: r.matterId,
        root_execution_id: r.rootExecutionId,
        execution_id: r.executionId,
        type: r.type as ExecutionEventType,
        from_agent_id: r.fromAgentId,
        to_agent_id: r.toAgentId,
        status: r.status as ExecutionStatus | null,
        detail: r.detail as ExecutionEvent["detail"],
        sequence: r.sequence,
        occurred_at: r.occurredAt,
      }),
    );
  }
}
