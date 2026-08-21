import { describe, expect, it } from "vitest";
import { decideMatterAccess, matterActionsFor } from "./authz.js";

describe("autorización por Matter", () => {
  it("niega cualquier acceso entre organizaciones distintas", () => {
    const decision = decideMatterAccess(
      { firmRole: "FIRM_DIRECTOR", matterRole: "OWNER", sameOrganization: false },
      "matter:read",
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("cross_tenant_denied");
  });

  it("no concede acceso por rol de firma cuando no hay membresía en el matter", () => {
    // Un socio NO ve automáticamente todos los casos de la firma.
    const decision = decideMatterAccess(
      { firmRole: "PARTNER", matterRole: null, sameOrganization: true },
      "matter:read",
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("not_a_matter_member");
  });

  it("permite al director supervisar en lectura, marcándolo como supervisión", () => {
    const decision = decideMatterAccess(
      { firmRole: "FIRM_DIRECTOR", matterRole: null, sameOrganization: true },
      "matter:read",
    );
    expect(decision.allowed).toBe(true);
    expect(decision.viaSupervision).toBe(true);
  });

  it("impide que la supervisión del director escriba o ejecute", () => {
    for (const action of ["matter:update", "execution:start", "gate:approve"] as const) {
      const decision = decideMatterAccess(
        { firmRole: "FIRM_DIRECTOR", matterRole: null, sameOrganization: true },
        action,
      );
      expect(decision.allowed, action).toBe(false);
    }
  });

  it("restringe al abogado externo a lectura mínima del expediente", () => {
    const allowed = matterActionsFor("EXTERNAL");
    expect(allowed).toEqual(["matter:read", "document:read", "deliverable:read"]);
    // En particular, no ve tareas internas ni ejecuciones de IA de la firma.
    expect(allowed).not.toContain("task:read");
    expect(allowed).not.toContain("execution:read");
  });

  it("no deja que un asistente apruebe gates", () => {
    const decision = decideMatterAccess(
      { firmRole: "ASSISTANT", matterRole: "ASSISTANT", sameOrganization: true },
      "gate:approve",
    );
    expect(decision.allowed).toBe(false);
  });

  it("permite al revisor aprobar gates pero no editar el expediente", () => {
    const ctx = { firmRole: "LAWYER", matterRole: "REVIEWER", sameOrganization: true } as const;
    expect(decideMatterAccess(ctx, "gate:approve").allowed).toBe(true);
    expect(decideMatterAccess(ctx, "matter:update").allowed).toBe(false);
  });

  it("READ_ONLY no puede iniciar ejecuciones de IA", () => {
    const decision = decideMatterAccess(
      { firmRole: "LAWYER", matterRole: "READ_ONLY", sameOrganization: true },
      "execution:start",
    );
    expect(decision.allowed).toBe(false);
  });
});
