import { describe, expect, it } from "vitest";
import { FIRM_ROLES, FirmRole, isIusiaError } from "@iusia/domain";
import {
  assertInvitationAdminRole,
  serverInvitationPayload,
} from "../routes/admin.js";

describe("creación server-side de invitaciones", () => {
  it("ACTIVE_ORGANIZATION_NULL + SESSION_ORGANIZATION_VALID -> payload con tenant explícito", () => {
    const payload = serverInvitationPayload("org_server_owned", {
      email: "abogada@firma.test",
      role: "LAWYER",
    });
    expect(payload).toEqual({
      email: "abogada@firma.test",
      role: "LAWYER",
      organizationId: "org_server_owned",
    });
  });

  it("preserva exactamente cada rol válido como rol de invitación", () => {
    for (const role of FIRM_ROLES) {
      expect(FirmRole.parse(role)).toBe(role);
      expect(serverInvitationPayload("org_a", { email: "persona@firma.test", role }).role).toBe(role);
    }
  });

  it("FIRM_DIRECTOR y PARTNER pueden invitar", () => {
    expect(() => assertInvitationAdminRole("FIRM_DIRECTOR")).not.toThrow();
    expect(() => assertInvitationAdminRole("PARTNER")).not.toThrow();
  });

  it("roles no administrativos reciben 403", () => {
    for (const role of ["LAWYER", "ASSISTANT", "PARALEGAL", "EXTERNAL_LAWYER", "READ_ONLY", null]) {
      expect(() => assertInvitationAdminRole(role)).toThrow();
      try {
        assertInvitationAdminRole(role);
      } catch (error) {
        expect(isIusiaError(error) && error.code).toBe("FORBIDDEN");
      }
    }
  });
});
