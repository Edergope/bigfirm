import { describe, expect, it } from "vitest";
import {
  OCR_MIN_TEXT_LENGTH,
  OCR_TRANSCRIPTION_PROMPT,
  NO_TEXT_REASON,
  hasUsableText,
  interpretOcrAnswer,
} from "../ocr.js";
import { FORMAT_CAPABILITY_MATRIX, formatCoverage, isOcrMimeType } from "../document-formats.js";

/**
 * La regla que gobierna el OCR: se transcribe lo que se ve, y nada más.
 *
 * Un modelo de visión sabe describir —«un documento con texto impreso y un sello»— y
 * sabe transcribir. Lo primero produce prosa nueva que nadie escribió en el expediente;
 * citarla como evidencia sería atribuirle al documento algo que no dice.
 */
describe("la instrucción de transcripción prohíbe inventar", () => {
  it("pide literalidad, no interpretación", () => {
    expect(OCR_TRANSCRIPTION_PROMPT).toContain("literalmente");
    expect(OCR_TRANSCRIPTION_PROMPT).toContain("No describas");
    expect(OCR_TRANSCRIPTION_PROMPT).toContain("No resumas");
  });

  it("prohíbe expresamente completar lo ilegible", () => {
    // Un número de cédula medio borroso completado «con criterio» es el error que
    // nadie detecta hasta que ya está en un escrito judicial.
    expect(OCR_TRANSCRIPTION_PROMPT).toContain("No completes");
    expect(OCR_TRANSCRIPTION_PROMPT).toContain("[ilegible]");
  });
});

describe("qué cuenta como texto y qué cuenta como nada", () => {
  it("una transcripción real se acepta", () => {
    const r = interpretOcrAnswer("REPÚBLICA DE COLOMBIA\nCÉDULA DE CIUDADANÍA\n1.020.345.678");
    expect(r.status).toBe("TEXT");
    if (r.status === "TEXT") expect(r.text).toContain("1.020.345.678");
  });

  it("el centinela de imagen sin texto se respeta", () => {
    expect(interpretOcrAnswer("SIN_TEXTO").status).toBe("NO_TEXT");
    expect(interpretOcrAnswer("  SIN_TEXTO  ").status).toBe("NO_TEXT");
  });

  it("una respuesta vacía no es una transcripción vacía: es nada", () => {
    for (const v of ["", "   ", null, undefined]) {
      expect(interpretOcrAnswer(v).status).toBe("NO_TEXT");
    }
  });

  it("una DESCRIPCIÓN disfrazada de transcripción se rechaza", () => {
    /*
      Aunque el prompt lo prohíbe, un modelo de visión a veces contesta «la imagen
      muestra…» en lugar de transcribir. Eso no es el texto del documento, y dejarlo
      pasar convertiría prosa generada en evidencia citable.
    */
    for (const v of [
      "La imagen muestra un documento de identidad con una fotografía.",
      "Esta imagen contiene un sello oficial y varias firmas.",
      "The image shows a scanned contract.",
      "Se observa un texto impreso sobre fondo blanco.",
    ]) {
      expect(interpretOcrAnswer(v).status).toBe("NO_TEXT");
    }
  });

  it("una respuesta demasiado corta no sostiene nada", () => {
    expect(interpretOcrAnswer("ok").status).toBe("NO_TEXT");
    expect("x".repeat(OCR_MIN_TEXT_LENGTH - 1).length).toBeLessThan(OCR_MIN_TEXT_LENGTH);
  });

  it("nunca devuelve texto que no estuviera en la respuesta", () => {
    // La función no compone ni completa: lo que sale es lo que entró, recortado.
    const entrada = "  ACTA DE ENTREGA No 4471  ";
    const r = interpretOcrAnswer(entrada);
    if (r.status === "TEXT") expect(entrada).toContain(r.text);
  });
});

/**
 * Un PDF escaneado atraviesa la conversión sin error y devuelve vacío: la plataforma
 * extrae texto, no hace OCR. Eso se subía igual al índice, producía cero fragmentos, y
 * la confirmación lo perseguía seis horas antes de rendirse.
 */
describe("una conversión vacía se detecta ANTES de subir nada", () => {
  it("texto real pasa", () => {
    expect(hasUsableText("CONTRATO DE ARRENDAMIENTO\nEntre las partes...")).toBe(true);
  });

  it("vacío, espacios y migajas de metadatos no pasan", () => {
    for (const v of ["", "   ", "\n\n\n", "PDF"]) expect(hasUsableText(v)).toBe(false);
  });

  it("el motivo que ve el abogado dice qué hacer", () => {
    expect(NO_TEXT_REASON.SCANNED_PDF).toContain("texto seleccionable");
    expect(NO_TEXT_REASON.IMAGE).toContain("Se conserva en el expediente");
  });
});

describe("la cobertura de formatos refleja el OCR", () => {
  it("las imágenes pasan por transcripción, no por descripción", () => {
    for (const m of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
      expect(isOcrMimeType(m)).toBe(true);
      expect(formatCoverage(m).verdict).toBe("READABLE");
    }
  });

  it("y se le promete al abogado lo que de verdad ocurre", () => {
    const r = formatCoverage("image/png").reason;
    expect(r).toContain("transcribirá");
    expect(r).toContain("no contiene texto legible");
  });

  it("el PDF escaneado NO se promete como citable", () => {
    // Prometerlo y descubrirlo seis horas después es peor que decirlo al principio.
    const f = FORMAT_CAPABILITY_MATRIX.find((x) => x.format === "PDF escaneado")!;
    expect(f.index).toBe(false);
    expect(f.preview).toBe(true);
    expect(f.reason).toContain("no hace OCR");
  });

  it("audio y vídeo siguen fuera: no hay nada que transcribir con esto", () => {
    expect(isOcrMimeType("audio/mpeg")).toBe(false);
    expect(formatCoverage("video/mp4").verdict).toBe("STORED_ONLY");
  });
});
