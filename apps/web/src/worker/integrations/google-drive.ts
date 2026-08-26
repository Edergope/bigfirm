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
  /** Access token OAuth del usuario/servicio (scope drive.readonly y/o drive.file). */
  accessToken: string;
}

/** Escapa apóstrofes y barras para las consultas `q` de la Drive API. */
function escapeQ(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
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
    // `fetch` global de Workers exige `this = globalThis`; el wrapper preserva el
    // binding para evitar "Illegal invocation" al llamarlo como propiedad de instancia.
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
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

  // ─────────────────────────── Escritura (drive.file) ───────────────────────────
  //
  // Todo lo que sigue exige el scope `drive.file`: IUSIA sólo crea y gestiona sus
  // propios archivos y carpetas. La idempotencia de carpetas (find-or-create) evita
  // duplicados en reintentos.

  /** Busca una carpeta por nombre dentro de un padre. `null` si no existe. */
  async findFolder(name: string, parentId: string): Promise<string | null> {
    const token = this.requireToken();
    const q = [
      `name = '${escapeQ(name)}'`,
      `'${escapeQ(parentId)}' in parents`,
      "mimeType = 'application/vnd.google-apps.folder'",
      "trashed = false",
    ].join(" and ");
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", q);
    url.searchParams.set("fields", "files(id,name)");
    url.searchParams.set("pageSize", "1");
    const res = await this.call(url, token, "findFolder");
    const body = (await res.json()) as { files?: Array<{ id: string }> };
    return body.files?.[0]?.id ?? null;
  }

  /**
   * Devuelve el id de una carpeta con ese nombre bajo el padre, creándola si no
   * existe. Idempotente: dos llamadas concurrentes pueden crear duplicados, así que
   * el caller debe persistir el id devuelto y no reintentar a ciegas.
   */
  async ensureFolder(name: string, parentId?: string): Promise<string> {
    const existing = parentId ? await this.findFolder(name, parentId) : null;
    if (existing) return existing;
    return this.createFolder(name, parentId);
  }

  async createFolder(name: string, parentId?: string): Promise<string> {
    const token = this.requireToken();
    const metadata: Record<string, unknown> = {
      name,
      mimeType: "application/vnd.google-apps.folder",
    };
    if (parentId) metadata.parents = [parentId];
    const res = await this.authRequest(
      "https://www.googleapis.com/drive/v3/files?fields=id",
      token,
      "createFolder",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(metadata) },
    );
    const body = (await res.json()) as { id: string };
    return body.id;
  }

  /** Sube un archivo (multipart) a una carpeta. Devuelve la metadata del creado. */
  async uploadFile(input: {
    name: string;
    parentId: string;
    mimeType: string;
    content: ArrayBuffer | Uint8Array;
  }): Promise<StoredFileMetadata> {
    const token = this.requireToken();
    const boundary = `iusia-${crypto.randomUUID()}`;
    const metadata = JSON.stringify({ name: input.name, parents: [input.parentId] });
    const bytes = input.content instanceof Uint8Array ? input.content : new Uint8Array(input.content);
    const enc = new TextEncoder();
    const pre = enc.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`,
    );
    const post = enc.encode(`\r\n--${boundary}--\r\n`);
    const body = new Uint8Array(pre.length + bytes.length + post.length);
    body.set(pre, 0);
    body.set(bytes, pre.length);
    body.set(post, pre.length + bytes.length);

    const res = await this.authRequest(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,webViewLink",
      token,
      "uploadFile",
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      },
    );
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
      size_bytes: f.size ? Number.parseInt(f.size, 10) : bytes.length,
      modified_at: f.modifiedTime ?? null,
      web_view_link: f.webViewLink ?? null,
    };
  }

  /**
   * Conserva el DOCX original por separado e importa una copia operativa como
   * Google Doc. Drive realiza la conversión y mantiene la diagramación soportada.
   */
  async importDocxAsGoogleDoc(input: {
    name: string;
    parentId: string;
    content: ArrayBuffer | Uint8Array;
  }): Promise<string> {
    const token = this.requireToken();
    const boundary = `iusia-${crypto.randomUUID()}`;
    const metadata = JSON.stringify({
      name: input.name,
      parents: [input.parentId],
      mimeType: "application/vnd.google-apps.document",
    });
    const bytes = input.content instanceof Uint8Array ? input.content : new Uint8Array(input.content);
    const enc = new TextEncoder();
    const pre = enc.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`,
    );
    const post = enc.encode(`\r\n--${boundary}--\r\n`);
    const body = new Uint8Array(pre.length + bytes.length + post.length);
    body.set(pre, 0);
    body.set(bytes, pre.length);
    body.set(post, pre.length + bytes.length);
    const res = await this.authRequest(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
      token,
      "importDocxAsGoogleDoc",
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      },
    );
    return ((await res.json()) as { id: string }).id;
  }

  /** Crea un Google Doc nativo vacío en una carpeta. Devuelve su id. */
  async createDoc(name: string, parentId: string): Promise<string> {
    const token = this.requireToken();
    const res = await this.authRequest(
      "https://www.googleapis.com/drive/v3/files?fields=id",
      token,
      "createDoc",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          mimeType: "application/vnd.google-apps.document",
          parents: [parentId],
        }),
      },
    );
    const body = (await res.json()) as { id: string };
    return body.id;
  }

  /** Copia un archivo (p.ej. una plantilla Google Docs) con nombre y carpeta nuevos. */
  async copyFile(sourceId: string, name: string, parentId: string): Promise<string> {
    const token = this.requireToken();
    const res = await this.authRequest(
      `https://www.googleapis.com/drive/v3/files/${sourceId}/copy?fields=id`,
      token,
      "copyFile",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parents: [parentId] }),
      },
    );
    const body = (await res.json()) as { id: string };
    return body.id;
  }

  /** Exporta un Google Doc nativo a un formato binario (DOCX, PDF). */
  async exportFile(fileId: string, exportMime: string): Promise<ArrayBuffer> {
    const token = this.requireToken();
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`;
    const res = await this.call(url, token, "exportFile");
    return res.arrayBuffer();
  }

  /** Aplica reemplazos de texto sobre un Google Doc (Docs API batchUpdate). */
  async docsReplaceText(documentId: string, replacements: Record<string, string>): Promise<void> {
    const requests = Object.entries(replacements).map(([key, value]) => ({
      replaceAllText: {
        containsText: {
          text: key.startsWith("[") || key.startsWith("{{") ? key : `{{${key}}}`,
          matchCase: false,
        },
        replaceText: value,
      },
    }));
    if (requests.length === 0) return;
    await this.docsBatchUpdate(documentId, requests);
  }

  /** batchUpdate genérico de Docs API (para construir plantillas editoriales). */
  async docsBatchUpdate(documentId: string, requests: unknown[]): Promise<void> {
    if (requests.length === 0) return;
    const token = this.requireToken();
    await this.authRequest(
      `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
      token,
      "docsBatchUpdate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests }),
      },
    );
  }

  private async authRequest(
    url: string,
    token: string,
    op: string,
    init: { method: string; headers?: Record<string, string>; body?: BodyInit },
  ): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: init.method,
        headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
        body: init.body,
      });
    } catch (error) {
      throw new DriveApiError(
        "network",
        `Drive ${op}: ${error instanceof Error ? error.message : "error de red"}`,
      );
    }
    if (!res.ok) throw DriveApiError.fromStatus(op, res.status);
    return res;
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
