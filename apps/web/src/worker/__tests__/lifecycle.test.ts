import { beforeEach, describe, expect, it } from "vitest";
import { isIusiaError } from "@iusia/domain";
import { createTestDb, seedFirm, type TestDb } from "./harness.js";

/**
 * Ciclo de vida (CRUD/estado) de tareas y de ejecuciones — la lógica de servidor
 * que respaldan los endpoints PATCH task y POST execution/cancel, probada sobre
 * SQL real y la máquina de estados del Execution Ledger.
 */
describe("ciclo de vida de tareas", () => {
  let t: TestDb;
  let org: string, user: string, matter: string;

  beforeEach(async () => {
    t = createTestDb();
    const seed = await seedFirm(t, { orgName: "Firma L", directorEmail: "l@l.test" });
    org = seed.organizationId;
    user = seed.directorUserId;
    matter = await t.matters.create(
      org,
      user,
      { title: "Caso L", client_name: "C", materiality: "MATERIAL", practice_areas: ["CIVIL"], jurisdiction: "Colombia" },
      "IUS-L-001",
    );
  });

  it("una tarea transita PENDIENTE → EN_CURSO → COMPLETADA y persiste", async () => {
    const id = await t.tasks.create({ organizationId: org, matterId: matter, title: "Redactar", createdBy: user });
    await t.tasks.setStatus(org, id, "EN_CURSO");
    await t.tasks.setStatus(org, id, "COMPLETADA");
    const task = await t.tasks.findById(org, id);
    expect(task?.status).toBe("COMPLETADA");
  });

  it("una tarea completada deja de contar como vencida", async () => {
    const id = await t.tasks.create({
      organizationId: org,
      matterId: matter,
      title: "Vencida",
      dueAt: "2020-01-01T00:00:00.000Z",
      createdBy: user,
    });
    expect(await t.tasks.overdue(org, null)).toHaveLength(1);
    await t.tasks.setStatus(org, id, "COMPLETADA");
    expect(await t.tasks.overdue(org, null)).toHaveLength(0);
  });
});

describe("semántica de cancelación de ejecución", () => {
  let t: TestDb;
  let org: string, user: string, matter: string;

  beforeEach(async () => {
    t = createTestDb();
    const seed = await seedFirm(t, { orgName: "Firma X", directorEmail: "x@x.test" });
    org = seed.organizationId;
    user = seed.directorUserId;
    matter = await t.matters.create(
      org,
      user,
      { title: "Caso X", client_name: "C", materiality: "MATERIAL", practice_areas: ["CIVIL"], jurisdiction: "Colombia" },
      "IUS-X-001",
    );
  });

  it("una ejecución en curso puede cancelarse", async () => {
    const id = await t.executions.create({
      organizationId: org,
      matterId: matter,
      agentId: "pisoso-orquestador-juridico",
      parentExecutionId: null,
      rootExecutionId: null,
      startedBy: user,
    });
    await t.executions.transition(id, "RUNNING");
    await t.executions.transition(id, "CANCELLED", { errorCode: "CANCELLED_BY_USER" });
    const row = await t.executions.findById(id);
    expect(row?.status).toBe("CANCELLED");
    expect(row?.completedAt).not.toBeNull();
  });

  it("una ejecución ya finalizada no puede volver a cancelarse (CONFLICT)", async () => {
    const id = await t.executions.create({
      organizationId: org,
      matterId: matter,
      agentId: "pisoso-orquestador-juridico",
      parentExecutionId: null,
      rootExecutionId: null,
      startedBy: user,
    });
    await t.executions.transition(id, "RUNNING");
    await t.executions.transition(id, "COMPLETED");
    await expect(t.executions.transition(id, "CANCELLED")).rejects.toSatisfy(
      (e: unknown) => isIusiaError(e) && e.code === "CONFLICT",
    );
  });
});
