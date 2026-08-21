import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { firmAccessControl, firmRoles } from "./roles.js";

/**
 * Configuración SÓLO para el generador de esquema de Better Auth.
 *
 * Refleja los plugins de `config.ts` sin depender de bindings de Cloudflare, para
 * que la CLI pueda derivar las tablas. Regenerar con:
 *   pnpm --filter @iusia/web auth:generate
 *
 * Si se añade un plugin en config.ts, hay que añadirlo aquí y regenerar el esquema.
 */
export const auth = betterAuth({
  // El generador necesita conocer el dialecto; no ejecuta consultas.
  database: drizzleAdapter({} as never, { provider: "sqlite", schema: {} }),
  emailAndPassword: { enabled: true },
  socialProviders: { google: { clientId: "", clientSecret: "" } },
  plugins: [
    organization({
      teams: { enabled: true },
      ac: firmAccessControl,
      roles: firmRoles,
      creatorRole: "FIRM_DIRECTOR",
    }),
  ],
});
