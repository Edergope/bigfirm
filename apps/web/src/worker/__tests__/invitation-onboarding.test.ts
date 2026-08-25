import { beforeEach, describe, expect, it } from "vitest";
import { FIRM_ROLES } from "@iusia/domain";
import {
  INVITATION_HEADER,
  authorizeOnboarding,
  findPendingInvitation,
  isProviderAssertedSignup,
  readInvitationId,
} from "../auth/invitation-guard.js";
import { createTestDb, seedFirm, type TestDb } from "./harness.js";

/**
 * Sprint 7.9 — onboarding SÓLO POR INVITACIÓN.
 *
 * El residuo del 7.8 era que `/sign-up/email` podía crear una identidad pública.
 * El cierre real ocurre en el hook `user.create.before`: estas pruebas ejercitan la
 * decisión que ese hook toma, incluyendo la exigencia de PRUEBA DE CONTROL del email.
 */

const DAY = 24 * 60 * 60 * 1000;

function insertInvitation(
  t: TestDb,
  args: {
    organizationId: string;
    inviterId: string;
    email: string;
    role?: string;
    status?: string;
    expiresAt?: number;
  },
): string {
  const id = `inv_${Math.random().toString(36).slice(2, 12)}`;
  t.raw
    .prepare(
      "INSERT INTO invitation (id, organization_id, email, role, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      args.organizationId,
      args.email,
      args.role ?? "LAWYER",
      args.status ?? "pending",
      args.expiresAt ?? Date.now() + 7 * DAY,
      Date.now(),
      args.inviterId,
    );
  return id;
}

const credentialCtx = (invitationId?: string) => ({
  path: "/sign-up/email",
  headers: new Headers(invitationId ? { [INVITATION_HEADER]: invitationId } : {}),
});
const googleCtx = { path: "/callback/google", headers: new Headers() };

