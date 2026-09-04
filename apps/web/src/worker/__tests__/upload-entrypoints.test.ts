import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Las TRES entradas de carga documental deben usar el mismo contrato.
 *
 * En IUS-2026-016 se perdieron cinco archivos seleccionados desde «Nuevo expediente» y
 * la sospecha recurrente fue que ese camino tuviera su propia implementación. No la
 * tiene, y esta prueba lo fija: si alguien introduce un segundo pipeline de subida, o
 * llama al endpoint por su cuenta saltándose el cliente, falla aquí.
 */

const clientDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "client");
const read = (rel: string) => readFileSync(join(clientDir, rel), "utf8");

const ENTRY_POINTS = [
  "pages/Matters.tsx", // Nuevo expediente + documentos
  "pages/MatterWorkspace.tsx", // Matter → Documentos → Adjuntar
  "pages/Documents.tsx", // Bandeja documental
] as const;

describe("una sola vía de carga documental", () => {
  for (const file of ENTRY_POINTS) {
    it(`${file} sube a través de api.uploadDocuments`, () => {
      expect(read(file)).toContain("api.uploadDocuments(");
    });

    it(`${file} no llama al endpoint de carga por su cuenta`, () => {
      // Un `fetch` directo a la ruta de subida sería un segundo pipeline: se saltaría
      // el ingreso durable, el lote y los estados.
      expect(read(file)).not.toContain("/documents/upload");
    });
  }

  it("el cliente concentra la subida en un único método", () => {
    const api = read("api.ts");
    expect(api.split("/documents/upload").length - 1).toBe(1);
    expect(api).toContain("uploadDocuments: async (matterId: string, files: File[])");
  });

  it("el alta de expediente inspecciona el resultado en vez de descartarlo", () => {
    // Los cinco archivos del incidente se perdieron porque la respuesta se ignoraba.
    const matters = read("pages/Matters.tsx");
    expect(matters).toContain("accountUploads(upload.uploaded");
    // Y se contrasta contra lo PEDIDO, no contra lo que falló: en el lote de 17 el
    // servidor no reportó un solo fallo y aun así faltaba un archivo.
    expect(matters).toContain("acc.accepted < acc.requested");
    expect(matters).toContain("uploadAccountingStatement(acc)");
  });
});
