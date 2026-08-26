import { z } from "zod";

/**
 * Dominio de plantillas y generación documental.
 *
 * IUSIA NO construye un procesador de texto (Blueprint §26). Las plantillas se
 * materializan vía adapters: Google Docs (copy + batchUpdate) o Docxtemplater para
 * DOCX. Las reglas de generación y el registro de plantillas SÍ son propiedad de IUSIA.
 */

export const TEMPLATE_SCOPES = ["SYSTEM", "ORGANIZATION"] as const;
export const TemplateScope = z.enum(TEMPLATE_SCOPES);
export type TemplateScope = z.infer<typeof TemplateScope>;

export const TEMPLATE_ENGINES = ["GOOGLE_DOCS", "DOCXTEMPLATER"] as const;
export const TemplateEngine = z.enum(TEMPLATE_ENGINES);
export type TemplateEngine = z.infer<typeof TemplateEngine>;

export const TemplateVariable = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, "clave snake_case"),
  label: z.string().min(1),
  required: z.boolean().default(true),
  /** Token literal en la plantilla oficial (p.ej. `[CLIENTE]`). Ausente ⇒ `{{key}}`. */
  placeholder: z.string().min(1).optional(),
  /** Tipo lógico para validación de entrada. */
  type: z.enum(["text", "number", "date", "currency"]).default("text"),
});
export type TemplateVariable = z.infer<typeof TemplateVariable>;

export const Template = z.object({
  id: z.string().min(1),
  organization_id: z.string().nullable(), // null ⇒ plantilla de sistema
  scope: TemplateScope,
  name: z.string().min(1),
  practice_area: z.string().nullable(),
  jurisdiction: z.string().nullable(),
  engine: TemplateEngine,
  /** Referencia al artefacto base (Google Doc id o clave R2 del .docx). */
  source_ref: z.string().min(1),
  variables: z.array(TemplateVariable),
  version: z.string().min(1),
  status: z.enum(["DRAFT", "APPROVED", "RETIRED"]),
});
export type Template = z.infer<typeof Template>;

export class TemplateValidationError extends Error {
  constructor(
    message: string,
    readonly missing: string[],
  ) {
    super(message);
    this.name = "TemplateValidationError";
  }
}

/**
 * Valida que los valores provistos cubran las variables requeridas de la plantilla.
 * Devuelve el mapa de sustitución saneado. NUNCA ejecuta el contenido como código.
 */
export function resolveTemplateValues(
  template: Pick<Template, "variables">,
  provided: Record<string, unknown>,
): Record<string, string> {
  const missing: string[] = [];
  const resolved: Record<string, string> = {};
  for (const variable of template.variables) {
    const raw = provided[variable.key];
    if (raw === undefined || raw === null || raw === "") {
      if (variable.required) missing.push(variable.key);
      continue;
    }
    resolved[variable.key] = String(raw);
  }
  if (missing.length > 0) {
    throw new TemplateValidationError(
      `Faltan variables requeridas: ${missing.join(", ")}`,
      missing,
    );
  }
  return resolved;
}

/**
 * Port de generación documental. Implementado por adapters de Google Docs / Docxtemplater.
 * `status()` NOT_CONFIGURED cuando el proveedor no está aprovisionado.
 */
export interface TemplateEngineAdapter {
  readonly engine: TemplateEngine;
  status(): "CONNECTED" | "NOT_CONFIGURED";
  /** Genera un documento; devuelve una referencia (Google Doc id o clave R2). */
  generate(input: {
    template: Template;
    values: Record<string, string>;
    target_name: string;
  }): Promise<{ generated_ref: string }>;
}