describe("cierre del alta pública", () => {
  let t: TestDb;
  let orgId: string;
  let directorId: string;

  beforeEach(async () => {
    t = createTestDb();
    const firm = await seedFirm(t, { orgName: "Pisoso Legal", directorEmail: "dir@pisoso.test" });
    orgId = firm.organizationId;
    directorId = firm.directorUserId;
  });

  it("PUBLIC_EMAIL_SIGNUP_WITHOUT_INVITE_DENIED", async () => {
    const d = await authorizeOnboarding({
      db: t.db,
      email: "anonimo@ejemplo.test",
      userData: { emailVerified: false },
      context: credentialCtx(),
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("NO_PENDING_INVITATION");
  });

  it("PUBLIC_GOOGLE_UNKNOWN_USER_WITHOUT_INVITE_DENIED", async () => {
    const d = await authorizeOnboarding({
      db: t.db,
      email: "desconocido@gmail.test",
      userData: { emailVerified: true },
      context: googleCtx,
    });
    expect(d.allowed).toBe(false);
  });

  it("PUBLIC_SIGNUP_DOES_NOT_CREATE_USER (aserción de base de datos)", async () => {
    const before = t.raw.prepare("SELECT COUNT(*) AS n FROM user").get() as { n: number };
    const d = await authorizeOnboarding({
      db: t.db,
      email: "intruso@ejemplo.test",
      userData: { emailVerified: false },
      context: credentialCtx("inv_inventado"),
    });
    expect(d.allowed).toBe(false);
    // El hook aborta antes de escribir: no hay usuario, miembro ni organización nuevos.
    const after = t.raw.prepare("SELECT COUNT(*) AS n FROM user").get() as { n: number };
    expect(after.n).toBe(before.n);
    const members = t.raw.prepare("SELECT COUNT(*) AS n FROM member").get() as { n: number };
    expect(members.n).toBe(1);
    const orgs = t.raw.prepare("SELECT COUNT(*) AS n FROM organization").get() as { n: number };
    expect(orgs.n).toBe(1);
  });

  it("VALID_INVITED_EMAIL_CAN_ONBOARD (con posesión del enlace)", async () => {
    const id = insertInvitation(t, { organizationId: orgId, inviterId: directorId, email: "nuevo@pisoso.test" });
    const d = await authorizeOnboarding({
      db: t.db,
      email: "nuevo@pisoso.test",
      userData: { emailVerified: false },
      context: credentialCtx(id),
    });
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.invitation.organizationId).toBe(orgId);
  });

  it("INVITATION_PROOF_REQUIRED: conocer el email invitado NO basta", async () => {
    insertInvitation(t, { organizationId: orgId, inviterId: directorId, email: "nuevo@pisoso.test" });
    const d = await authorizeOnboarding({
      db: t.db,
      email: "nuevo@pisoso.test",
      userData: { emailVerified: false },
      context: credentialCtx(), // sin el id recibido por correo
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("INVITATION_PROOF_REQUIRED");
  });

  it("INVITATION_TOKEN_TAMPERING_REJECTED", async () => {
    const id = insertInvitation(t, { organizationId: orgId, inviterId: directorId, email: "nuevo@pisoso.test" });
    const d = await authorizeOnboarding({
      db: t.db,
      email: "nuevo@pisoso.test",
      userData: { emailVerified: false },
      context: credentialCtx(id + "x"),
    });
    expect(d.allowed).toBe(false);
  });

  it("VALID_INVITED_GOOGLE_IDENTITY_CAN_ONBOARD (el proveedor asevera el email)", async () => {
    insertInvitation(t, { organizationId: orgId, inviterId: directorId, email: "google@pisoso.test" });
    const d = await authorizeOnboarding({
      db: t.db,
      email: "google@pisoso.test",
      userData: { emailVerified: true },
      context: googleCtx,
    });
    expect(d.allowed).toBe(true);
  });

  it("INVITATION_EMAIL_MISMATCH_DENIED: Google con otro correo no reasigna la invitación", async () => {
    insertInvitation(t, { organizationId: orgId, inviterId: directorId, email: "invitado@pisoso.test" });
    const d = await authorizeOnboarding({
      db: t.db,
      email: "otro@gmail.test",
      userData: { emailVerified: true },
      context: googleCtx,
    });
    expect(d.allowed).toBe(false);
  });

  it("EXPIRED_INVITATION_DENIED", async () => {
    const id = insertInvitation(t, {
      organizationId: orgId,
      inviterId: directorId,
      email: "tarde@pisoso.test",
      expiresAt: Date.now() - DAY,
    });
    const d = await authorizeOnboarding({
      db: t.db,
      email: "tarde@pisoso.test",
      userData: { emailVerified: false },
      context: credentialCtx(id),
    });
    expect(d.allowed).toBe(false);
  });

  it("USED_INVITATION_DENIED y REVOKED_INVITATION_DENIED", async () => {
    for (const status of ["accepted", "canceled", "rejected"]) {
      const id = insertInvitation(t, {
        organizationId: orgId,
        inviterId: directorId,
        email: `${status}@pisoso.test`,
        status,
      });
      const d = await authorizeOnboarding({
        db: t.db,
        email: `${status}@pisoso.test`,
        userData: { emailVerified: false },
        context: credentialCtx(id),
      });
      expect(d.allowed, status).toBe(false);
    }
  });

  it("CROSS_ORGANIZATION_INVITATION: la organización la fija el servidor, no el cliente", async () => {
    const otra = await seedFirm(t, { orgName: "Otra Firma", directorEmail: "dir@otra.test" });
    const id = insertInvitation(t, {
      organizationId: otra.organizationId,
      inviterId: otra.directorUserId,
      email: "cruzado@otra.test",
      role: "LAWYER",
    });
    const d = await authorizeOnboarding({
      db: t.db,
      email: "cruzado@otra.test",
      userData: { emailVerified: false },
      // El "cliente" pretende otra organización/rol: la decisión no los lee.
      context: { ...credentialCtx(id), body: { organizationId: orgId, role: "FIRM_DIRECTOR" } },
    });
    expect(d.allowed).toBe(true);
    if (d.allowed) {
      expect(d.invitation.organizationId).toBe(otra.organizationId);
      expect(d.invitation.role).toBe("LAWYER");
    }
  });

  it("SYSTEM_SUPERADMIN no es un rol de invitación", () => {
    expect(FIRM_ROLES).not.toContain("SYSTEM_SUPERADMIN" as never);
  });
});

describe("utilidades del guard", () => {
  it("readInvitationId acepta cabecera, cuerpo y query; nunca deduce del email", () => {
    expect(readInvitationId({ headers: new Headers({ [INVITATION_HEADER]: "inv_a" }) })).toBe("inv_a");
    expect(readInvitationId({ body: { invitationId: "inv_b" } })).toBe("inv_b");
    expect(readInvitationId({ request: { url: "https://x.test/cb?invitationId=inv_c" } })).toBe("inv_c");
    expect(readInvitationId({ body: { email: "a@b.test" } })).toBeNull();
    expect(readInvitationId(null)).toBeNull();
  });

  it("isProviderAssertedSignup distingue contraseña de OAuth", () => {
    expect(isProviderAssertedSignup({ emailVerified: false }, { path: "/sign-up/email" })).toBe(false);
    expect(isProviderAssertedSignup({ emailVerified: true }, { path: "/callback/google" })).toBe(true);
    // Sin ruta conocida, el email verificado por el proveedor es el discriminante.
    expect(isProviderAssertedSignup({ emailVerified: true }, {})).toBe(true);
    expect(isProviderAssertedSignup({ emailVerified: false }, {})).toBe(false);
  });

  it("findPendingInvitation normaliza el email", async () => {
    const t = createTestDb();
    const firm = await seedFirm(t, { orgName: "F", directorEmail: "d@f.test" });
    insertInvitation(t, { organizationId: firm.organizationId, inviterId: firm.directorUserId, email: "caso@f.test" });
    expect(await findPendingInvitation(t.db, "  CASO@F.TEST  ")).not.toBeNull();
    expect(await findPendingInvitation(t.db, "")).toBeNull();
  });
});
