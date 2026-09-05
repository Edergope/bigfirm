import { describe, expect, it, vi } from "vitest";
import {
  DOWNLOAD_DEADLINE_MS,
  IngestionTimeoutError,
  NORMALIZE_DEADLINE_MS,
  AI_SEARCH_MAX_ITEM_BYTES,
  StageClock,
  indexMetadata,
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

  it("clasifica formatos ricos soportados y excluye audio y vídeo", () => {
    expect(isIndexableMimeType("application/pdf")).toBe(true);
    expect(
      isIndexableMimeType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ).toBe(true);
    // Las imágenes entraron al análisis al añadir el OCR: se transcribe el texto que
    // ya está en ellas. No hay nada análogo que hacer con un audio o un vídeo.
    expect(isIndexableMimeType("image/png")).toBe(true);
    expect(isIndexableMimeType("video/mp4")).toBe(false);
    expect(isIndexableMimeType("audio/wav")).toBe(false);
  });

  it("ENVÍA a AI Search con metadata ACL y no espera a que termine", async () => {
    const upload = vi.fn().mockResolvedValue({
      id: "item-1",
      key: "org/org1/matter/mtr1/doc/doc1.txt",
      status: "completed",
    });
    await expect(uploadToAiSearch(
      { items: { upload } },
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

    expect(upload).toHaveBeenCalledWith(
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
      },
    );
  });

  it("falla cerrado si AI Search items.upload no está configurado", async () => {
    await expect(uploadToAiSearch(null, "doc.txt", "contenido", {})).rejects.toThrow(
      "AI Search items.upload no está configurado",
    );
  });

  it("falla cerrado si AI Search RECHAZA el contenido", async () => {
    const upload = vi.fn().mockResolvedValue({
      id: "item-err",
      key: "doc.txt",
      status: "error",
      error: "unsupported content",
    });

    await expect(
      uploadToAiSearch({ items: { upload } }, "doc.txt", "contenido", {
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
        upload: async () => ({ status: "error" as const, error: "conversion failed" }),
      },
    };
    await expect(
      uploadToAiSearch(aiSearch, "org/x/doc.txt", "contenido", { organization_id: "org" }),
    ).rejects.toThrow(/rechazó/);
  });

  it("un sondeo sin confirmar NO lanza: el item ya se subió", async () => {
    // Subir de nuevo en el reintento sería desperdicio, y declarar error sería falso.
    for (const status of ["queued", "running"] as const) {
      const aiSearch = { items: { upload: async () => ({ status }) } };
      await expect(
        uploadToAiSearch(aiSearch, "org/x/doc.txt", "contenido", { organization_id: "org" }),
      ).resolves.toMatchObject({ status });
    }
  });

  it("confirmado de inmediato se acepta igual", async () => {
    const ok = { items: { upload: async () => ({ status: "completed" as const }) } };
    await expect(
      uploadToAiSearch(ok, "org/x/doc.txt", "contenido", { organization_id: "org" }),
    ).resolves.toMatchObject({ status: "completed" });
  });

  it("la metadata cabe en el máximo documentado de 5 campos por instancia", () => {
    // La referencia oficial del binding de Items fija 5. Enviábamos SEIS —el sexto era
    // `is_active`, que dejó de filtrarse cuando su cláusula puso la recuperación a cero—.
    const fields = indexMetadata({
      organizationId: "org1",
      matterId: "mtr1",
      documentId: "doc1",
      documentVersion: 2,
    });
    expect(Object.keys(fields)).toHaveLength(5);
    expect(fields).not.toHaveProperty("is_active");
    // Lo que la seguridad exige sigue estando.
    expect(fields.organization_id).toBe("org1");
    expect(fields.matter_id).toBe("mtr1");
    expect(fields.document_id).toBe("doc1");
  });

  it("rechaza un artefacto por encima del máximo documentado en vez de fallar opaco", async () => {
    const upload = vi.fn();
    const huge = "x".repeat(AI_SEARCH_MAX_ITEM_BYTES + 1);
    await expect(
      uploadToAiSearch({ items: { upload } }, "doc.txt", huge, {}),
    ).rejects.toThrow(/supera el máximo/);
    // Ni siquiera se intenta: 4 MB están documentados, no estimados.
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("imágenes: se transcribe lo que hay, no se finge lo que falta", () => {
  it("una imagen entra al análisis por su texto, no por su descripción", () => {
    // La política anterior las dejaba fuera porque el único camino disponible era un
    // modelo que DESCRIBE la imagen en prosa, y una descripción generada no es el
    // texto del documento. Transcribir sí lo es.
    expect(isIndexableMimeType("image/png")).toBe(true);
    expect(isIndexableMimeType("image/jpeg")).toBe(true);
    expect(isIndexableMimeType("application/pdf")).toBe(true);
    expect(isIndexableMimeType("text/plain")).toBe(true);
  });

  it("una imagen sin texto legible no produce contenido inventado", async () => {
    // El modelo devuelve su centinela; la ingestión lo convierte en un desenlace
    // —consultable, no citable— en vez de indexar una descripción.
    const ai = { run: async () => ({ answer: "SIN_TEXTO" }) } as unknown as Ai;
    await expect(
      normalizeToText(new Uint8Array([1]).buffer, "image/png", "foto.png", ai),
    ).rejects.toThrow(/No se detectó texto legible/);
  });

  it("una imagen CON texto devuelve exactamente lo transcrito", async () => {
    const ai = {
      run: async () => ({ answer: "CÉDULA DE CIUDADANÍA\n1.020.345.678" }),
    } as unknown as Ai;
    const texto = await normalizeToText(
      new Uint8Array([1]).buffer, "image/jpeg", "cedula.jpg", ai,
    );
    expect(texto).toBe("CÉDULA DE CIUDADANÍA\n1.020.345.678");
  });

  it("un PDF que resulta ser un escaneo se detecta ANTES de subirlo al índice", async () => {
    // La conversión de PDF extrae texto y no hace OCR: un escaneo la atraviesa sin
    // error y devuelve vacío. Subirlo producía cero fragmentos y seis horas de
    // confirmaciones inútiles.
    const ai = { toMarkdown: async () => ({ format: "markdown", data: "  \n " }) } as unknown as Ai;
    await expect(
      normalizeToText(new Uint8Array([1]).buffer, "application/pdf", "escaneo.pdf", ai),
    ).rejects.toThrow(/no contiene texto/);
  });
});
