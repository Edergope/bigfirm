import { describe, expect, it } from "vitest";
import { blockingDocumentsForAnalysis } from "../routes/orchestration.js";

describe("orchestration document readiness guard", () => {
  it("bloquea documentos pendientes o en procesamiento antes del análisis", () => {
    const blocking = blockingDocumentsForAnalysis([
      { name: "fuente-pendiente.pdf", ingestionStatus: "PENDIENTE" },
      { name: "fuente-procesando.docx", ingestionStatus: "PROCESSING" },
      { name: "fuente-indexada.txt", ingestionStatus: "AI_INDEXED" },
      { name: "imagen.png", ingestionStatus: "NOT_INDEXABLE" },
    ]);

    expect(blocking.map((doc) => doc.name)).toEqual([
      "fuente-pendiente.pdf",
      "fuente-procesando.docx",
    ]);
  });

  it("permite arrancar si los documentos ya no bloquean retrieval", () => {
    expect(
      blockingDocumentsForAnalysis([
        { name: "fuente-indexada.txt", ingestionStatus: "AI_INDEXED" },
        { name: "imagen.png", ingestionStatus: "NOT_INDEXABLE" },
      ]),
    ).toEqual([]);
  });
});
