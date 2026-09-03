import { describe, expect, it } from "vitest";
import {
  formatCoverage,
  isAcceptedUpload,
  isReadableMimeType,
  summarizeSelection,
} from "../document-formats.js";

/**
 * Cobertura de formatos — lote de 17 (IUS-2026-018).
 *
 * Dos `.DOC` se aceptaron sin objeción, esperaron turno, se procesaron y sólo entonces
 * aparecieron como «Vista disponible · no indexado». El veredicto era correcto; el
 * momento, no. La ruta de carga tenía su propia lista de formatos y la ingestión otra,
 * y la de carga admitía cosas que la de lectura no sabía leer.
 */
describe("una sola lista de formatos", () => {
  it("lo que se admite al subir y lo que se sabe leer ya no se contradicen", () => {
    // El .doc sigue admitiéndose —el expediente es el expediente— pero NO se promete
    // que se lea, y eso se dice al elegirlo.
    expect(isAcceptedUpload("application/msword")).toBe(true);
    expect(isReadableMimeType("application/msword")).toBe(false);
    expect(formatCoverage("application/msword").verdict).toBe("STORED_ONLY");
  });

  it("el .doc dice qué hacer, no sólo que no puede", () => {
    const c = formatCoverage("application/msword", "demanda.doc");
    expect(c.reason).toContain(".docx");
    expect(c.reason).toContain("PDF");
  });

  it("un .doc mal etiquetado por el navegador tampoco pasa por legible", () => {
    // Los formatos viejos llegan a veces como octet-stream: decide la extensión.
    expect(formatCoverage("application/octet-stream", "PODER.DOC").verdict).toBe("STORED_ONLY");
  });
});

/**
 * La tabla de formatos ricos la fija Cloudflare, no IUSIA. Estos son los MIME que
 * `ai-search/configuration/data-source/#supported-file-types` publica (revisada el
 * 2026-09-03) y que la misma llamada `toMarkdown` que ya hacíamos convierte. Estaban
 * fuera sólo porque nadie había mirado la tabla.
 */
describe("los formatos que el proveedor sí convierte", () => {
  const soportados = [
    "application/pdf",
    "text/html",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/vnd.ms-excel.sheet.macroenabled.12",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.apple.numbers",
  ];

  it.each(soportados)("%s se lee y se cita", (mime) => {
    expect(isReadableMimeType(mime)).toBe(true);
    expect(formatCoverage(mime).verdict).toBe("READABLE");
  });

  it("el texto plano no necesita conversión", () => {
    for (const m of ["text/plain", "text/markdown", "text/csv", "application/json", "application/xml"]) {
      expect(isReadableMimeType(m)).toBe(true);
    }
  });
});

/**
 * Las imágenes SÍ las convierte la plataforma, con detección de objetos y un modelo de
 * visión que las describe en prosa. Están apagadas a propósito: una descripción
 * generada no es el texto del documento, y citarla como evidencia sería atribuirle al
 * expediente algo que nadie escribió en él. Un escaneo necesita OCR, que es otra cosa.
 */
describe("las imágenes se guardan, no se interpretan", () => {
  it.each(["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/svg+xml"])(
    "%s se conserva pero no entra al análisis",
    (mime) => {
      expect(isAcceptedUpload(mime)).toBe(true);
      expect(isReadableMimeType(mime)).toBe(false);
      expect(formatCoverage(mime).verdict).toBe("STORED_ONLY");
    },
  );

  it("le ofrece al abogado la salida real para un escaneo", () => {
    expect(formatCoverage("image/png", "acta.png").reason).toContain("PDF con texto");
  });

  it("audio y vídeo se guardan sin prometer lectura", () => {
    for (const m of ["video/mp4", "audio/mpeg"]) {
      expect(formatCoverage(m).verdict).toBe("STORED_ONLY");
      expect(isReadableMimeType(m)).toBe(false);
    }
  });

  it("lo que no se admite se rechaza de plano", () => {
    expect(formatCoverage("application/x-msdownload", "virus.exe").verdict).toBe("REJECTED");
    expect(isAcceptedUpload("application/x-msdownload")).toBe(false);
  });
});

describe("el resumen previo a subir", () => {
  it("reproduce el lote de 17 y anticipa los dos que no se leerán", () => {
    const s = summarizeSelection([
      { name: "contrato.pdf", type: "application/pdf" },
      { name: "ensayo.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      { name: "poder.doc", type: "application/msword" },
      { name: "anexo.doc", type: "application/msword" },
    ]);
    expect(s.readable).toBe(2);
    expect(s.storedOnly).toBe(2);
    expect(s.notices).toHaveLength(1);
    expect(s.notices[0]).toContain("2 archivos");
  });

  it("una selección enteramente legible no molesta con avisos", () => {
    expect(summarizeSelection([{ name: "a.pdf", type: "application/pdf" }]).notices).toEqual([]);
  });

  it("un solo archivo no se anuncia como si fueran varios", () => {
    const s = summarizeSelection([{ name: "p.doc", type: "application/msword" }]);
    expect(s.notices[0]).not.toContain("1 archivos");
  });
});
