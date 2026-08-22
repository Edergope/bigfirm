import { describe, expect, it, vi } from "vitest";
import { StorageNotConfiguredError } from "@iusia/domain";
import { DriveApiError, GoogleDriveAdapter } from "../integrations/google-drive.js";

/**
 * GoogleDriveAdapter: prep completa (contracts, adapter, NOT_CONFIGURED, errores
 * normalizados) — la operación live queda ACTION_REQUIRED_OAUTH.
 */
describe("GoogleDriveAdapter", () => {
  it("sin credenciales: status NOT_CONFIGURED y operaciones lanzan StorageNotConfiguredError", async () => {
    const adapter = new GoogleDriveAdapter(null);
    expect(adapter.status()).toBe("NOT_CONFIGURED");
    await expect(adapter.getMetadata("f1")).rejects.toBeInstanceOf(StorageNotConfiguredError);
    await expect(adapter.download("f1")).rejects.toBeInstanceOf(StorageNotConfiguredError);
  });

  it("con token: status CONNECTED y traduce metadata a StoredFileMetadata", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "f1",
          name: "Contrato.pdf",
          mimeType: "application/pdf",
          size: "2048",
          modifiedTime: "2026-01-01T00:00:00Z",
          webViewLink: "https://drive.google.com/f1",
        }),
        { status: 200 },
      ),
    );
    const adapter = new GoogleDriveAdapter({ accessToken: "tok" }, fetchImpl as unknown as typeof fetch);
    expect(adapter.status()).toBe("CONNECTED");
    const meta = await adapter.getMetadata("f1");
    expect(meta).toEqual({
      provider_file_id: "f1",
      name: "Contrato.pdf",
      mime_type: "application/pdf",
      size_bytes: 2048,
      modified_at: "2026-01-01T00:00:00Z",
      web_view_link: "https://drive.google.com/f1",
    });
  });

  it("normaliza errores de la API por código", async () => {
    const cases: Array<[number, string]> = [
      [401, "auth"],
      [403, "auth"],
      [404, "not_found"],
      [429, "rate_limited"],
      [500, "http_5xx"],
      [400, "http_4xx"],
    ];
    for (const [status, kind] of cases) {
      const fetchImpl = vi.fn().mockResolvedValue(new Response("e", { status }));
      const adapter = new GoogleDriveAdapter({ accessToken: "tok" }, fetchImpl as unknown as typeof fetch);
      try {
        await adapter.getMetadata("f1");
        throw new Error("debió lanzar");
      } catch (e) {
        expect(e).toBeInstanceOf(DriveApiError);
        if (e instanceof DriveApiError) expect(e.kind).toBe(kind);
      }
    }
  });

  it("download devuelve el binario", async () => {
    const bytes = new TextEncoder().encode("PDF");
    const fetchImpl = vi.fn().mockResolvedValue(new Response(bytes, { status: 200 }));
    const adapter = new GoogleDriveAdapter({ accessToken: "tok" }, fetchImpl as unknown as typeof fetch);
    const buf = await adapter.download("f1");
    expect(new TextDecoder().decode(buf)).toBe("PDF");
  });
});
