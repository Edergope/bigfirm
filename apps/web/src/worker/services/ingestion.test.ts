import { describe, expect, it, vi } from "vitest";
import {
  DOWNLOAD_DEADLINE_MS,
  IngestionTimeoutError,
  NORMALIZE_DEADLINE_MS,
  AI_SEARCH_POLL_MS,
  StageClock,
  isIndexableMimeType,
  normalizeToText,
  uploadToAiSearch,
} from "./ingestion.js";

describe("normalización documental", () => {
  it("conserva el decoder estable para texto sin invocar Workers AI", async () => {
    const encoded = new TextEncoder().encode("plazo de preaviso: 30 días");
    const bytes = new ArrayBuffer(encoded.byteLength);
    new Uint8Array(bytes).set(encoded);
    await expect(normalizeToText(bytes, "text/plain", "fuente.txt")).resolves.toBe(
      "plazo de preaviso: 30 días",
    );
  });

  it("convierte DOCX con toMarkdown y desactiva imágenes embebidas", async () => {
    const toMarkdown = vi.fn().mockResolvedValue({
      id: "conversion-1",
      name: "concepto.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      format: "markdown",
      tokens: 8,
      data: "# Concepto jurídico",
    });
    const ai = { toMarkdown } as unknown as Ai;

    await expect(
      normalizeToText(
        new Uint8Array([1, 2, 3]).buffer,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "concepto.docx",
        ai,
      ),
    ).resolves.toBe("# Concepto jurídico");

    expect(toMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({ name: "concepto.docx" }),
      expect.objectContaining({
        conversionOptions: expect.objectContaining({
          docx: { images: { convert: false } },
        }),
      }),
    );
  });

  it("propaga un resultado de conversión fallido sin indexar un marcador falso", async () => {
    const ai = {
      toMarkdown: vi.fn().mockResolvedValue({
        id: "conversion-2",
        name: "fuente.pdf",
        mimeType: "application/pdf",
        format: "error",
        error: "archivo dañado",
      }),
    } as unknown as Ai;

    await expect(
      normalizeToText(new Uint8Array([1]).buffer, "application/pdf", "fuente.pdf", ai),
    ).rejects.toThrow("archivo dañado");
  });

  it("clasifica formatos ricos soportados y excluye media con visión/audio", () => {
    expect(isIndexableMimeType("application/pdf")).toBe(true);
    expect(
      isIndexableMimeType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ).toBe(true);
    expect(isIndexableMimeType("image/png")).toBe(false);
    expect(isIndexableMimeType("video/mp4")).toBe(false);
    expect(isIndexableMimeType("audio/wav")).toBe(false);
  });

  it("indexa inmediatamente en AI Search con metadata ACL antes de marcar AI_INDEXED", async () => {
    const uploadAndPoll = vi.fn().mockResolvedValue({
      id: "item-1",
      key: "org/org1/matter/mtr1/doc/doc1.txt",
      status: "completed",
    });
    await expect(uploadToAiSearch(
      { items: { uploadAndPoll } },
      "org/org1/matter/mtr1/doc/doc1.txt",
      "IUSIA_E2E_NEW_MATTER_20260826",
      {
        organization_id: "org1",
        matter_id: "mtr1",
        document_id: "doc1",
        document_version: "2",
        is_current: "true",
      },
    )).resolves.toMatchObject({ status: "completed" });

    expect(uploadAndPoll).toHaveBeenCalledWith(
      "org/org1/matter/mtr1/doc/doc1.txt",
      "IUSIA_E2E_NEW_MATTER_20260826",
      {
        metadata: {
          organization_id: "org1",
          matter_id: "mtr1",
          document_id: "doc1",
          document_version: "2",
          is_current: "true",
        },
        pollIntervalMs: 1000,
        timeoutMs: 25000,
      },
    );
  });

  it("falla cerrado si AI Search uploadAndPoll no está configurado", async () => {
    await expect(uploadToAiSearch(null, "doc.txt", "contenido", {})).rejects.toThrow(
      "AI Search uploadAndPoll no está configurado",
    );
  });

  it("falla cerrado si AI Search RECHAZA el contenido", async () => {
    const uploadAndPoll = vi.fn().mockResolvedValue({
      id: "item-err",
      key: "doc.txt",
      status: "error",
      error: "unsupported content",
    });

    await expect(
      uploadToAiSearch({ items: { uploadAndPoll } }, "doc.txt", "contenido", {
        organization_id: "org1",
        matter_id: "mtr1",
        document_id: "doc1",
        document_version: "1",
        is_current: "true",
      }),
    ).rejects.toThrow("AI Search rechazó el item: unsupported content");
  });
});

/**
 * Cotas de las dependencias externas.
 *
 * Ninguna espera puede ser ilimitada: una llamada a AI Search sin cota dejó 213,5 s
 * muertos en una orquestación real. La descarga y la conversión tenían el mismo agujero,
 * con el agravante de que ocupan un hueco de concurrencia mientras cuelgan y frenan al
 * lote entero.
 */
