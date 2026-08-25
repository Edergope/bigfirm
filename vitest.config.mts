import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Dos entornos, porque el código bajo prueba vive en dos runtimes distintos:
 * el dominio y el Worker se ejecutan sin DOM (igual que en Cloudflare), y la
 * experiencia de análisis sólo puede verificarse con DOM real —que cerrar el
 * modal NO cancele el trabajo no es demostrable sin renderizarlo.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["packages/*/src/**/*.test.ts", "apps/web/src/worker/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        plugins: [react()],
        test: {
          name: "client",
          include: ["apps/web/src/client/**/*.test.tsx"],
          environment: "jsdom",
        },
      },
    ],
  },
});
