import {
  StorageNotConfiguredError,
  type DocumentStorageProvider,
  type IntegrationState,
  type StoredFileMetadata,
} from "@iusia/domain";

/**
 * GoogleDriveAdapter — adapter del port DocumentStorageProvider.
 *
 * Estado actual: ADAPTER listo, OAuth de Google NO aprovisionado (ACTION_REQUIRED_OAUTH).
 * Sin un access token válido, `status()` es NOT_CONFIGURED y las operaciones lanzan
 * StorageNotConfiguredError. No se inventan archivos ni metadata.
 *
 * El dominio jamás ve tipos del SDK de Google: este adapter traduce a
 * `StoredFileMetadata` y normaliza los errores de la API (auth/not_found/rate/5xx).
 */
export interface GoogleDriveCredentials {
  /** Access token OAuth del usuario/servicio con scope drive.readonly. */
  accessToken: string;
}

export type DriveFailureKind =
  | "auth"
  | "not_found"
  | "rate_limited"
  | "http_4xx"
  | "http_5xx"
  | "network";

export class DriveApiError extends Error {
  constructor(
    readonly kind: DriveFailureKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DriveApiError";
  }
  static fromStatus(op: string, status: number): DriveApiError {
    const kind: DriveFailureKind =
      status === 401 || status === 403
        ? "auth"
        : status === 404
          ? "not_found"
          : status === 429
            ? "rate_limited"
            : status >= 500
              ? "http_5xx"
              : "http_4xx";
    return new DriveApiError(kind, `Drive ${op} HTTP ${status}`, status);
  }
}

export class GoogleDriveAdapter implements DocumentStorageProvider {
  readonly id = "google-drive";
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly credentials: GoogleDriveCredentials | null,
    fetchImpl?: typeof fetch,
  ) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  status(): IntegrationState {
    return this.credentials ? "CONNECTED" : "NOT_CONFIGURED";
  }

  async getMetadata(fileId: string): Promise<StoredFileMetadata> {
    const token = this.requireToken();
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
    url.searchParams.set("fields", "id,name,mimeType,size,modifiedTime,webViewLink");
    const res = await this.call(url, token, "getMetadata");
    const f = (await res.json()) as {
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      modifiedTime?: string;
      webViewLink?: string;
    };
    return {
      provider_file_id: f.id,
      name: f.name,
      mime_type: f.mimeType,
      size_bytes: f.size ? Number.parseInt(f.size, 10) : null,
      modified_at: f.modifiedTime ?? null,
      web_view_link: f.webViewLink ?? null,
    };
  }

  async download(fileId: string): Promise<ArrayBuffer> {
    const token = this.requireToken();
    // alt=media descarga el binario; para Google Docs nativos se usaría export.
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const res = await this.call(url, token, "download");
    return res.arrayBuffer();
  }

  private async call(url: URL | string, token: string, op: string): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (error) {
      throw new DriveApiError(
        "network",
        `Drive ${op}: ${error instanceof Error ? error.message : "error de red"}`,
      );
    }
    if (!res.ok) throw DriveApiError.fromStatus(op, res.status);
    return res;
  }

  private requireToken(): string {
    if (!this.credentials) throw new StorageNotConfiguredError(this.id);
    return this.credentials.accessToken;
  }
}
