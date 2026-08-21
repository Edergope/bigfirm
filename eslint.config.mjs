import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.wrangler/**",
      "apps/web/worker-configuration.d.ts",
      "apps/web/migrations/**",
      // Repositorio canónico de agentes: no es código de la plataforma.
      "repo/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // El dominio jurídico no puede degradarse a `any` silenciosamente.
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["warn", { allow: ["error", "warn"] }],
    },
  },
  {
    // El esquema de Better Auth es generado: no se le aplica el estilo del proyecto.
    files: ["packages/db/src/schema/auth.ts"],
    rules: { "@typescript-eslint/no-unused-vars": "off" },
  },
  {
    // Scripts de build: corren en Node, no en el runtime de Workers.
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
    rules: { "no-console": "off" },
  },
  {
    // `declare global { interface Env extends IusiaSecrets {} }` es una ampliación
    // de la interfaz global generada por wrangler, no una interfaz vacía inútil.
    files: ["apps/web/src/worker/env.ts"],
    rules: { "@typescript-eslint/no-empty-object-type": "off" },
  },
);
