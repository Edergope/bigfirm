import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
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
  /**
   * Identidad lógica del despacho dentro del grafo (p.ej. `<root>:task:<task_id>`).
   * Un reintento TÉCNICO del step debe reutilizar la misma ejecución jurídica: sin
   * esta clave, el reintento creaba una fila nueva, una clave de idempotencia nueva
   * y, por tanto, un segundo cobro por el mismo trabajo.
   */
  dispatchKey?: string | null;
}

/**
 * Execution Ledger. Toda ejecución real de agente pasa por aquí.
 * Si algo no está en esta tabla, la UI no puede afirmar que ocurrió.
 */
export class ExecutionRepository {
  constructor(private readonly db: IusiaDb) {}

  async create(input: CreateExecutionInput): Promise<string> {
    const id = newId("execution");
    const inserted = await this.db
      .insert(executions)
      .values({
        id,
        organizationId: input.organizationId,
        matterId: input.matterId,
        agentId: input.agentId,
        parentExecutionId: input.parentExecutionId,
        // Una ejecución sin padre es raíz de su propio grafo.
        rootExecutionId: input.rootExecutionId ?? id,
        workflowInstanceId: input.workflowInstanceId ?? null,
        dispatchKey: input.dispatchKey ?? null,
        status: "PENDING",
        retries: 0,
        startedBy: input.startedBy,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing()
      .returning({ id: executions.id });

    if (inserted[0]) return inserted[0].id;

    // Conflicto sobre `dispatch_key`: este despacho lógico ya tiene ejecución. Se
    // reutiliza — un reintento técnico no es una ejecución jurídica nueva.
    if (input.dispatchKey) {
      const existing = await this.findByDispatchKey(input.dispatchKey);
      if (existing) {
        await this.incrementRetries(existing.id);
        return existing.id;
      }
    }
    throw new IusiaError("CONFLICT", "No fue posible registrar la ejecución", {
      dispatch_key: input.dispatchKey ?? null,
    });
  }

  /** Ejecución ya registrada para una identidad lógica de despacho, si existe. */
  async findByDispatchKey(dispatchKey: string) {
    const [row] = await this.db
      .select()
      .from(executions)
      .where(eq(executions.dispatchKey, dispatchKey))
      .limit(1);
    return row ?? null;
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

  /**
   * Raíces recientes de TODA la plataforma. Reservado a la autoridad de sistema:
   * el kill switch global necesita ver lo que puede detener. Devuelve filas de
   * ejecución (estado, consumo, tiempos), nunca contenido del expediente.
   */
  async listRecentRootsGlobal(limit = 50) {
    return this.db
      .select()
      .from(executions)
      .where(isNull(executions.parentExecutionId))
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
    const reachesTerminal = to === "COMPLETED" || to === "FAILED" || to === "CANCELLED";
    await this.db
      .update(executions)
      .set({
        ...patch,
        status: to,
        startedAt: to === "RUNNING" && !current.startedAt ? now : current.startedAt,
        // Sólo una transición terminal fija `completed_at`. Antes se escribía `null`
        // en cualquier destino no terminal, de modo que el campo dependía de que la
        // máquina de estados nunca permitiera salir de un terminal, no de sí mismo.
        completedAt: reachesTerminal ? now : current.completedAt,
      })
      .where(eq(executions.id, executionId));
  }

  /**
   * Cierra en CANCELLED toda ejecución hija aún viva de una raíz cancelada.
   * Sin esto, un especialista quedaba RUNNING para siempre en el ledger aunque el
   * workflow ya estuviera terminado: el registro afirmaba trabajo que no ocurría.
   */
  async cancelDescendants(rootExecutionId: string, reason: string): Promise<number> {
    const now = new Date().toISOString();
    const result = await this.db
      .update(executions)
      .set({ status: "CANCELLED", completedAt: now, errorCode: reason })
      .where(
        and(
          eq(executions.rootExecutionId, rootExecutionId),
          ne(executions.id, rootExecutionId),
          inArray(executions.status, ["PENDING", "RUNNING", "WAITING", "BLOCKED"]),
        ),
      )
      .returning({ id: executions.id });
    return result.length;
  }

  async incrementRetries(executionId: string): Promise<void> {
    await this.db
      .update(executions)
      .set({ retries: sql`${executions.retries} + 1` })
      .where(eq(executions.id, executionId));
  }
}

/** Choque con un índice único de SQLite/D1, con independencia del driver. */
function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(message);
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

    // La secuencia se asigna DENTRO de la misma sentencia INSERT, con una subconsulta
    // escalar: en SQLite/D1 eso es atómico. La versión anterior leía `max(sequence)`
    // y luego insertaba, así que dos agentes en paralelo sobre la misma raíz podían
    // calcular el mismo número y violar `execution_events_root_seq_uq`. Esa excepción
    // ocurría dentro de un `step.do` reintentable y era el origen real de las filas
    // de ejecución duplicadas (UI_RETRY_DUPLICATE_ROWS).
    const nextSequence = sql<number>`(
      select coalesce(max(${executionEvents.sequence}), -1) + 1
      from ${executionEvents}
      where ${executionEvents.rootExecutionId} = ${input.rootExecutionId}
    )`;

    const values = {
      organizationId: input.organizationId,
      matterId: input.matterId,
      rootExecutionId: input.rootExecutionId,
      executionId: input.executionId,
      type: input.type,
      fromAgentId: input.fromAgentId ?? null,
      toAgentId: input.toAgentId ?? null,
      status: input.status ?? null,
      detail,
      occurredAt: new Date().toISOString(),
    };

    // Defensa en profundidad: si el motor llegara a serializar de otro modo, un
    // choque de unicidad se reintenta un número acotado de veces en vez de propagar.
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const [inserted] = await this.db
          .insert(executionEvents)
          .values({ id: newId("event"), ...values, sequence: nextSequence })
          .returning({ sequence: executionEvents.sequence });
        if (inserted) return inserted.sequence;
      } catch (error) {
        lastError = error;
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw lastError ?? new IusiaError("CONFLICT", "No fue posible registrar el evento");
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
