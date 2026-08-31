/**
 * Circuit breaker y presupuesto de seguridad de la orquestación multiagente.
 *
 * La orquestación dinámica NUNCA puede convertirse en un sistema abierto capaz de
 * entrar en loop, repetir tareas o consumir créditos sin límite. Todos los límites
 * son SERVER-SIDE: ni el frontend ni el planner (modelo) pueden alterarlos.
 *
 * Este módulo es puro (sin IO): fija los límites, detecta duplicados/loops y calcula
 * el presupuesto. El workflow lo consulta antes de cada despacho o llamada LLM.
 */

/** Límites duros del MVP multiagente. Server-side, no configurables por cliente/modelo. */
export const ORCHESTRATION_LIMITS = {
  MIN_SPECIALISTS: 1,
  DEFAULT_MAX_SPECIALISTS: 5,
  HARD_MAX_SPECIALISTS: 6,
  /** PLAN + hasta 6 specialists + INTEGRATE. */
  MAX_MAIN_LLM_EXECUTIONS_PER_ROOT: 8,
  MAX_PARALLEL_AGENTS: 3,
  MAX_DAG_DEPTH: 4,
  MAX_INTER_AGENT_TRANSFERS: 12,
  MAX_PLAN_REPAIR_ATTEMPTS: 1,
  MAX_ROOT_WALL_TIME_MINUTES: 15,
  /** Tamaño máximo del resumen de un output upstream inyectado a otro agente. */
  MAX_UPSTREAM_OUTPUT_SIZE: 4000,
  /**
   * Límites de la llamada de planificación (00 PLAN), calibrados sobre la latencia
   * REAL medida en staging para ese agente y modelo: n=12, mínimo 33 s, mediana 79 s,
   * máximo 127 s. Los valores por defecto del gateway —300 s por intento, 3 intentos,
   * 2 candidatos— permitían casi media hora de silencio antes de que actuara ninguna
   * guarda. Un abogado no espera media hora sin señal: cancela. Y eso fue exactamente
   * lo que ocurrió en la primera prueba real.
   */
  PLANNER_REQUEST_TIMEOUT_MS: 180_000,
  PLANNER_MAX_ATTEMPTS_PER_CANDIDATE: 2,
  /** Cota superior del silencio admisible durante la planificación. */
  MAX_PLANNING_WALL_TIME_MINUTES: 12,
} as const;

export type OrchestrationLimits = typeof ORCHESTRATION_LIMITS;

/** Causas estructuradas de disparo del circuit breaker. Nunca un mensaje genérico. */
export type CircuitBreakerReason =
  | "DUPLICATE_TASK"
  | "DUPLICATE_AGENT_MISSION"
  | "MAX_EXECUTIONS_EXCEEDED"
  | "MAX_PARALLELISM_EXCEEDED"
  | "MAX_DAG_DEPTH_EXCEEDED"
  | "MAX_TRANSFERS_EXCEEDED"
  | "LOOP_DETECTED"
  | "PLAN_VIOLATION"
  | "CREDIT_BUDGET_EXCEEDED"
  | "WALL_TIME_EXCEEDED"
  | "USER_CANCELLED";

export type GuardResult =
  | { ok: true }
  | { ok: false; reason: CircuitBreakerReason; detail: string };

const OK: GuardResult = { ok: true };
const trip = (reason: CircuitBreakerReason, detail: string): GuardResult => ({
  ok: false,
  reason,
  detail,
});

