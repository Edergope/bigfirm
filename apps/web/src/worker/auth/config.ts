import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { AuditRepository, createDb, schema } from "@iusia/db";
import { ResendNotificationProvider } from "../integrations/notifications.js";
import { authorizeOnboarding } from "./invitation-guard.js";
import type { Env } from "../env.js";
import { firmAccessControl, firmRoles } from "./roles.js";

/**
 * Better Auth es la identidad de IUSIA. No implementamos criptografía, sesiones
 * ni gestión de contraseñas propias (Blueprint §04).
 *
 * Lo que Better Auth NO decide: qué puede hacer una persona dentro de un Matter.
 * Eso lo resuelve `AuthorizationService`.
 */
/**
 * Remitente por defecto. Coincide con el que ya usaba `NotificationService`: el
 * repo tiene UNA convención de remitente, no dos. En un despliegue real debe
 * suministrarse `RESEND_FROM` con una dirección de dominio VERIFICADO en Resend.
 */
const DEFAULT_SENDER = "IUSIA <notificaciones@iusia.legal>";

/**
 * Deja rastro cuando un correo de autenticación NO llega a entregarse.
 *
 * Un fallo de entrega silencioso es indistinguible de un correo que el usuario no
 * abrió: sin esto, una invitación que Resend rechaza parece haberse enviado. Se
 * registran únicamente el flujo y la clasificación del fallo — nunca la API key, el
 * destinatario, el enlace ni el contenido del mensaje.
 */
function logDeliveryOutcome(
  flow: string,
  result: { status: string; failure_kind?: string | null; error?: string | null },
): void {
  if (result.status === "SENT") return;
  console.warn("auth_email_not_delivered", {
    flow,
    status: result.status,
    failure_kind: result.failure_kind ?? null,
    // `error` del proveedor: código HTTP o motivo normalizado, sin datos personales.
    detail: result.error ?? null,
  });
}

/**
 * Scopes de Drive, SEPARADOS del login de identidad (IDENTITY_AUTH != DRIVE_AUTH).
 *
 * - `drive.readonly`: la mitad de lectura (Drive→Queue→R2→AI Search→RAG) ya validada.
 * - `drive.file`: escritura acotada — IUSIA sólo ve y gestiona los archivos y
 *   carpetas que ELLA crea. Es el mínimo privilegio para el workspace documental
 *   (raíz administrada, carpetas de expediente, subida de aportados, generación de
 *   entregables) y NO da acceso al resto del Drive del usuario. Google no exige para
 *   `drive.file` la evaluación de seguridad que sí pide `drive.readonly`.
 *
 * Objetivo posterior: LEAST_PRIVILEGE_PRODUCTION = drive.file, si el flujo completo
 * lo permite (ver DRIVE_READONLY_DEPENDENCY_AUDIT). Por ahora se piden AMBOS para no
 * regresar la lectura ya validada antes de comprobar sus dependencias.
 */
export const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
/** Scopes que solicita la autorización incremental de Drive (nunca el login). */
export const DRIVE_SCOPES = [DRIVE_READONLY_SCOPE, DRIVE_FILE_SCOPE] as const;

/**
 * Config del social provider de Google: SÓLO IDENTIDAD.
 *
 * Iniciar sesión y autorizar Google Drive son cosas distintas (Sprint 7.8). El login
 * pide únicamente los scopes de identidad que Better Auth añade por defecto
 * (openid/email/profile); NO pide Drive y NO fuerza `prompt: "consent"` en cada
 * entrada. El acceso a Drive se solicita después, de forma incremental y explícita,
 * con `linkSocial({ provider: "google", scopes: [DRIVE_READONLY_SCOPE] })`.
 *
 * `accessType: "offline"` se conserva a nivel de proveedor porque la ingesta
 * documental corre en background (Queue) y necesita refresh_token cuando el usuario
 * SÍ autoriza Drive. No amplía lo que se pide al iniciar sesión.
 */
export function buildGoogleSocialProvider(env: Env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return {};
  return {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      accessType: "offline" as const,
    },
  };
}

