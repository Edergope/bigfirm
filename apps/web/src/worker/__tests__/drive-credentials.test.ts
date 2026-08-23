import { describe, expect, it, vi } from "vitest";
import {
  DRIVE_READONLY_SCOPE,
  DriveConnectionError,
  DriveCredentialResolver,
  scopeIncludesDriveReadonly,
  type GoogleAccountRef,
} from "../services/drive-credentials.js";
import { GoogleDriveAdapter } from "../integrations/google-drive.js";

/**
 * G2/G3 — resolución de credenciales de Drive y renovación de token.
 *
 * El resolver delega el refresh/persistencia en `getAccessToken` (Better Auth). Los
 * tests usan un fake de `getAccessToken` respaldado por un "store" que simula el
 * comportamiento real: si el token vigente no expiró lo devuelve sin refrescar; si
 * expiró y hay refresh_token, produce uno nuevo y PERSISTE la nueva expiración.
 */

const FUTURE = () => new Date(Date.now() + 60 * 60 * 1000);
const PAST = () => new Date(Date.now() - 60 * 1000);

/** Ejecuta una promesa que debe rechazar y devuelve el Error capturado, ya tipado. */
async function captureError(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error("se esperaba un rechazo y no ocurrió");
}

function connectedAccount(over: Partial<GoogleAccountRef> = {}): GoogleAccountRef {
  return {
    accountId: "google-sub-123",
    scope: `openid email profile ${DRIVE_READONLY_SCOPE}`,
    hasRefreshToken: true,
    ...over,
  };
}

/** Fake de la API de token con refresh + persistencia observables. */
function tokenBackend(opts: {
  accessToken: string;
  expiresAt: Date;
  hasRefreshToken: boolean;
}) {
  const store = { accessToken: opts.accessToken, expiresAt: opts.expiresAt };
  const refreshes: number[] = [];
  const getAccessToken = vi.fn(async () => {
    const expired = store.expiresAt.getTime() <= Date.now();
    if (expired) {
      if (!opts.hasRefreshToken) {
        // Sin refresh_token utilizable: se devuelve el token expirado tal cual.
        return { accessToken: store.accessToken, accessTokenExpiresAt: store.expiresAt };
      }
      // Refresca y persiste la nueva expiración.
      refreshes.push(Date.now());
      store.accessToken = "at_refreshed";
      store.expiresAt = FUTURE();
    }
    return { accessToken: store.accessToken, accessTokenExpiresAt: store.expiresAt };
  });
  return { getAccessToken, store, refreshes };
}

describe("scopeIncludesDriveReadonly", () => {
  it("acepta scope separado por espacios y por comas", () => {
    expect(scopeIncludesDriveReadonly(`openid ${DRIVE_READONLY_SCOPE}`)).toBe(true);
    expect(scopeIncludesDriveReadonly(`openid,${DRIVE_READONLY_SCOPE}`)).toBe(true);
  });
  it("rechaza scope sin drive.readonly o nulo", () => {
    expect(scopeIncludesDriveReadonly("openid email profile")).toBe(false);
    expect(scopeIncludesDriveReadonly(null)).toBe(false);
  });
});

