import {
  StorageNotConfiguredError,
  type Template,
  type TemplateEngineAdapter,
} from "@iusia/domain";

/**
 * Adapters de generación documental.
 *
 * Estado: ADAPTER listo, config externa pendiente.
 *  - GoogleDocsTemplateAdapter: requiere OAuth de Google Docs/Drive.
 *  - DocxtemplaterAdapter: requiere la librería docxtemplater y un .docx base en R2.
 *
 * Ninguno inventa un documento: sin configuración, `status()` es NOT_CONFIGURED y
 * `generate` lanza. La sustitución de variables ya se valida en el dominio.
 */

export class GoogleDocsTemplateAdapter implements TemplateEngineAdapter {
  readonly engine = "GOOGLE_DOCS" as const;
  constructor(private readonly accessToken: string | null) {}

  status() {
    return this.accessToken ? ("CONNECTED" as const) : ("NOT_CONFIGURED" as const);
  }

  async generate(input: {
    template: Template;
    values: Record<string, string>;
    target_name: string;
  }): Promise<{ generated_ref: string }> {
    if (!this.accessToken) throw new StorageNotConfiguredError("google-docs");
    // Flujo real (cuando haya OAuth): Drive files.copy del source_ref → Docs
    // batchUpdate con replaceAllText por cada variable → devolver el nuevo doc id.
    // Preserva formato y no manipula OOXML a mano (Blueprint §26).
    void input;
    throw new StorageNotConfiguredError("google-docs");
  }
}

export class DocxtemplaterAdapter implements TemplateEngineAdapter {
  readonly engine = "DOCXTEMPLATER" as const;
  constructor(private readonly available: boolean) {}

  status() {
    return this.available ? ("CONNECTED" as const) : ("NOT_CONFIGURED" as const);
  }

  async generate(input: {
    template: Template;
    values: Record<string, string>;
    target_name: string;
  }): Promise<{ generated_ref: string }> {
    void input;
    // Flujo real: cargar el .docx base desde R2 (template.source_ref), instanciar
    // Docxtemplater, setData(values), render, escribir el resultado en R2.
    throw new StorageNotConfiguredError("docxtemplater");
  }
}
