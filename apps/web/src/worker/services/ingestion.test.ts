import { describe, expect, it, vi } from "vitest";
import { isIndexableMimeType, normalizeToText, uploadToAiSearch } from "./ingestion.js";

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
    const uploadAndPoll = vi.fn().mockResolvedValue({ id: "item-1", key: "org/org1/matter/mtr1/doc/doc1.txt" });
    await uploadToAiSearch(
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
    );

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
        timeoutMs: 30000,
      },
    );
  });

  it("falla cerrado si AI Search uploadAndPoll no está configurado", async () => {
    await expect(uploadToAiSearch(null, "doc.txt", "contenido", {})).rejects.toThrow(
      "AI Search uploadAndPoll no está configurado",
    );
  });
});
