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

  it("bloquea la exportación si sobrevive un campo de ESTA plantilla", () => {
    // El detector se ancla a los placeholders realmente descubiertos para la
    // plantilla, que es lo que el generador le pasa siempre.
    const fields = discoverTemplateVariables("[Describa el hecho] {{asunto}}");
    expect(() => assertRenderedTemplate("Resultado [Describa el hecho]", fields)).toThrow(
      "campos o instrucciones",
    );
    expect(() => assertRenderedTemplate("Resultado {{asunto}}", fields)).toThrow(
      "campos o instrucciones",
    );
    expect(() => assertRenderedTemplate("Resultado final", fields)).not.toThrow();
  });

  it("bloquea tokens genéricos aunque no estén declarados en la plantilla", () => {
    expect(() => assertRenderedTemplate("Texto {{pendiente}}", [])).toThrow("campos o instrucciones");
    expect(() => assertRenderedTemplate("Texto ${pendiente}", [])).toThrow("campos o instrucciones");
    // Placeholder tipográfico en versalitas, como los de las plantillas oficiales.
    expect(() => assertRenderedTemplate("Señores [CLIENTE]:", [])).toThrow("campos o instrucciones");
  });

  it("NO bloquea prosa jurídica legítima que usa corchetes", () => {
    // Antes, cualquier corchete de 2 a 240 caracteres abortaba la publicación: un
    // documento correcto no se podía entregar por llevar un [sic] o una aclaración.
    expect(() =>
      assertRenderedTemplate(
        "La cláusula dice «el término será de treinta [30] días» [sic], según la Corte " +
          "Constitucional [sentencia citada en el expediente].",
        [],
      ),
    ).not.toThrow();
  });
});
