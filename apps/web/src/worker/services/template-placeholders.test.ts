import { describe, expect, it } from "vitest";
import { discoverTemplateVariables } from "./template-placeholders.js";
import { assertRenderedTemplate } from "./document-generation.js";

describe("campos de plantillas oficiales", () => {
  it("detecta tanto campos como instrucciones editoriales entre corchetes", () => {
    const fields = discoverTemplateVariables("[CLIENTE] [Formule el problema jurídico principal.] {{asunto}}");
    expect(fields.map((field) => field.placeholder)).toEqual([
      "[CLIENTE]", "[Formule el problema jurídico principal.]", "{{asunto}}",
    ]);
  });

  it("bloquea la exportación si queda una instrucción o token", () => {
    expect(() => assertRenderedTemplate("Resultado [Describa el hecho]", [])).toThrow("campos o instrucciones");
    expect(() => assertRenderedTemplate("Resultado final", [])).not.toThrow();
  });
});
