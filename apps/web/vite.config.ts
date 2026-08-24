import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

/**
 * Modo RAG-E2E (opt-in, LOCAL): `IUSIA_RAG_E2E=1 pnpm dev` conecta ÚNICAMENTE el
 * binding ARTIFACTS al R2 REMOTO real (bucket iusia-artifacts), manteniendo D1,
 * Queues, Durable Objects y PROMPTS LOCALES y con el MISMO `.wrangler/state`
 * (no se cambia de environment de Wrangler, así que el estado local —Matter,
 * documento, cuenta OAuth— se conserva). Fuera de este modo, `pnpm dev` normal
 * deja ARTIFACTS local (Miniflare). IUSIA_ENV se fuerza a "staging" en este modo
 * para que el harness dev quede cerrado (404); nunca "development".
 */
const ragE2E = process.env.IUSIA_RAG_E2E === "1";

/**
 * IUSIA_ENV se fija AQUÍ (customizer del plugin) y NO en `.dev.vars`, porque las
 * secrets de `.dev.vars` tienen mayor precedencia y sobreescribirían el valor. Al
 * ser fuente única para el runtime LOCAL de Vite (y NUNCA leído por `wrangler deploy`),
 * el contrato fail-closed del deploy se mantiene (wrangler.jsonc sigue sin IUSIA_ENV).
 *   - dev normal → development (harness dev disponible en local)
 *   - RAG-E2E    → staging (harness dev cerrado: 404) + ARTIFACTS remoto
 */
const cloudflarePlugin = cloudflare({
  remoteBindings: ragE2E,
  config: (cfg: {
    r2_buckets?: Array<{ binding: string; remote?: boolean }>;
    ai_search?: Array<{ binding: string; instance_name: string; remote?: boolean }>;
    vars?: Record<string, unknown>;
  }) => {
    if (ragE2E) {
      for (const b of cfg.r2_buckets ?? []) {
        if (b.binding === "ARTIFACTS") b.remote = true; // SÓLO ARTIFACTS -> remoto
      }
      // AI Search no tiene emulación local: se añade el binding SÓLO en modo E2E
      // (remoto). En `pnpm dev` normal no existe → env.AI_SEARCH undefined → NOT_CONFIGURED.
      cfg.ai_search = [{ binding: "AI_SEARCH", instance_name: "iusia-rag-e2e", remote: true }];
    }
    cfg.vars = { ...(cfg.vars ?? {}), IUSIA_ENV: ragE2E ? "staging" : "development" };
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflarePlugin],
  build: {
    rollupOptions: {
      output: {
        // El Agents SDK enruta callbacks por constructor.name: los nombres de clase
        // deben sobrevivir al bundling (docs de Agents SDK, "Routing constraints").
        minifyInternalExports: false,
      },
    },
  },
  esbuild: {
    keepNames: true,
  },
});
