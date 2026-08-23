/**
 * Entorno del Worker.
 *
 * Los bindings NO se declaran a mano: los genera `pnpm cf-typegen` a partir de
 * wrangler.jsonc en `worker-configuration.d.ts` (interfaz global `Env`). Duplicarlos
 * aquí sólo crea una segunda fuente de verdad que se desincroniza.
 *
 * Lo que sí se declara aquí son los SECRETOS, que por definición no aparecen en
 * wrangler.jsonc: se cargan con `wrangler secret put` y en local con `.dev.vars`.
 */
export interface IusiaSecrets {
  BETTER_AUTH_SECRET: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  AI_GATEWAY_TOKEN?: string;
  /**
   * Entorno de ejecución. Suministrado por entorno, NO por la config base deployable:
   * en local vía `.dev.vars` (=development). Ausente/!= "development" ⇒ el harness dev
   * queda cerrado (fail-closed). Nunca se declara "development" en wrangler.jsonc.
   */
  IUSIA_ENV?: string;
  /** URL pública de la app (baseURL de Better Auth). Local vía `.dev.vars`; deploy la aporta. */
  APP_URL: string;
  /** OAuth de Google para Drive. Aún no aprovisionado; ver docs/PENDIENTES.md. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Resend (NotificationService). Sin esto, las notificaciones quedan NOT_CONFIGURED. */
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
}

declare global {
  interface Env extends IusiaSecrets {}
}

/** Alias local del `Env` global generado, para poder importarlo explícitamente. */
type IusiaEnv = Env;
export type { IusiaEnv as Env };
