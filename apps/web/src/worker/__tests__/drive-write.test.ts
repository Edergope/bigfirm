import { describe, expect, it, vi } from "vitest";
import { GoogleDriveAdapter } from "../integrations/google-drive.js";

/**
 * Adapter de escritura de Drive con `fetch` simulado. Verifica la idempotencia de
 * carpetas (find-or-create) y el formato multipart de la subida, sin red real.
 */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("ensureFolder — idempotencia", () => {
  it("no crea la carpeta si ya existe", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/drive/v3/files?") || u.includes("/drive/v3/files&") || u.includes("q=")) {
        return jsonResponse({ files: [{ id: "existing-folder" }] });
      }
      throw new Error(`no debería crear: ${u}`);
    });
    const drive = new GoogleDriveAdapter({ accessToken: "t" }, fetchImpl as unknown as typeof fetch);
    const id = await drive.ensureFolder("01 Documentos aportados", "parent-1");
    expect(id).toBe("existing-folder");
    // Una sola llamada: la búsqueda. Nunca el POST de creación.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("crea la carpeta cuando no existe", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push(`${init?.method ?? "GET"} ${u.includes("q=") ? "search" : "create"}`);
      if (u.includes("q=")) return jsonResponse({ files: [] });
      return jsonResponse({ id: "new-folder" });
    });
    const drive = new GoogleDriveAdapter({ accessToken: "t" }, fetchImpl as unknown as typeof fetch);
    const id = await drive.ensureFolder("Expedientes", "root-1");
    expect(id).toBe("new-folder");
    expect(calls).toEqual(["GET search", "POST create"]);
  });
});

describe("uploadFile — multipart", () => {
  it("envía metadata + binario con boundary y devuelve la metadata normalizada", async () => {
    let sentContentType = "";
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      sentContentType = (init?.headers as Record<string, string>)["Content-Type"] ?? "";
      return jsonResponse({ id: "file-1", name: "carta.pdf", mimeType: "application/pdf", size: "42" });
    });
    const drive = new GoogleDriveAdapter({ accessToken: "t" }, fetchImpl as unknown as typeof fetch);
    const meta = await drive.uploadFile({
      name: "carta.pdf",
      parentId: "folder-1",
      mimeType: "application/pdf",
      content: new TextEncoder().encode("hola"),
    });
    expect(sentContentType).toContain("multipart/related; boundary=");
    expect(meta.provider_file_id).toBe("file-1");
    expect(meta.mime_type).toBe("application/pdf");
    expect(meta.size_bytes).toBe(42);
  });
});

describe("docsReplaceText", () => {
  it("no llama a la API si no hay reemplazos", async () => {
    const fetchImpl = vi.fn();
    const drive = new GoogleDriveAdapter({ accessToken: "t" }, fetchImpl as unknown as typeof fetch);
    await drive.docsReplaceText("doc-1", {});
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