describe("ninguna etapa espera indefinidamente", () => {
  it("declara cotas para descarga y conversión", () => {
    expect(DOWNLOAD_DEADLINE_MS).toBeGreaterThan(0);
    expect(NORMALIZE_DEADLINE_MS).toBeGreaterThan(0);
    // La conversión de un PDF grande legítimamente tarda más que su descarga.
    expect(NORMALIZE_DEADLINE_MS).toBeGreaterThanOrEqual(DOWNLOAD_DEADLINE_MS);
  });

  it("un vencimiento NO se convierte en éxito vacío", () => {
    // Marcar indexado un documento que no se pudo leer es peor que fallar: el análisis
    // lo daría por considerado. El error es una clase propia, y el consumidor reintenta.
    const error = new IngestionTimeoutError("NORMALIZE", NORMALIZE_DEADLINE_MS);
    expect(error).toBeInstanceOf(Error);
    expect(error.stage).toBe("NORMALIZE");
    expect(error.name).toBe("IngestionTimeoutError");
  });
});

describe("cronómetro por etapa", () => {
  it("reparte el tiempo entre etapas y cierra con el total", () => {
    const clock = new StageClock();
    clock.mark("download_ms");
    clock.mark("normalize_ms");
    const timings = clock.finish();
    // Sin esto, la única evidencia era `indexed_at`: cuándo terminó, no dónde se fue.
    expect(Object.keys(timings)).toEqual(
      expect.arrayContaining(["download_ms", "normalize_ms", "finalize_ms", "total_ms"]),
    );
    for (const value of Object.values(timings)) {
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});

/**
 * AI_INDEXED significa RECUPERABLE, no «la API devolvió 200».
 *
 * `uploadAndPoll` sondea hasta que el item queda `completed` y la ingestión sólo marca
 * indexado después. Un `status` distinto de `completed` lanza, así que un documento a
 * medio indexar nunca llega a AI_INDEXED.
 */
/**
 * SEMÁNTICA DE AI_INDEXED — el contrato cambió, y a mejor.
 *
 * MEDIDO en los cinco documentos de IUS-2026-016: el índice tardó entre 77 y 112 s y
 * fue el 98,8 %–99,4 % del tiempo total. El sondeo estaba en 120 s, es decir 7,9 s por
 * encima del peor caso; `Cedula extrangeria Maria.pdf` cruzó ese margen y el abogado vio
 * «Error de procesamiento» en un documento que estaba perfectamente bien.
 *
 * Un sondeo que vence NO es un fallo: `uploadAndPoll` sube primero y consulta después,
 * así que el item ya está enviado. Lo que antes garantizaba el `status: completed` lo
 * garantiza ahora algo más fuerte: una recuperación real desde el índice.
 */
describe("semántica de AI_INDEXED", () => {
  it("un contenido RECHAZADO por el proveedor sigue siendo un fallo", async () => {
    const aiSearch = {
      items: {
        uploadAndPoll: async () => ({ status: "error" as const, error: "conversion failed" }),
      },
    };
    await expect(
      uploadToAiSearch(aiSearch, "org/x/doc.txt", "contenido", { organization_id: "org" }),
    ).rejects.toThrow(/rechazó/);
  });

  it("un sondeo sin confirmar NO lanza: el item ya se subió", async () => {
    // Subir de nuevo en el reintento sería desperdicio, y declarar error sería falso.
    for (const status of ["queued", "running"] as const) {
      const aiSearch = { items: { uploadAndPoll: async () => ({ status }) } };
      await expect(
        uploadToAiSearch(aiSearch, "org/x/doc.txt", "contenido", { organization_id: "org" }),
      ).resolves.toMatchObject({ status });
    }
  });

  it("confirmado de inmediato se acepta igual", async () => {
    const ok = { items: { uploadAndPoll: async () => ({ status: "completed" as const }) } };
    await expect(
      uploadToAiSearch(ok, "org/x/doc.txt", "contenido", { organization_id: "org" }),
    ).resolves.toMatchObject({ status: "completed" });
  });

  it("el sondeo se acota muy por debajo del tiempo del índice", async () => {
    // Deliberado: no se espera a que el índice termine dentro del consumidor. Bloquearlo
    // 110 s por documento era el 99 % del tiempo de un lote.
    expect(AI_SEARCH_POLL_MS).toBeLessThan(60_000);
  });
});

describe("imágenes: no se finge inteligencia", () => {
  it("una imagen no es indexable y nunca entra a la cola", () => {
    // El estado inicial que se le asigna es NOT_INDEXABLE, así que se muestra como
    // «Vista disponible · no indexado» en vez de fallar con un error de proceso.
    expect(isIndexableMimeType("image/png")).toBe(false);
    expect(isIndexableMimeType("image/jpeg")).toBe(false);
    // Y no se aplica OCR ni visión: no hay costo generativo escondido.
    expect(isIndexableMimeType("application/pdf")).toBe(true);
    expect(isIndexableMimeType("text/plain")).toBe(true);
  });
});
