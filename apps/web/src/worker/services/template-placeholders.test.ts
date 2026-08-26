import { describe, expect, it } from "vitest";
import { discoverTemplateVariables } from "./template-placeholders.js";

describe("campos de plantillas oficiales", () => {
  it("preserva el token literal y deriva una clave lógica estable", () => {
    expect(
      discoverTemplateVariables("[CLIENTE]\n\\[PREGUNTA JURÍDICA\\]\n[CLIENTE]\n{{firmante}}"),
    ).toEqual([
      { key: "cliente", label: "CLIENTE", required: true, placeholder: "[CLIENTE]" },
      {
        key: "pregunta_juridica",
        label: "PREGUNTA JURÍDICA",
        required: true,
        placeholder: "[PREGUNTA JURÍDICA]",
      },
      { key: "firmante", label: "firmante", required: true, placeholder: "{{firmante}}" },
    ]);
  });

  it("ignora texto entre corchetes que no es un campo editorial", () => {
    expect(discoverTemplateVariables("[texto libre]\n[CLIENTE]")).toHaveLength(1);
  });
});
