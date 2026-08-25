import { beforeEach, describe, expect, it } from "vitest";
import { FIRM_ROLES, SYSTEM_ROLES, isIusiaError, isSystemRole } from "@iusia/domain";
import { addUser, createTestDb, seedFirm, type TestDb } from "./harness.js";

/**
 * Sprint 7.8 — SYSTEM_SUPERADMIN.
 *
 * Autoridad GLOBAL sobre IUSIA como plataforma. Es un plano de autorización distinto
 * del rol de firma y del ACL de expediente: tenerlo no abre ningún Matter, y ser
 * director de una firma no lo concede. La única fuente de verdad es el servidor.
 */

const CAPABILITY = "system.diagnostics";

/** Concede autoridad de sistema como sólo puede hacerse: escribiendo en el servidor. */
function grantSystemRole(t: TestDb, userId: string): void {
  t.raw.prepare("UPDATE user SET system_role = ? WHERE id = ?").run("SYSTEM_SUPERADMIN", userId);
}

describe("SYSTEM_SUPERADMIN — separación de planos", () => {
  let t: TestDb;
  let orgId: string;
  let directorId: string;
  let lawyerId: string;

  beforeEach(async () => {
    t = createTestDb();
    const firm = await seedFirm(t, { orgName: "Pisoso Legal", directorEmail: "dir@pisoso.test" });
    orgId = firm.organizationId;
    directorId = firm.directorUserId;
    lawyerId = addUser(t, orgId, "abogado@pisoso.test", "LAWYER");
  });

  it("SYSTEM_SUPERADMIN_NOT_ORGANIZATION_ROLE", () => {
    // El enum de roles de firma no lo contiene: no es un rol de tenant.
    expect(FIRM_ROLES).not.toContain("SYSTEM_SUPERADMIN" as never);
    expect(SYSTEM_ROLES).toEqual(["SYSTEM_SUPERADMIN"]);
    for (const role of FIRM_ROLES) expect(isSystemRole(role)).toBe(false);
  });

  it("NORMAL_USER_DENIED_SYSTEM_CAPABILITY", async () => {
    await expect(t.authz.requireSystemSuperadmin(lawyerId, CAPABILITY, orgId)).rejects.toSatisfy(
      (e: unknown) => isIusiaError(e) && e.code === "FORBIDDEN",
    );
    expect(await t.authz.isSystemSuperadmin(lawyerId)).toBe(false);
  });

  it("FIRM_DIRECTOR_DENIED_SYSTEM_CAPABILITY", async () => {
    // Dirigir una firma es autoridad de tenant, no de plataforma.
    expect(await t.authz.firmRole(orgId, directorId)).toBe("FIRM_DIRECTOR");
    expect(await t.authz.isSystemSuperadmin(directorId)).toBe(false);
    await expect(
      t.authz.requireSystemSuperadmin(directorId, CAPABILITY, orgId),
    ).rejects.toThrow();
  });

  it("SYSTEM_SUPERADMIN_AUTHORIZED_FOR_SYSTEM_CAPABILITY", async () => {
    grantSystemRole(t, directorId);
    await expect(
      t.authz.requireSystemSuperadmin(directorId, CAPABILITY, orgId),
    ).resolves.toBeUndefined();
    expect(await t.authz.systemRole(directorId)).toBe("SYSTEM_SUPERADMIN");
  });

  it("SYSTEM_SUPERADMIN_AND_FIRM_DIRECTOR_CAN_COEXIST", async () => {
    grantSystemRole(t, directorId);
    // La misma identidad conserva ambos alcances; uno no sustituye al otro.
    expect(await t.authz.isSystemSuperadmin(directorId)).toBe(true);
    expect(await t.authz.firmRole(orgId, directorId)).toBe("FIRM_DIRECTOR");
  });

  it("la denegación queda auditada (rastro server-side)", async () => {
    await t.authz.requireSystemSuperadmin(lawyerId, CAPABILITY, orgId).catch(() => undefined);
    const rows = t.raw
      .prepare("SELECT action, outcome, resource_id FROM audit_events WHERE actor_user_id = ?")
      .all(lawyerId) as Array<{ action: string; outcome: string; resource_id: string }>;
    expect(rows.some((r) => r.action === "system.capability.denied" && r.outcome === "DENIED")).toBe(
      true,
    );
  });

  it("SYSTEM_SUPERADMIN_BOOTSTRAP_IDEMPOTENT", async () => {
    grantSystemRole(t, directorId);
    grantSystemRole(t, directorId); // repetir no cambia el estado
    const rows = t.raw
      .prepare("SELECT COUNT(*) AS n FROM user WHERE system_role = 'SYSTEM_SUPERADMIN'")
      .all() as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(1);
    expect(await t.authz.isSystemSuperadmin(directorId)).toBe(true);
  });
});

