import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
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