describe("DriveCredentialResolver", () => {
  it("construye un GoogleDriveAdapter con credenciales reales del resolver", async () => {
    const backend = tokenBackend({ accessToken: "at_valid", expiresAt: FUTURE(), hasRefreshToken: true });
    const resolver = new DriveCredentialResolver(async () => connectedAccount(), backend.getAccessToken);
    const adapter = await resolver.resolveAdapter("usr_1");
    expect(adapter).toBeInstanceOf(GoogleDriveAdapter);
    expect(adapter.status()).toBe("CONNECTED");
  });

  it("access_token vigente NO dispara refresh", async () => {
    const backend = tokenBackend({ accessToken: "at_valid", expiresAt: FUTURE(), hasRefreshToken: true });
    const resolver = new DriveCredentialResolver(async () => connectedAccount(), backend.getAccessToken);
    await resolver.resolveAdapter("usr_1");
    expect(backend.getAccessToken).toHaveBeenCalledOnce();
    expect(backend.refreshes).toHaveLength(0);
  });

  it("access_token expirado dispara refresh y persiste la nueva expiración", async () => {
    const backend = tokenBackend({ accessToken: "at_old", expiresAt: PAST(), hasRefreshToken: true });
    const before = backend.store.expiresAt.getTime();
    const resolver = new DriveCredentialResolver(async () => connectedAccount(), backend.getAccessToken);
    const adapter = await resolver.resolveAdapter("usr_1");
    expect(adapter).toBeInstanceOf(GoogleDriveAdapter);
    expect(backend.refreshes).toHaveLength(1); // hubo refresh
    expect(backend.store.accessToken).toBe("at_refreshed"); // token rotado
    expect(backend.store.expiresAt.getTime()).toBeGreaterThan(before); // nueva expiración persistida
  });

  it("sin cuenta Google → DRIVE_NOT_CONNECTED", async () => {
    const backend = tokenBackend({ accessToken: "x", expiresAt: FUTURE(), hasRefreshToken: true });
    const resolver = new DriveCredentialResolver(async () => null, backend.getAccessToken);
    await expect(resolver.resolveAdapter("usr_1")).rejects.toMatchObject({
      name: "DriveConnectionError",
      code: "DRIVE_NOT_CONNECTED",
    });
    expect(backend.getAccessToken).not.toHaveBeenCalled();
  });

  it("scope sin drive.readonly → DRIVE_SCOPE_MISSING", async () => {
    const backend = tokenBackend({ accessToken: "x", expiresAt: FUTURE(), hasRefreshToken: true });
    const resolver = new DriveCredentialResolver(
      async () => connectedAccount({ scope: "openid email profile" }),
      backend.getAccessToken,
    );
    await expect(resolver.resolveAdapter("usr_1")).rejects.toMatchObject({
      code: "DRIVE_SCOPE_MISSING",
    });
  });

  it("refresh_token ausente + token expirado → DRIVE_REAUTH_REQUIRED", async () => {
    const backend = tokenBackend({ accessToken: "at_old", expiresAt: PAST(), hasRefreshToken: false });
    const resolver = new DriveCredentialResolver(
      async () => connectedAccount({ hasRefreshToken: false }),
      backend.getAccessToken,
    );
    await expect(resolver.resolveAdapter("usr_1")).rejects.toMatchObject({
      code: "DRIVE_REAUTH_REQUIRED",
    });
  });

  it("invalid_grant / token revocado (getAccessToken lanza) → DRIVE_REAUTH_REQUIRED", async () => {
    const getAccessToken = vi.fn(async () => {
      throw new Error("invalid_grant: Token has been expired or revoked. secret=at_should_not_leak");
    });
    const resolver = new DriveCredentialResolver(async () => connectedAccount(), getAccessToken);
    await expect(resolver.resolveAdapter("usr_1")).rejects.toMatchObject({
      code: "DRIVE_REAUTH_REQUIRED",
    });
  });

  it("los errores normalizados NUNCA contienen valores de token", async () => {
    // Caso A: getAccessToken lanza con un token en el mensaje subyacente.
    const throwing = vi.fn(async () => {
      throw new Error("boom refresh_token=rt_LEAK access_token=at_LEAK");
    });
    const r1 = new DriveCredentialResolver(async () => connectedAccount(), throwing);
    const e1 = await captureError(() => r1.resolveAdapter("usr_1"));
    expect(e1).toBeInstanceOf(DriveConnectionError);
    expect(e1.message).not.toContain("rt_LEAK");
    expect(e1.message).not.toContain("at_LEAK");

    // Caso B: reauth por token no renovable.
    const backend = tokenBackend({ accessToken: "at_SECRET", expiresAt: PAST(), hasRefreshToken: false });
    const r2 = new DriveCredentialResolver(
      async () => connectedAccount({ hasRefreshToken: false }),
      backend.getAccessToken,
    );
    const e2 = await captureError(() => r2.resolveAdapter("usr_1"));
    expect(e2.message).not.toContain("at_SECRET");
  });
});