export function createAuth(env: Env) {
  const db = createDb(env.DB);

  return betterAuth({
    baseURL: env.APP_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,

    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        organization: schema.organization,
        member: schema.member,
        invitation: schema.invitation,
        team: schema.team,
        teamMember: schema.teamMember,
      },
    }),

    // Origen confiable explícito: evita que otro sitio dispare flujos de auth.
    trustedOrigins: [env.APP_URL],

    /**
     * ONBOARDING SÓLO POR INVITACIÓN (Sprint 7.9).
     *
     * Toda creación de usuario —por contraseña o por Google— atraviesa este hook.
     * Sin una invitación vigente para ese email exacto, se aborta: no queda usuario
     * huérfano, no se devuelve sólo un código de error. Es el cierre server-side del
     * alta pública; ocultar el botón de la UI no cerraría nada.
     */
    databaseHooks: {
      user: {
        create: {
          before: async (userData, context) => {
            const decision = await authorizeOnboarding({
              db,
              email: String((userData as { email?: unknown }).email ?? ""),
              userData: userData as { emailVerified?: unknown },
              context,
            });
            if (decision.allowed) return;
            throw new APIError("FORBIDDEN", {
              code: "INVITATION_REQUIRED",
              message:
                "IUSIA no admite registro público: el acceso lo habilita la dirección de tu firma mediante invitación.",
            });
          },
        },
      },
    },

    /**
     * Campo de sistema gobernado por Better Auth con `input: false`: si un cliente
     * lo envía en signup/update, Better Auth responde BAD_REQUEST, y el perfil de
     * Google tampoco puede inyectarlo. Sólo se escribe server-side (bootstrap).
     */
    user: {
      additionalFields: {
        systemRole: {
          type: "string",
          required: false,
          input: false,
          returned: false,
        },
      },
    },

    emailAndPassword: {
      enabled: true,
      // Verificación por email pendiente del proveedor de notificaciones (Resend).
      requireEmailVerification: false,
      // Recuperación de contraseña con las rutas nativas /forget-password y
      // /reset-password. El envío reutiliza el transporte Resend ya existente; sin
      // API key queda NOT_CONFIGURED y no se filtra si el email existe o no.
      sendResetPassword: async ({ user, url }) => {
        const provider = new ResendNotificationProvider({
          apiKey: env.RESEND_API_KEY ?? null,
          from: env.RESEND_FROM ?? DEFAULT_SENDER,
        });
        const result = await provider.send({
          to: user.email,
          subject: "Restablecer tu contraseña de IUSIA",
          text:
            "Recibimos una solicitud para restablecer tu contraseña.\n\n" +
            `Abre este enlace para elegir una nueva: ${url}\n\n` +
            "Si no lo solicitaste, ignora este mensaje: tu contraseña no cambia.",
          tags: { flow: "password_reset" },
        });
        logDeliveryOutcome("password_reset", result);
      },
    },

    // OAuth de Google (ver `buildGoogleSocialProvider`): identidad + Drive de sólo
    // lectura con acceso offline. Inactivo hasta aprovisionar credenciales.
    socialProviders: buildGoogleSocialProvider(env),

    plugins: [
      organization({
        // Organization = firma jurídica. Es la entidad superior del multitenancy.
        teams: { enabled: true },
        // NO hay alta self-service de firmas: IUSIA no es todavía un SaaS abierto.
        // El tenant se aprovisiona server-side. Capacidad nativa del plugin.
        allowUserToCreateOrganization: false,
        /**
         * Entrega de la invitación con el transporte que ya existe. El enlace lleva
         * el id de la invitación: recibirlo es lo que acredita el control del correo.
         * Sin API key el proveedor queda NOT_CONFIGURED y no se filtra nada.
         */
        sendInvitationEmail: async (data) => {
          // El resultado del envío se AUDITA: una invitación cuyo correo no sale deja
          // al invitado esperando indefinidamente, y sin rastro es indistinguible de
          // un correo no abierto. Se registra el desenlace, nunca el enlace ni la clave.
          const audit = new AuditRepository(db);
          const organizationId = data.organization?.id ?? "";
          let outcome: string;
          let detail: string | null;
          try {
            const provider = new ResendNotificationProvider({
              apiKey: env.RESEND_API_KEY ?? null,
              from: env.RESEND_FROM ?? DEFAULT_SENDER,
            });
            const link = `${env.APP_URL}/invitacion?invitationId=${encodeURIComponent(data.id)}`;
            const inviterName = data.inviter?.user?.name ?? "La dirección de tu firma";
            const organizationName = data.organization?.name ?? "tu firma";
            const result = await provider.send({
              to: data.email,
              subject: `${organizationName} te invitó a IUSIA`,
              text:
                `${inviterName} te invitó a trabajar en ${organizationName}.\n\n` +
                `Acepta la invitación aquí: ${link}\n\n` +
                "El enlace caduca y sólo puede usarse una vez. Si no esperabas esta invitación, ignora este mensaje.",
              tags: { flow: "organization_invitation" },
            });
            logDeliveryOutcome("organization_invitation", result);
            outcome = result.status;
            detail = "error" in result ? (result.error ?? null) : null;
          } catch (error) {
            // Better Auth traga las excepciones de este callback: sin este catch, un
            // fallo de plantilla o de red desaparecería sin dejar rastro.
            outcome = "THREW";
            detail = error instanceof Error ? error.message.slice(0, 200) : "error desconocido";
          }
          if (organizationId) {
            await audit.record({
              organizationId,
              actorUserId: data.inviter?.user?.id ?? null,
              action: "invitation.email",
              resourceType: "invitation",
              resourceId: data.id,
              outcome: outcome === "SENT" ? "SUCCESS" : "FAILURE",
              reason: outcome === "SENT" ? null : outcome,
              detail: detail ? { detail } : undefined,
            });
          }
        },
        // Roles de firma de IUSIA. Gobiernan la administración de la organización,
        // NO el acceso a cada Matter: eso lo decide AuthorizationService.
        ac: firmAccessControl,
        roles: firmRoles,
        creatorRole: "FIRM_DIRECTOR",
      }),
    ],
  });
}

export type IusiaAuth = ReturnType<typeof createAuth>;
