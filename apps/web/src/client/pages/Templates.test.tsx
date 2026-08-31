import { describe, expect, it } from "vitest";
import { documentTypeLabel, templateStatusLabel } from "./Templates.js";

/**
 * El abogado nunca lee un enum interno. El Template Bank mostraba
 * `LEGAL_AUDIT_REPORT` y `ACTIVE` tal cual para todo tipo no mapeado.
 */
describe("lenguaje de despacho en el Template Bank", () => {
  it("traduce los 23 tipos del catálogo oficial", () => {
    expect(documentTypeLabel("OPINION")).toBe("Concepto jurídico");
    expect(documentTypeLabel("LEGAL_AUDIT_REPORT")).toBe("Informe de auditoría legal");
    expect(documentTypeLabel("DUE_DILIGENCE_REPORT")).toBe("Informe de debida diligencia");
    expect(documentTypeLabel("CORPORATE_MINUTES")).toBe("Actas y decisiones societarias");
    expect(documentTypeLabel("NDA")).toBe("Acuerdo de confidencialidad");
  });

  it("`OPINION` sobrevive como enum interno pero nunca como concepto visible", () => {
    expect(documentTypeLabel("OPINION")).not.toMatch(/OPINION/i);
  });

  it("un tipo nuevo se humaniza en vez de mostrarse como enum crudo", () => {
    expect(documentTypeLabel("SETTLEMENT_AGREEMENT")).toBe("Settlement agreement");
    expect(documentTypeLabel("")).toBe("Documento");
  });

  it("los estados de plantilla se leen en español", () => {
    expect(templateStatusLabel("ACTIVE")).toBe("Activa");
    expect(templateStatusLabel("INACTIVE")).toBe("Inactiva");
    expect(templateStatusLabel("RETIRED")).toBe("Retirada");
    expect(templateStatusLabel("QUE_SEA")).toBe("Sin estado");
  });
});
