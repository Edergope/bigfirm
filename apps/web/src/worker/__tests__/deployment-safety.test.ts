import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SECURITY / anti-regresión — la configuración base deployable (wrangler.jsonc) NUNCA
 * debe declarar IUSIA_ENV (y menos "development") ni acoplar APP_URL a localhost. Si
 * alguien lo re-introduce, un `wrangler deploy` volvería a exponer el harness dev.
 */

// cwd de vitest = raíz del repo.
const WRANGLER = join(process.cwd(), "apps/web/wrangler.jsonc");

/** Quita comentarios JSONC (bloque y línea) para poder parsear el objeto real. */
function parseJsonc(text: string): { vars?: Record<string, unknown> } {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const noLine = noBlock.replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(noLine) as { vars?: Record<string, unknown> };
}

describe("deployment safety: wrangler.jsonc base config (fail-closed)", () => {
  const config = parseJsonc(readFileSync(WRANGLER, "utf8"));
  const vars = config.vars ?? {};

  it("la config base NO declara IUSIA_ENV en vars", () => {
    expect("IUSIA_ENV" in vars).toBe(false);
  });

  it("en particular NO fija IUSIA_ENV=development (fail-open)", () => {
    expect(vars.IUSIA_ENV).not.toBe("development");
  });

  it("la config base NO acopla APP_URL a localhost", () => {
    const appUrl = vars.APP_URL;
    if (appUrl !== undefined) {
      expect(String(appUrl)).not.toMatch(/localhost/i);
    } else {
      expect(appUrl).toBeUndefined(); // preferido: APP_URL se suministra por entorno
    }
  });
});
