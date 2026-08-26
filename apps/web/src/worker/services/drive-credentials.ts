import { and, eq } from "drizzle-orm";
import { createDb, schema } from "@iusia/db";
import type { Env } from "../env.js";
import { createAuth } from "../auth/config.js";
import { GoogleDriveAdapter } from "../integrations/google-drive.js";

/**
 * DriveCredentialResolver — ÚNICA capa server-side que convierte "un usuario
 * autenticado" en un `GoogleDriveAdapter` con un access token válido.
 *
 * Por qué existe (G2/G3):
 *  - Los tokens OAuth viven CIFRADOS en la tabla `account` de Better Auth; leerlos
 *    a mano desde D1 devolvería basura cifrada. La renovación (refresh) y la
 *    persistencia del nuevo token las hace Better Auth vía `auth.api.getAccessToken`,
 *    que refresca automáticamente si el access token expiró y guarda el resultado.
 *  - Concentrar aquí la resolución evita consultas dispersas a `account` por los
 *    handlers y mantiene la autorización de Organization/Matter (AuthorizationService)
 *    completamente separada del OAuth de Drive.
 *
 * Seguridad: este resolver NUNCA devuelve tokens al frontend ni los incluye en los
 * mensajes de error. Sólo entrega un adapter ya construido o lanza un error
 * normalizado de (re)conexión.
 */

export const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export type DriveConnectionErrorCode =
  | "DRIVE_NOT_CONNECTED"
  | "DRIVE_SCOPE_MISSING"
  | "DRIVE_WRITE_SCOPE_MISSING"
  | "DRIVE_REAUTH_REQUIRED";

/** Error de conexión de Drive. El mensaje jamás contiene valores de token. */
export class DriveConnectionError extends Error {
  constructor(
    readonly code: DriveConnectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DriveConnectionError";
  }
}

/** Metadata NO sensible de la cuenta Google. Nunca incluye tokens. */
export interface GoogleAccountRef {
  /**
   * ID de la FILA de cuenta de Better Auth (`account.id`, PK), NO el `account_id`
   * del proveedor (el `sub` de Google). `auth.api.getAccessToken` selecciona la
   * cuenta por `account.id === accountId`; pasar el `sub` provoca ACCOUNT_NOT_FOUND.
   */
  accountId: string;
  scope: string | null;
  hasRefreshToken: boolean;
}

/** Localiza la cuenta Google vinculada a un usuario (sin exponer tokens). */
export type FindGoogleAccountFn = (userId: string) => Promise<GoogleAccountRef | null>;

/**
 * Obtiene un access token vigente para la cuenta. Debe refrescar de forma
 * transparente si expiró (lo cumple `auth.api.getAccessToken` de Better Auth).
 */
export type GetAccessTokenFn = (
  accountId: string,
  userId: string,
) => Promise<{ accessToken: string; accessTokenExpiresAt?: Date | null }>;

/** El scope persistido puede venir separado por espacios o comas. */
function scopeIncludes(scope: string | null, needle: string): boolean {
  if (!scope) return false;
  return scope.split(/[\s,]+/).filter(Boolean).includes(needle);
}
export function scopeIncludesDriveReadonly(scope: string | null): boolean {
  return scopeIncludes(scope, DRIVE_READONLY_SCOPE);
}
export function scopeIncludesDriveFile(scope: string | null): boolean {
  return scopeIncludes(scope, DRIVE_FILE_SCOPE);
}

function isExpired(at?: Date | null): boolean {
  // Sin dato de expiración se asume vigente: getAccessToken ya renovó si procedía.
  if (!at) return false;
  return at.getTime() <= Date.now();
}

export class DriveCredentialResolver {
  constructor(
    private readonly findGoogleAccount: FindGoogleAccountFn,
    private readonly getAccessToken: GetAccessTokenFn,
  ) {}

  static forEnv(env: Env): DriveCredentialResolver {
    const db = createDb(env.DB);
    const auth = createAuth(env);

    const find: FindGoogleAccountFn = async (userId) => {
      const rows = await db
        .select({
          // `account.id` (PK de Better Auth), que es lo que getAccessToken selecciona.
          id: schema.account.id,
          scope: schema.account.scope,
          refreshToken: schema.account.refreshToken,
        })
        .from(schema.account)
        .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "google")))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        accountId: row.id,
        scope: row.scope,
        hasRefreshToken: Boolean(row.refreshToken),
      };
    };

    const getToken: GetAccessTokenFn = async (accountId, userId) => {
      // getAccessToken refresca automáticamente si el token expiró y persiste el nuevo.
      const res = await auth.api.getAccessToken({ body: { accountId, userId } });
      return { accessToken: res.accessToken, accessTokenExpiresAt: res.accessTokenExpiresAt };
    };

    return new DriveCredentialResolver(find, getToken);
  }

  /**
   * Devuelve un `GoogleDriveAdapter` con credenciales válidas para el usuario, o
   * lanza `DriveConnectionError` normalizado. No expone tokens.
   */
  async resolveAdapter(
    userId: string,
    opts: { requireWrite?: boolean } = {},
  ): Promise<GoogleDriveAdapter> {
    const account = await this.findGoogleAccount(userId);
    if (!account) {
      throw new DriveConnectionError(
        "DRIVE_NOT_CONNECTED",
        "El usuario no ha conectado Google Drive.",
      );
    }
    // Escritura exige `drive.file`; lectura basta con cualquiera de los dos scopes,
    // porque `drive.file` también permite leer los archivos que IUSIA gestiona.
    if (opts.requireWrite) {
      if (!scopeIncludesDriveFile(account.scope)) {
        throw new DriveConnectionError(
          "DRIVE_WRITE_SCOPE_MISSING",
          "La conexión de Google no permite que IUSIA cree o guarde documentos en Drive; reconecta otorgando el acceso.",
        );
      }
    } else if (
      !scopeIncludesDriveReadonly(account.scope) &&
      !scopeIncludesDriveFile(account.scope)
    ) {
      throw new DriveConnectionError(
        "DRIVE_SCOPE_MISSING",
        "La conexión de Google no incluye acceso a Drive; reconecta otorgando el acceso.",
      );
    }

    let token: { accessToken: string; accessTokenExpiresAt?: Date | null };
    try {
      token = await this.getAccessToken(account.accountId, userId);
    } catch {
      // invalid_grant / token revocado / fallo de refresh → requiere reconexión OAuth.
      // El error subyacente NO se propaga para no arriesgar filtrar valores de token.
      throw new DriveConnectionError(
        "DRIVE_REAUTH_REQUIRED",
        "La conexión de Google expiró o fue revocada; reconecta Google Drive.",
      );
    }

    if (!token.accessToken || isExpired(token.accessTokenExpiresAt)) {
      // access token no renovable (p.ej. sin refresh_token): reconexión requerida.
      throw new DriveConnectionError(
        "DRIVE_REAUTH_REQUIRED",
        "No fue posible obtener un acceso vigente a Google Drive; reconecta la cuenta.",
      );
    }

    return new GoogleDriveAdapter({ accessToken: token.accessToken });
  }
}
