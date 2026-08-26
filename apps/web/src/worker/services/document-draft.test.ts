import { describe, expect, it } from "vitest";
import { extractValues, type DraftVariable } from "./document-draft.js";

const VARS: DraftVariable[] = [
  { key: "asunto", label: "Asunto", required: true },
  { key: "analisis", label: "Análisis", required: true },
];

describe("extractValues", () => {
  it("parsea un objeto JSON limpio", () => {
    const text = '{"asunto":"Prescripción","analisis":"El plazo corrió."}';
    expect(extractValues(text, VARS)).toEqual({
      asunto: "Prescripción",
      analisis: "El plazo corrió.",
    });
  });

  it("tolera prosa antes y después, y bloques ```json", () => {
    const text =
      "Con gusto. ```json\n{\n  \"asunto\": \"X\",\n  \"analisis\": \"Y\"\n}\n```\nEspero sea útil.";
    expect(extractValues(text, VARS)).toEqual({ asunto: "X", analisis: "Y" });
  });

  it("recorta el primer objeto balanceado aunque haya llaves anidadas en strings", () => {
    const text = '{"asunto":"con { llave } dentro","analisis":"ok"}';
    expect(extractValues(text, VARS)).toEqual({
      asunto: "con { llave } dentro",
      analisis: "ok",
    });
  });

  it("rechaza si falta una variable esperada", () => {
    expect(extractValues('{"asunto":"solo una"}', VARS)).toBeNull();
  });

  it("rechaza valores vacíos o de tipo incorrecto", () => {
    expect(extractValues('{"asunto":"  ","analisis":"ok"}', VARS)).toBeNull();
    expect(extractValues('{"asunto":123,"analisis":"ok"}', VARS)).toBeNull();
  });

  it("rechaza texto sin JSON", () => {
    expect(extractValues("No pude redactar el documento.", VARS)).toBeNull();
  });
});
