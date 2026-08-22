import { describe, expect, it } from "vitest";
import { resolveTemplateValues, TemplateValidationError } from "./templates.js";

const template = {
  variables: [
    { key: "cliente", label: "Cliente", required: true, type: "text" as const },
    { key: "cuantia", label: "Cuantía", required: true, type: "currency" as const },
    { key: "nota", label: "Nota", required: false, type: "text" as const },
  ],
};

describe("resolución de variables de plantilla", () => {
  it("resuelve las variables requeridas provistas", () => {
    const values = resolveTemplateValues(template, { cliente: "ACME", cuantia: 5000000 });
    expect(values).toEqual({ cliente: "ACME", cuantia: "5000000" });
  });

  it("lanza cuando falta una variable requerida", () => {
    expect(() => resolveTemplateValues(template, { cliente: "ACME" })).toThrow(
      TemplateValidationError,
    );
  });

  it("las variables opcionales no bloquean la generación", () => {
    const values = resolveTemplateValues(template, { cliente: "A", cuantia: "1" });
    expect(values.nota).toBeUndefined();
  });

  it("reporta todas las variables faltantes", () => {
    try {
      resolveTemplateValues(template, {});
      throw new Error("debió lanzar");
    } catch (e) {
      expect(e).toBeInstanceOf(TemplateValidationError);
      if (e instanceof TemplateValidationError) {
        expect(e.missing).toEqual(["cliente", "cuantia"]);
      }
    }
  });
});