describe("escalada de privilegios", () => {
  let t: TestDb;
  let orgId: string;
  let directorId: string;
  let lawyerId: string;

  beforeEach(async () => {
    t = createTestDb();
    const firm = await seedFirm(t, { orgName: "Pisoso Legal", directorEmail: "dir@pisoso.test" });
    orgId = firm.organizationId;
    directorId = firm.directorUserId;
    lawyerId = addUser(t, orgId, "abogado@pisoso.test", "LAWYER");
  });

  it("[A] un LAWYER no obtiene autoridad de sistema por su rol de firma", async () => {
    expect(await t.authz.isSystemSuperadmin(lawyerId)).toBe(false);
  });

  it("[B] un FIRM_DIRECTOR no puede concederla por la vía de roles de organización", async () => {
    // El rol de miembro es el único canal que controla un director, y no expresa
    // autoridad de sistema: escribirlo ahí no cambia `user.system_role`.
    t.raw
      .prepare("UPDATE member SET role = ? WHERE organization_id = ? AND user_id = ?")
      .run("SYSTEM_SUPERADMIN", orgId, lawyerId);
    expect(await t.authz.isSystemSuperadmin(lawyerId)).toBe(false);
    await expect(t.authz.requireSystemSuperadmin(lawyerId, CAPABILITY, orgId)).rejects.toThrow();
  });

  it("[E] un valor arbitrario en system_role no concede autoridad", async () => {
    for (const bogus of ["superadmin", "ADMIN", "true", "1", "FIRM_DIRECTOR", ""]) {
      t.raw.prepare("UPDATE user SET system_role = ? WHERE id = ?").run(bogus, lawyerId);
      expect(await t.authz.isSystemSuperadmin(lawyerId), bogus).toBe(false);
    }
  });

  it("NO_CROSS_TENANT_PRIVILEGE_ESCALATION: la autoridad no se hereda entre firmas", async () => {
    const otra = await seedFirm(t, { orgName: "Otra Firma", directorEmail: "dir@otra.test" });
    grantSystemRole(t, directorId);
    // Ser superadmin no otorga rol de firma en un tenant ajeno.
    expect(await t.authz.firmRole(otra.organizationId, directorId)).toBeNull();
  });

  it("MATTER_ACL_UNCHANGED: el superadmin no puede abrir un expediente ajeno", async () => {
    const otra = await seedFirm(t, { orgName: "Otra Firma", directorEmail: "dir@otra.test" });
    const matterAjeno = await t.matters.create(
      otra.organizationId,
      otra.directorUserId,
      {
        title: "Caso ajeno",
        client_name: "Cliente",
        materiality: "MATERIAL",
        practice_areas: ["CIVIL"],
        jurisdiction: "Colombia",
      },
      "IUS-OTRA-001",
    );
    grantSystemRole(t, directorId);
    // Fail-closed: la autoridad de plataforma NO es una llave maestra de expedientes.
    await expect(
      t.authz.authorizeMatter(otra.organizationId, directorId, matterAjeno, "matter:read"),
    ).rejects.toThrow();
  });
});
