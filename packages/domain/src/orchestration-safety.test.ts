import { describe, expect, it } from "vitest";
import {
  ExecutionSafetyLedger,
  ORCHESTRATION_LIMITS,
  canAffordNextExecution,
  computeRootCreditBudget,
  dagDepth,
  missionFingerprint,
} from "./orchestration-safety.js";

/** Circuit breaker y presupuesto (Bloque 7.7A-FIX). */

const MATTER = "mtr_x";

describe("ExecutionSafetyLedger", () => {
  it("[TEST C] la misma task_id dos veces => DUPLICATE_TASK (no ejecuta la segunda)", () => {
    const s = new ExecutionSafetyLedger();
    expect(s.registerTask({ taskId: "t1", agentId: "a", mission: "m1", matterId: MATTER }).ok).toBe(true);
    const r = s.registerTask({ taskId: "t1", agentId: "a", mission: "m1", matterId: MATTER });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("DUPLICATE_TASK");
    expect(s.counts.tasks).toBe(1);
  });

  it("[TEST D] mismo agente + misma misión => DUPLICATE_AGENT_MISSION", () => {
    const s = new ExecutionSafetyLedger();
    s.registerTask({ taskId: "t1", agentId: "a", mission: "Analiza  el   contrato", matterId: MATTER });
    const r = s.registerTask({ taskId: "t2", agentId: "a", mission: "analiza el contrato", matterId: MATTER });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("DUPLICATE_AGENT_MISSION");
  });

  it("[TEST E] batch mayor que MAX_PARALLEL_AGENTS => MAX_PARALLELISM_EXCEEDED", () => {
    const s = new ExecutionSafetyLedger();
    const r = s.checkParallelBatch(ORCHESTRATION_LIMITS.MAX_PARALLEL_AGENTS + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("MAX_PARALLELISM_EXCEEDED");
    expect(s.checkParallelBatch(ORCHESTRATION_LIMITS.MAX_PARALLEL_AGENTS).ok).toBe(true);
  });

  it("[TEST F] más de MAX_MAIN_LLM_EXECUTIONS => MAX_EXECUTIONS_EXCEEDED", () => {
    const s = new ExecutionSafetyLedger();
    let tripped = false;
    for (let i = 0; i < ORCHESTRATION_LIMITS.MAX_MAIN_LLM_EXECUTIONS_PER_ROOT + 2; i++) {
      const r = s.registerTask({ taskId: `t${i}`, agentId: `a${i}`, mission: `m${i}`, matterId: MATTER });
      if (!r.ok) {
        expect(r.reason).toBe("MAX_EXECUTIONS_EXCEEDED");
        tripped = true;
        break;
      }
    }
    expect(tripped).toBe(true);
  });

  it("[TEST G] más de MAX_TRANSFERS => MAX_TRANSFERS_EXCEEDED", () => {
    const s = new ExecutionSafetyLedger();
    let tripped: string | null = null;
    for (let i = 0; i < ORCHESTRATION_LIMITS.MAX_INTER_AGENT_TRANSFERS + 2; i++) {
      const r = s.registerTransfer(`a${i}`, `b${i}`);
      if (!r.ok) {
        tripped = r.reason;
        break;
      }
    }
    expect(tripped).toBe("MAX_TRANSFERS_EXCEEDED");
  });

  it("detecta loop de transferencias A→B→A", () => {
    const s = new ExecutionSafetyLedger();
    expect(s.registerTransfer("A", "B").ok).toBe(true);
    const r = s.registerTransfer("B", "A");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("LOOP_DETECTED");
  });
});

describe("presupuesto de créditos", () => {
  it("[TEST H] hard budget = min(límite, coste×1.5) y bloquea antes de exceder", () => {
    const budget = computeRootCreditBudget({
      estimatedExecutions: 4,
      perExecutionCredits: 100,
      configuredRootLimit: 10_000,
    });
    expect(budget).toBe(600); // 4*100*1.5
    expect(canAffordNextExecution({ spentCredits: 500, nextEstimatedCredits: 100, hardBudget: budget })).toBe(true);
    expect(canAffordNextExecution({ spentCredits: 550, nextEstimatedCredits: 100, hardBudget: budget })).toBe(false);
  });

  it("respeta el límite configurado cuando es menor que el estimado×1.5", () => {
    const budget = computeRootCreditBudget({
      estimatedExecutions: 8,
      perExecutionCredits: 300,
      configuredRootLimit: 1000,
    });
    expect(budget).toBe(1000);
  });
});

describe("utilidades", () => {
  it("dagDepth calcula la cadena de dependencias más larga", () => {
    expect(
      dagDepth([
        { task_id: "a", depends_on: [] },
        { task_id: "b", depends_on: ["a"] },
        { task_id: "c", depends_on: ["b"] },
      ]),
    ).toBe(3);
  });

  it("missionFingerprint normaliza espacios y mayúsculas", () => {
    expect(missionFingerprint(MATTER, "a", "Analiza  EL  contrato")).toBe(
      missionFingerprint(MATTER, "a", "analiza el contrato"),
    );
  });
});
