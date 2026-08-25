import { beforeEach, describe, expect, it } from "vitest";
import { FirmRole, isIusiaError } from "@iusia/domain";
import { assertNotLastDirector } from "../routes/admin.js";
import { addUser, createTestDb, seedFirm, type TestDb } from "./harness.js";

/**
 * Sprint 7.9 — administración de la firma.
 *
 * La membresía y los roles los gobierna Better Auth; IUSIA añade la integridad
 * operacional del tenant (que nunca quede sin dirección) y el acceso por Matter.
 */

describe("protección del último director", () => {
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

  it("LAST_FIRM_DIRECTOR_CANNOT_BE_DEMOTED", async () => {
    await expect(
      assertNotLastDirector(t.db, orgId, directorId, "degradar"),
    ).rejects.toSatisfy((e: unknown) => isIusiaError(e) && e.code === "CONFLICT");
  });

  it("LAST_FIRM_DIRECTOR_CANNOT_BE_REMOVED", async () => {
    await expect(
      assertNotLastDirector(t.db, orgId, directorId, "retirar"),
    ).rejects.toThrow(/sin dirección/);
  });

  it("con dos directores, cualquiera puede degradarse o retirarse", async () => {
    addUser(t, orgId, "dir2@pisoso.test", "FIRM_DIRECTOR");
    await expect(
      assertNotLastDirector(t.db, orgId, directorId, "degradar"),
    ).resolves.toBeUndefined();
  });

  it("retirar a un no-director nunca está bloqueado por esta guarda", async () => {
    await expect(
      assertNotLastDirector(t.db, orgId, lawyerId, "retirar"),
    ).resolves.toBeUndefined();
  });

  it("la guarda es por organización: el director de otra firma no cuenta", async () => {
    const otra = await seedFirm(t, { orgName: "Otra", directorEmail: "dir@otra.test" });
    // Aunque exista un director en OTRA firma, éste sigue siendo el último de la suya.
    expect(otra.directorUserId).toBeTruthy();
    await expect(assertNotLastDirector(t.db, orgId, directorId, "retirar")).rejects.toThrow();
  });
});

describe("seguridad de roles", () => {
  it("DIRECTOR_CANNOT_ASSIGN_SYSTEM_SUPERADMIN: el schema de rol lo rechaza", () => {
    // La ruta valida con `FirmRole`: un rol de sistema no es un valor admisible.
    expect(FirmRole.safeParse("SYSTEM_SUPERADMIN").success).toBe(false);
    expect(FirmRole.safeParse("FIRM_DIRECTOR").success).toBe(true);
  });

  it("SYSTEM_SUPERADMIN_NOT_INVITABLE_ROLE / NOT_MEMBER_ROLE", () => {
    for (const bogus of ["SYSTEM_SUPERADMIN", "SUPERADMIN", "admin", "owner"]) {
      expect(FirmRole.safeParse(bogus).success, bogus).toBe(false);
    }
  });

  it("MEMBER_CANNOT_CHANGE_OWN_ROLE sin ser administración de la firma", async () => {
    const t = createTestDb();
    const firm = await seedFirm(t, { orgName: "Pisoso Legal", directorEmail: "dir@pisoso.test" });
    const lawyer = addUser(t, firm.organizationId, "abogado@pisoso.test", "LAWYER");
    // `requireFirmAdmin` exige FIRM_DIRECTOR o PARTNER: un LAWYER no administra.
    const role = await t.authz.firmRole(firm.organizationId, lawyer);
    expect(role).toBe("LAWYER");
    expect(["FIRM_DIRECTOR", "PARTNER"]).not.toContain(role);
  });

  it("CROSS_TENANT_MEMBER_ADMIN_DENIED: no hay rol en una firma ajena", async () => {
    const t = createTestDb();
    const a = await seedFirm(t, { orgName: "Firma A", directorEmail: "a@a.test" });
    const b = await seedFirm(t, { orgName: "Firma B", directorEmail: "b@b.test" });
    expect(await t.authz.firmRole(b.organizationId, a.directorUserId)).toBeNull();
  });
});
