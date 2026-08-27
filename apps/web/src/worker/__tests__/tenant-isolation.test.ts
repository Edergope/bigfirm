import { beforeEach, describe, expect, it } from "vitest";
import { isIusiaError } from "@iusia/domain";
import { addUser, createTestDb, seedFirm, type TestDb } from "./harness.js";

/**
 * CERTIFICACIÓN DE AISLAMIENTO MULTI-TENANT.
 *
 * Escenario canónico del prompt maestro:
 *   Organización A (usuario A, matter A)   Organización B (usuario B, matter B)
 * La regla dura: conocer el UUID de un expediente de OTRA firma nunca concede acceso.
 * La denegación ocurre en el servidor (AuthorizationService), no en el frontend.
 */
describe("aislamiento entre firmas", () => {
  let t: TestDb;
  let orgA: string, dirA: string, matterA: string;
  let orgB: string, dirB: string, matterB: string;

  beforeEach(async () => {
    t = createTestDb();

    const a = await seedFirm(t, { orgName: "Firma A", directorEmail: "a@a.test" });
    orgA = a.organizationId;
    dirA = a.directorUserId;
    matterA = await t.matters.create(orgA, dirA, matterInput("Caso A"), "IUS-A-001");

    const b = await seedFirm(t, { orgName: "Firma B", directorEmail: "b@b.test" });
    orgB = b.organizationId;
    dirB = b.directorUserId;
    matterB = await t.matters.create(orgB, dirB, matterInput("Caso B"), "IUS-B-001");
  });

  it("el director de A accede a su propio matter", async () => {
    const decision = await t.authz.authorizeMatter(orgA, dirA, matterA, "matter:read");
    expect(decision.allowed).toBe(true);
  });

  it("el director de A NO accede al matter de B, aunque conozca el UUID", async () => {
    // Pasa el organizationId de A (su tenant activo) con el matterId de B.
    await expectDenied(() =>
      t.authz.authorizeMatter(orgA, dirA, matterB, "matter:read"),
    );
  });

  it("el director de B NO accede al matter de A", async () => {
    await expectDenied(() =>
      t.authz.authorizeMatter(orgB, dirB, matterA, "matter:read"),
    );
  });

  it("no se puede escalar suplantando el organization_id de la otra firma", async () => {
    // Un atacante de A intenta pasar el orgId de B para colarse en el matter de B.
    // Al no ser miembro de B, firmRole=null → FORBIDDEN.
    await expectForbidden(() =>
      t.authz.authorizeMatter(orgB, dirA, matterB, "matter:read"),
    );
  });

  it("el listado de matters de A nunca incluye expedientes de B", async () => {
    const forDirectorA = await t.matters.listForUser(orgA, dirA, { includeAll: true });
    const ids = forDirectorA.map((m) => m.id);
    expect(ids).toContain(matterA);
    expect(ids).not.toContain(matterB);
  });

  it("findById filtra por organización: A no puede leer el matter de B por id directo", async () => {
    expect(await t.matters.findById(orgA, matterB)).toBeNull();
    expect(await t.matters.findById(orgB, matterB)).not.toBeNull();
  });

  it("los documentos de B no aparecen consultados desde el tenant A", async () => {
    await t.documents.link({
      organizationId: orgB,
      matterId: matterB,
      driveFileId: "drive_secreto_B",
      name: "Contrato confidencial B",
      mimeType: "application/pdf",
      linkedBy: dirB,
    });
    const fromA = await t.documents.listForMatter(orgA, matterB);
    expect(fromA).toHaveLength(0);
    const fromB = await t.documents.listForMatter(orgB, matterB);
    expect(fromB).toHaveLength(1);
  });

  it("los hechos y autoridades están aislados por organización", async () => {
    await t.facts.upsertMany(
      orgB,
      matterB,
      [
        {
          fact_id: "F1",
          statement: "hecho confidencial de B",
          certainty: "[F]",
          source_class: "Class A",
          primary_source: "doc B",
          numbers: [],
        },
      ],
      null,
    );
    expect(await t.facts.listForMatter(orgA, matterB)).toHaveLength(0);
    expect(await t.facts.listForMatter(orgB, matterB)).toHaveLength(1);
  });
});

