import { describe, expect, it, vi } from "vitest";
import { DriveApiError } from "../integrations/google-drive.js";
import { retryTransientDrive } from "./document-generation.js";

describe("retry documental acotado", () => {
  it("reintenta un fallo transitorio y devuelve el único resultado", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new DriveApiError("http_5xx", "Drive export HTTP 503", 503))
      .mockResolvedValueOnce("docx-bytes");
    await expect(retryTransientDrive(operation, { delayMs: 0 })).resolves.toBe("docx-bytes");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("se detiene en tres intentos", async () => {
    const operation = vi.fn<() => Promise<void>>().mockRejectedValue(
      new DriveApiError("rate_limited", "Drive export HTTP 429", 429),
    );
    await expect(retryTransientDrive(operation, { delayMs: 0, attempts: 9 })).rejects.toThrow();
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("no reintenta auth, not_found ni 4xx", async () => {
    for (const kind of ["auth", "not_found", "http_4xx"] as const) {
      const operation = vi.fn<() => Promise<void>>().mockRejectedValue(new DriveApiError(kind, kind));
      await expect(retryTransientDrive(operation, { delayMs: 0 })).rejects.toThrow();
      expect(operation).toHaveBeenCalledTimes(1);
    }
  });
});
