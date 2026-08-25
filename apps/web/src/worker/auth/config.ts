import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { createDb, schema } from "@iusia/db";
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

/** Scope de SÓLO LECTURA de Drive. Mínimo privilegio: nunca se pide escritura. */
export const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

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
        await provider.send({
          to: user.email,
          subject: "Restablecer tu contraseña de IUSIA",
          text:
            "Recibimos una solicitud para restablecer tu contraseña.\n\n" +
            `Abre este enlace para elegir una nueva: ${url}\n\n` +
            "Si no lo solicitaste, ignora este mensaje: tu contraseña no cambia.",
          tags: { flow: "password_reset" },
        });
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
          const provider = new ResendNotificationProvider({
            apiKey: env.RESEND_API_KEY ?? null,
            from: env.RESEND_FROM ?? DEFAULT_SENDER,
          });
          const link = `${env.APP_URL}/invitacion?invitationId=${encodeURIComponent(data.id)}`;
          await provider.send({
            to: data.email,
            subject: `${data.organization.name} te invitó a IUSIA`,
            text:
              `${data.inviter.user.name} te invitó a trabajar en ${data.organization.name}.\n\n` +
              `Acepta la invitación aquí: ${link}\n\n` +
              "El enlace caduca y sólo puede usarse una vez. Si no esperabas esta invitación, ignora este mensaje.",
            tags: { flow: "organization_invitation" },
          });
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
