import {
  StorageNotConfiguredError,
  type DocumentStorageProvider,
  type IntegrationState,
  type StoredFileMetadata,
} from "@iusia/domain";

/**
 * GoogleDriveAdapter — adapter del port DocumentStorageProvider.
 *
 * Estado actual: ADAPTER listo, OAuth de Google NO aprovisionado. Sin un access
 * token válido, `status()` es NOT_CONFIGURED y las operaciones lanzan
 * StorageNotConfiguredError. No se inventan archivos ni metadata.
 *
 * El dominio jamás ve tipos del SDK de Google: este adapter traduce a
 * `StoredFileMetadata`. Google Drive sigue siendo el repositorio primario; IUSIA
 * sólo guarda referencias y metadata.
 */
export interface GoogleDriveCredentials {
  /** Access token OAuth del usuario/servicio con scope drive.readonly. */
  accessToken: string;
}

export class GoogleDriveAdapter implements DocumentStorageProvider {
  readonly id = "google-drive";
  private readonly credentials: GoogleDriveCredentials | null;

  constructor(credentials: GoogleDriveCredentials | null) {
    this.credentials = credentials;
  }

  status(): IntegrationState {
    return this.credentials ? "CONNECTED" : "NOT_CONFIGURED";
  }

  async getMetadata(fileId: string): Promise<StoredFileMetadata> {
    const token = this.requireToken();
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
    url.searchParams.set("fields", "id,name,mimeType,size,modifiedTime,webViewLink");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Drive getMetadata HTTP ${res.status}`);
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
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Drive download HTTP ${res.status}`);
    return res.arrayBuffer();
  }

  private requireToken(): string {
    if (!this.credentials) throw new StorageNotConfiguredError(this.id);
    return this.credentials.accessToken;
  }
}