/**
 * ACL por Matter dentro de una misma firma: pertenecer a la firma no basta.
 */
describe("ACL por Matter dentro de una firma", () => {
  let t: TestDb;
  let org: string, director: string, lawyerOwner: string, otherLawyer: string, matter: string;

  beforeEach(async () => {
    t = createTestDb();
    const seed = await seedFirm(t, { orgName: "Firma X", directorEmail: "x@x.test" });
    org = seed.organizationId;
    director = seed.directorUserId;
    lawyerOwner = addUser(t, org, "owner@x.test", "LAWYER");
    otherLawyer = addUser(t, org, "other@x.test", "LAWYER");
    // El owner crea el matter (queda OWNER); el otro abogado NO es miembro.
    matter = await t.matters.create(org, lawyerOwner, matterInput("Caso X"), "IUS-X-001");
  });

  it("el owner del matter tiene acceso; otro abogado de la misma firma no", async () => {
    expect((await t.authz.authorizeMatter(org, lawyerOwner, matter, "matter:read")).allowed).toBe(true);
    await expectDenied(() =>
      t.authz.authorizeMatter(org, otherLawyer, matter, "matter:read"),
    );
  });

  it("un LAWYER con ACL OWNER puede leer, adjuntar/versionar y publicar entregables", async () => {
    await expect(t.authz.authorizeMatter(org, lawyerOwner, matter, "document:read")).resolves.toMatchObject({
      allowed: true,
    });
    await expect(t.authz.authorizeMatter(org, lawyerOwner, matter, "document:link")).resolves.toMatchObject({
      allowed: true,
    });
    await expect(t.authz.authorizeMatter(org, lawyerOwner, matter, "deliverable:publish")).resolves.toMatchObject({
      allowed: true,
    });
  });

  it("el director supervisa en lectura, pero no puede escribir por supervisión", async () => {
    const read = await t.authz.authorizeMatter(org, director, matter, "matter:read");
    expect(read.allowed).toBe(true);
    expect(read.viaSupervision).toBe(true);
    await expectDenied(() =>
      t.authz.authorizeMatter(org, director, matter, "document:read"),
    );
    await expectDenied(() =>
      t.authz.authorizeMatter(org, director, matter, "fact:read"),
    );
    await expectDenied(() =>
      t.authz.authorizeMatter(org, director, matter, "matter:update"),
    );
  });

  it("FIRM_DIRECTOR puede cancelar una ejecución de su firma sin recibir ACL de contenido", async () => {
    const root = await t.executions.create({
      organizationId: org,
      matterId: matter,
      agentId: "pisoso-orquestador-juridico",
      parentExecutionId: null,
      rootExecutionId: null,
      startedBy: lawyerOwner,
    });

    await expect(t.authz.authorizeExecutionCancel(director, {
      organizationId: org,
      matterId: matter,
      id: root,
      status: "RUNNING",
    })).resolves.toMatchObject({
      actorControlRole: "FIRM_DIRECTOR",
      reason: "CANCELLED_BY_FIRM_DIRECTOR",
    });
    await expectDenied(() =>
      t.authz.authorizeMatter(org, director, matter, "document:read"),
    );
  });

  it("un FIRM_DIRECTOR de otra organización no puede cancelar la ejecución", async () => {
    const otherFirm = await seedFirm(t, { orgName: "Firma Y", directorEmail: "y@y.test" });
    const root = await t.executions.create({
      organizationId: org,
      matterId: matter,
      agentId: "pisoso-orquestador-juridico",
      parentExecutionId: null,
      rootExecutionId: null,
      startedBy: lawyerOwner,
    });

    await expectForbidden(() =>
      t.authz.authorizeExecutionCancel(otherFirm.directorUserId, {
        organizationId: org,
        matterId: matter,
        id: root,
        status: "RUNNING",
      }),
    );
  });

  it("un miembro ordinario de la firma sin ACL del Matter no puede cancelar", async () => {
    const root = await t.executions.create({
      organizationId: org,
      matterId: matter,
      agentId: "pisoso-orquestador-juridico",
      parentExecutionId: null,
      rootExecutionId: null,
      startedBy: lawyerOwner,
    });

    await expectDenied(() =>
      t.authz.authorizeExecutionCancel(otherLawyer, {
        organizationId: org,
        matterId: matter,
        id: root,
        status: "RUNNING",
      }),
    );
  });

  it("un READ_ONLY no puede iniciar ejecuciones de IA", async () => {
    const reader = addUser(t, org, "reader@x.test", "LAWYER");
    await t.matters.addMember(org, matter, reader, "READ_ONLY", lawyerOwner);
    expect((await t.authz.authorizeMatter(org, reader, matter, "matter:read")).allowed).toBe(true);
    await expectDenied(() =>
      t.authz.authorizeMatter(org, reader, matter, "execution:start"),
    );
  });

  it("la revocación de membresía retira el acceso", async () => {
    const collab = addUser(t, org, "collab@x.test", "LAWYER");
    await t.matters.addMember(org, matter, collab, "COLLABORATOR", lawyerOwner);
    expect((await t.authz.authorizeMatter(org, collab, matter, "matter:read")).allowed).toBe(true);
    await t.matters.revokeMember(matter, collab);
    await expectDenied(() =>
      t.authz.authorizeMatter(org, collab, matter, "matter:read"),
    );
  });

  it("ASSIGN_MATTER_LEAD mantiene un único OWNER activo y conserva al anterior como colaborador", async () => {
    const newLead = addUser(t, org, "nuevo-lider@x.test", "LAWYER");
    const result = await t.matters.assignLead(org, matter, newLead, director);
    expect(result.previousOwnerIds).toEqual([lawyerOwner]);
    expect(await t.matters.roleFor(matter, newLead)).toBe("OWNER");
    expect(await t.matters.roleFor(matter, lawyerOwner)).toBe("COLLABORATOR");
    expect((await t.matters.listMembers(matter)).filter((member) => member.role === "OWNER")).toHaveLength(1);
  });

  it("un miembro de firma recién añadido no ve matters hasta recibir ACL explícito", async () => {
    const invitedLawyer = addUser(t, org, "invitado@x.test", "LAWYER");
    expect(await t.matters.listForUser(org, invitedLawyer, { includeAll: false })).toHaveLength(0);
    await t.matters.addMember(org, matter, invitedLawyer, "ASSISTANT", lawyerOwner);
    expect((await t.matters.listForUser(org, invitedLawyer, { includeAll: false })).map((row) => row.id)).toEqual([matter]);
  });

  it("una denegación queda registrada en el audit ledger", async () => {
    await expectDenied(() =>
      t.authz.authorizeMatter(org, otherLawyer, matter, "matter:read"),
    );
    const trail = await t.audit.listForMatter(org, matter, 10);
    expect(trail.some((e) => e.outcome === "DENIED")).toBe(true);
  });
});

function matterInput(title: string) {
  return {
    title,
    client_name: "Cliente",
    materiality: "MATERIAL" as const,
    practice_areas: ["COMERCIAL_CONTRACTUAL" as const],
    jurisdiction: "Colombia",
  };
}

async function expectDenied(fn: () => Promise<unknown>) {
  // El servidor devuelve NOT_FOUND ante acceso denegado a un matter, para no
  // filtrar la existencia de expedientes de otras firmas o equipos.
  try {
    await fn();
    throw new Error("se esperaba denegación pero se concedió acceso");
  } catch (e) {
    expect(isIusiaError(e)).toBe(true);
    if (isIusiaError(e)) expect(["NOT_FOUND", "FORBIDDEN"]).toContain(e.code);
  }
}

async function expectForbidden(fn: () => Promise<unknown>) {
  try {
    await fn();
    throw new Error("se esperaba FORBIDDEN");
  } catch (e) {
    expect(isIusiaError(e)).toBe(true);
    if (isIusiaError(e)) expect(e.code).toBe("FORBIDDEN");
  }
}
