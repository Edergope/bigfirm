import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { createDb, schema } from "@iusia/db";
import type { Env } from "../env.js";
import { firmAccessControl, firmRoles } from "./roles.js";

/**
 * Better Auth es la identidad de IUSIA. No implementamos criptografía, sesiones
 * ni gestión de contraseñas propias (Blueprint §04).
 *
 * Lo que Better Auth NO decide: qué puede hacer una persona dentro de un Matter.
 * Eso lo resuelve `AuthorizationService`.
 */
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

    emailAndPassword: {
      enabled: true,
      // Verificación por email pendiente del proveedor de notificaciones (Resend).
      requireEmailVerification: false,
    },

    // OAuth de Google queda listo pero inactivo hasta aprovisionar credenciales.
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {},

    plugins: [
      organization({
        // Organization = firma jurídica. Es la entidad superior del multitenancy.
        teams: { enabled: true },
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
