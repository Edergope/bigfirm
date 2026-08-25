import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { createDb, schema } from "@iusia/db";
import { ResendNotificationProvider } from "../integrations/notifications.js";
import type { Env } from "../env.js";
import { firmAccessControl, firmRoles } from "./roles.js";

/**
 * Better Auth es la identidad de IUSIA. No implementamos criptografía, sesiones
 * ni gestión de contraseñas propias (Blueprint §04).
 *
 * Lo que Better Auth NO decide: qué puede hacer una persona dentro de un Matter.
 * Eso lo resuelve `AuthorizationService`.
 */
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
          from: env.RESEND_FROM ?? "no-reply@iusia.co",
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
