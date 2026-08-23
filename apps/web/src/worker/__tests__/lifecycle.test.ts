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

describe("ciclo de revisión documental", () => {
  let t: TestDb;
  let org: string, user: string, matter: string;

  beforeEach(async () => {
    t = createTestDb();
    const seed = await seedFirm(t, { orgName: "Firma D", directorEmail: "d@d.test" });
    org = seed.organizationId;
    user = seed.directorUserId;
    matter = await t.matters.create(
      org,
      user,
      { title: "Caso D", client_name: "C", materiality: "MATERIAL", practice_areas: ["CIVIL"], jurisdiction: "Colombia" },
      "IUS-D-001",
    );
  });

  it("un documento transita PENDIENTE → EN_REVISION → APROBADO y persiste", async () => {
    const id = await t.documents.link({
      organizationId: org,
      matterId: matter,
      driveFileId: "drive_doc_1",
      name: "Contrato.pdf",
      mimeType: "application/pdf",
      linkedBy: user,
    });
    await t.documents.setStatus(org, id, "EN_REVISION");
    await t.documents.setStatus(org, id, "APROBADO");
    const doc = await t.documents.findById(org, id);
    expect(doc?.status).toBe("APROBADO");
  });

  it("el estado documental está aislado por organización", async () => {
    const id = await t.documents.link({
      organizationId: org,
      matterId: matter,
      driveFileId: "drive_doc_2",
      name: "Anexo.pdf",
      mimeType: "application/pdf",
      linkedBy: user,
    });
    // Otra organización no encuentra el documento por id directo.
    expect(await t.documents.findById("org_ajena", id)).toBeNull();
    expect(await t.documents.findById(org, id)).not.toBeNull();
  });

  it("re-link del mismo (matter, driveFileId) es idempotente: mismo id, sin duplicar", async () => {
    const first = await t.documents.link({
      organizationId: org,
      matterId: matter,
      driveFileId: "drive_dup_1",
      name: "Fixture.txt",
      mimeType: "text/plain",
      linkedBy: user,
    });
    const second = await t.documents.link({
      organizationId: org,
      matterId: matter,
      driveFileId: "drive_dup_1",
      name: "Fixture-otra-vez.txt", // metadata distinta: no debe crear otro documento
      mimeType: "text/plain",
      linkedBy: user,
    });
    // Devuelve el id EXISTENTE (nunca un id fantasma no persistido).
    expect(second).toBe(first);
    expect(await t.documents.findById(org, second)).not.toBeNull();
    // Sólo hay un documento lógico para esa clave.
    const rows = await t.documents.listForMatter(org, matter);
    expect(rows.filter((r) => r.driveFileId === "drive_dup_1")).toHaveLength(1);
  });

  it("distinto driveFileId sí crea documentos distintos", async () => {
    const a = await t.documents.link({
      organizationId: org, matterId: matter, driveFileId: "drive_a",
      name: "A.txt", mimeType: "text/plain", linkedBy: user,
    });
    const b = await t.documents.link({
      organizationId: org, matterId: matter, driveFileId: "drive_b",
      name: "B.txt", mimeType: "text/plain", linkedBy: user,
    });
    expect(a).not.toBe(b);
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
