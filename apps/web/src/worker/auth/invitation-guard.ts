import { and, eq, gt } from "drizzle-orm";
import { schema, type IusiaDb } from "@iusia/db";

/**
 * Onboarding SÓLO POR INVITACIÓN (Sprint 7.9).
 *
 * IUSIA opera un tenant privado: nadie crea una identidad visitando un endpoint
 * público. Toda alta de usuario —por contraseña o por Google— pasa por el hook
 * `databaseHooks.user.create.before` de Better Auth, que aborta la creación si no
 * existe una autorización previa válida. Cerrar el botón de la UI no basta: esto
 * es el cierre server-side.
 *
 * PRUEBA DE CONTROL DEL EMAIL (no basta con "conozco un email invitado"):
 *  - Google: el proveedor ASEVERA el email y su verificación. Coincidir con la
 *    invitación es prueba suficiente de control.
 *  - Contraseña: se exige además el id de la invitación, que sólo conoce quien
 *    recibió el correo. Es la posesión del enlace lo que acredita el control.
 */

/** Cabecera con la que el enlace de invitación acredita su posesión. */
export const INVITATION_HEADER = "x-iusia-invitation";

export interface PendingInvitation {
  id: string;
  organizationId: string;
  email: string;
  role: string | null;
}

/** Invitación vigente (pendiente y no expirada) para ese email exacto. */
export async function findPendingInvitation(
  db: IusiaDb,
  email: string,
  now: Date = new Date(),
): Promise<PendingInvitation | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const [row] = await db
    .select({
      id: schema.invitation.id,
      organizationId: schema.invitation.organizationId,
      email: schema.invitation.email,
      role: schema.invitation.role,
    })
    .from(schema.invitation)
    .where(
      and(
        eq(schema.invitation.email, normalized),
        eq(schema.invitation.status, "pending"),
        gt(schema.invitation.expiresAt, now),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Extrae el id de invitación de la petición. Se busca en la cabecera dedicada y,
 * como respaldo, en el cuerpo/consulta; nunca se deduce del email.
 */
export function readInvitationId(context: unknown): string | null {
  const ctx = context as
    | {
        headers?: Headers;
        request?: { headers?: Headers; url?: string };
        body?: Record<string, unknown>;
        query?: Record<string, unknown>;
      }
    | null
    | undefined;
  if (!ctx) return null;

  const fromHeaders =
    ctx.headers?.get?.(INVITATION_HEADER) ?? ctx.request?.headers?.get?.(INVITATION_HEADER);
  if (typeof fromHeaders === "string" && fromHeaders.length > 0) return fromHeaders;

  const fromBody = ctx.body?.[INVITATION_HEADER] ?? ctx.body?.invitationId;
  if (typeof fromBody === "string" && fromBody.length > 0) return fromBody;

  const fromQuery = ctx.query?.invitationId;
  if (typeof fromQuery === "string" && fromQuery.length > 0) return fromQuery;

  try {
    const url = ctx.request?.url;
    if (url) {
      const value = new URL(url).searchParams.get("invitationId");
      if (value) return value;
    }
  } catch {
    // URL malformada: se ignora y el flujo sigue siendo fail-closed.
  }
  return null;
}

/**
 * ¿La creación proviene de un proveedor de identidad (OAuth)?
 *
 * En el alta por contraseña el email todavía no está verificado y la ruta es
 * `/sign-up/email`; en OAuth, el proveedor entrega el email ya verificado.
 */
export function isProviderAssertedSignup(
  userData: { emailVerified?: unknown },
  context: unknown,
): boolean {
  const path = (context as { path?: string } | null)?.path;
  if (typeof path === "string" && path.length > 0) {
    if (path.includes("/sign-up/email")) return false;
    if (path.includes("/callback") || path.includes("/oauth")) return true;
  }
  return userData.emailVerified === true;
}

export type OnboardingDecision =
  | { allowed: true; invitation: PendingInvitation }
  | { allowed: false; reason: "NO_PENDING_INVITATION" | "INVITATION_PROOF_REQUIRED" };

/**
 * Decide si una identidad nueva puede crearse. Fail-closed: sin invitación vigente
 * para ese email exacto, no se crea nada.
 */
export async function authorizeOnboarding(args: {
  db: IusiaDb;
  email: string;
  userData: { emailVerified?: unknown };
  context: unknown;
  now?: Date;
}): Promise<OnboardingDecision> {
  const invitation = await findPendingInvitation(args.db, args.email, args.now);
  if (!invitation) return { allowed: false, reason: "NO_PENDING_INVITATION" };

  // Google aseveró el email: la coincidencia ya prueba el control de la cuenta.
  if (isProviderAssertedSignup(args.userData, args.context)) {
    return { allowed: true, invitation };
  }

  // Alta por contraseña: hay que demostrar posesión del enlace enviado por correo.
  const provided = readInvitationId(args.context);
  if (!provided || provided !== invitation.id) {
    return { allowed: false, reason: "INVITATION_PROOF_REQUIRED" };
  }
  return { allowed: true, invitation };
}
