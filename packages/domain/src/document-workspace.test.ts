import { describe, expect, it } from "vitest";
import {
  documentErrorMessage,
  generatedFileName,
  matterFolderName,
  DRIVE_FOLDER_NAMES,
} from "./document-workspace.js";

describe("matterFolderName", () => {
  it("compone [Referencia] - [Asunto] legible", () => {
    expect(matterFolderName("STAGING-E2E-2026", "Delta vs Atlas")).toBe(
      "STAGING-E2E-2026 - Delta vs Atlas",
    );
  });

  it("saca los caracteres que Drive no admite en nombres", () => {
    const name = matterFolderName("REF/01", 'Asunto: "urgente" <x>');
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });

  it("nunca queda vacío", () => {
    expect(matterFolderName("", "")).toBe("SIN-REF - Expediente");
  });
});

describe("generatedFileName", () => {
  const date = new Date("2026-08-26T10:00:00Z");

  it("es determinista y sin ids visibles", () => {
    const name = generatedFileName({
      reference: "STAGING-E2E-2026",
      documentType: "Opinión Legal",
      date,
      version: 1,
      extension: "docx",
    });
    expect(name).toBe("STAGING-E2E-2026 - Concepto jurídico - 2026-08-26 - v1.docx");
    expect(name).not.toContain("OPINION");
    expect(name).not.toMatch(/exe_|[a-f0-9]{16}/);
  });

  it("normaliza acentos y produce PDF con la misma raíz", () => {
    const base = { reference: "R1", documentType: "Demanda", date, version: 2 } as const;
    expect(generatedFileName({ ...base, extension: "docx" })).toBe("R1 - Demanda - 2026-08-26 - v2.docx");
    expect(generatedFileName({ ...base, extension: "pdf" })).toBe("R1 - Demanda - 2026-08-26 - v2.pdf");
  });
});

describe("documentErrorMessage", () => {
  it("traduce los códigos conocidos, nunca muestra el enum", () => {
    expect(documentErrorMessage("TEMPLATE_NOT_FOUND")).not.toContain("TEMPLATE_NOT_FOUND");
    expect(documentErrorMessage("DRIVE_PERMISSION_REQUIRED")).toContain("almacenamiento documental");
  });
  it("tiene un mensaje de reserva para códigos desconocidos", () => {
    expect(documentErrorMessage("ZZZ")).not.toContain("ZZZ");
    expect(documentErrorMessage("ZZZ").length).toBeGreaterThan(0);
  });
});

describe("estructura de carpetas", () => {
  it("nombra las dos subcarpetas del expediente con su prefijo de orden", () => {
    expect(DRIVE_FOLDER_NAMES.uploaded).toBe("01 Documentos aportados");
    expect(DRIVE_FOLDER_NAMES.generated).toBe("02 Documentos generados por IUSIA");
  });
});