/** Normaliza una misión para huella de duplicado: minúsculas, espacios colapsados. */
export function normalizeMission(mission: string): string {
  return mission.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Huella de (matter, agente, misión) para detectar la misma tarea repetida. */
export function missionFingerprint(matterId: string, agentId: string, mission: string): string {
  return `${matterId}::${agentId}::${normalizeMission(mission)}`;
}

/**
 * Estado de seguridad de UNA root execution. El workflow lo mantiene en memoria
 * durante `run()` y lo consulta antes de cada despacho/transferencia/llamada LLM.
 * Es determinista: mismos registros ⇒ mismas decisiones (apto para replay).
 */
export class ExecutionSafetyLedger {
  private mainExecutions = 0;
  private transfers = 0;
  private readonly dispatchedTaskIds = new Set<string>();
  private readonly missionFingerprints = new Set<string>();
  private readonly transferEdges = new Set<string>();

  constructor(private readonly limits: OrchestrationLimits = ORCHESTRATION_LIMITS) {}

  /** Cuenta una llamada LLM principal (PLAN o INTEGRATE). */
  registerPlanOrIntegration(label: "plan" | "integration"): GuardResult {
    return this.countExecution(label);
  }

  /**
   * Registra el despacho de una task de especialista: at-most-once por task_id y
   * sin repetir la misma misión para el mismo agente dentro de la root execution.
   */
  registerTask(args: {
    taskId: string;
    agentId: string;
    mission: string;
    matterId: string;
  }): GuardResult {
    if (this.dispatchedTaskIds.has(args.taskId)) {
      return trip("DUPLICATE_TASK", `task_id ya despachada: ${args.taskId}`);
    }
    const fp = missionFingerprint(args.matterId, args.agentId, args.mission);
    if (this.missionFingerprints.has(fp)) {
      return trip(
        "DUPLICATE_AGENT_MISSION",
        `misión duplicada para ${args.agentId}`,
      );
    }
    const counted = this.countExecution(`task:${args.taskId}`);
    if (!counted.ok) return counted;
    this.dispatchedTaskIds.add(args.taskId);
    this.missionFingerprints.add(fp);
    return OK;
  }

  /** Registra una transferencia A→B; bloquea el exceso y el arco inverso (A→B→A). */
  registerTransfer(fromAgentId: string, toAgentId: string): GuardResult {
    const edge = `${fromAgentId}->${toAgentId}`;
    const reverse = `${toAgentId}->${fromAgentId}`;
    if (this.transferEdges.has(reverse)) {
      return trip("LOOP_DETECTED", `arco inverso de transferencia: ${edge}`);
    }
    if (this.transferEdges.has(edge)) {
      return trip("LOOP_DETECTED", `transferencia repetida: ${edge}`);
    }
    if (this.transfers + 1 > this.limits.MAX_INTER_AGENT_TRANSFERS) {
      return trip("MAX_TRANSFERS_EXCEEDED", `> ${this.limits.MAX_INTER_AGENT_TRANSFERS}`);
    }
    this.transfers++;
    this.transferEdges.add(edge);
    return OK;
  }

  /** Verifica que un batch no exceda la concurrencia máxima permitida. */
  checkParallelBatch(batchSize: number): GuardResult {
    if (batchSize > this.limits.MAX_PARALLEL_AGENTS) {
      return trip(
        "MAX_PARALLELISM_EXCEEDED",
        `batch ${batchSize} > ${this.limits.MAX_PARALLEL_AGENTS}`,
      );
    }
    return OK;
  }

  private countExecution(label: string): GuardResult {
    if (this.mainExecutions + 1 > this.limits.MAX_MAIN_LLM_EXECUTIONS_PER_ROOT) {
      return trip(
        "MAX_EXECUTIONS_EXCEEDED",
        `${label}: > ${this.limits.MAX_MAIN_LLM_EXECUTIONS_PER_ROOT} ejecuciones`,
      );
    }
    this.mainExecutions++;
    return OK;
  }

  get counts(): { mainExecutions: number; transfers: number; tasks: number } {
    return {
      mainExecutions: this.mainExecutions,
      transfers: this.transfers,
      tasks: this.dispatchedTaskIds.size,
    };
  }
}

/**
 * Presupuesto de créditos por root execution.
 * hard_budget = min(límite configurado, coste estimado × 1.5).
 */
export function computeRootCreditBudget(args: {
  estimatedExecutions: number;
  perExecutionCredits: number;
  configuredRootLimit: number;
}): number {
  const estimatedCost = args.estimatedExecutions * args.perExecutionCredits;
  return Math.max(0, Math.min(args.configuredRootLimit, Math.ceil(estimatedCost * 1.5)));
}

/** ¿Se puede pagar la próxima llamada LLM sin superar el presupuesto de la root? */
export function canAffordNextExecution(args: {
  spentCredits: number;
  nextEstimatedCredits: number;
  hardBudget: number;
}): boolean {
  return args.spentCredits + args.nextEstimatedCredits <= args.hardBudget;
}

/** Profundidad (cadena de dependencias más larga) de un conjunto de tareas. */
export function dagDepth(tasks: ReadonlyArray<{ task_id: string; depends_on: readonly string[] }>): number {
  const byId = new Map(tasks.map((t) => [t.task_id, t]));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  const depth = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (visiting.has(id)) return 0; // ciclo: lo maneja el validador; aquí no colgamos
    const node = byId.get(id);
    if (!node || node.depends_on.length === 0) {
      memo.set(id, 1);
      return 1;
    }
    visiting.add(id);
    const d = 1 + Math.max(...node.depends_on.map((dep) => depth(dep)));
    visiting.delete(id);
    memo.set(id, d);
    return d;
  };

  return tasks.length === 0 ? 0 : Math.max(...tasks.map((t) => depth(t.task_id)));
}
