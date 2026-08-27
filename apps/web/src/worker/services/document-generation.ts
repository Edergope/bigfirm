import {
  EXPORT_MIME,
  documentErrorMessage,
  generatedFileName,
  resolveTemplateValues,
  TemplateValidationError,
} from "@iusia/domain";
import { DocumentRepository, TemplateRepository, createDb } from "@iusia/db";
import type { Env } from "../env.js";
import { DriveWorkspaceService } from "./drive-workspace.js";
import { DriveCredentialResolver } from "./drive-credentials.js";
import { DriveApiError } from "../integrations/google-drive.js";

const TRANSIENT_DRIVE_KINDS = new Set(["network", "rate_limited", "http_5xx"]);

/** Retry acotado para operaciones idempotentes de Drive/Docs exclusivamente. */
export async function retryTransientDrive<T>(
  operation: () => Promise<T>,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  const attempts = Math.max(1, Math.min(opts.attempts ?? 3, 3));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = error instanceof DriveApiError && TRANSIENT_DRIVE_KINDS.has(error.kind);
      if (!retryable || attempt === attempts) throw error;
      const delay = (opts.delayMs ?? 120) * attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/**
 * Generación documental — separación estricta contenido / presentación / render.
 *
 *   AGENTE            → contenido jurídico estructurado (valores de las variables)
 *   PLANTILLA         → estructura editorial (Google Doc oficial con {{variables}})
 *   GOOGLE DOCS/DRIVE → render (copy + batchUpdate + export DOCX/PDF)
 *   DRIVE             → persistencia en "02 Documentos generados por IUSIA"
 *
 * No se le pide al LLM que "maquete un Word": el documento lo compone Google a
 * partir de la plantilla y los valores. Google hace el render; IUSIA no construye
 * infraestructura de render dentro de Workers.
 */
export interface DraftProvenance {
  agent_id: string;
  provider: string;
  model: string;
  prompt_sha256: string;
}

export interface GenerationResult {
  docx: { drive_file_id: string; name: string; document_id: string };
  pdf: { drive_file_id: string; name: string; document_id: string };
  template_id: string;
  template_version: number;
  /** Presente cuando el contenido lo redactó un agente (no valores del cliente). */
  draft?: DraftProvenance;
}

export interface GenerationTemplateVariable {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
}

/** Resolvedor de contenido: recibe las variables de la plantilla y devuelve sus valores. */
export type ValueResolver = (
  variables: GenerationTemplateVariable[],
) => Promise<{ values: Record<string, string>; provenance?: DraftProvenance }>;

export class DocumentGenerationError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? documentErrorMessage(code));
    this.name = "DocumentGenerationError";
  }
}

export class DocumentGenerationService {
  constructor(
    private readonly env: Env,
    private readonly driveCredentials: DriveCredentialResolver,
    private readonly workspace: DriveWorkspaceService,
  ) {}

  static forEnv(env: Env): DocumentGenerationService {
    return new DocumentGenerationService(
      env,
      DriveCredentialResolver.forEnv(env),
      DriveWorkspaceService.forEnv(env),
    );
  }

  /**
   * Genera un entregable oficial: DOCX + PDF en la carpeta del expediente, con
   * metadata y provenance. `values` es el contenido ya estructurado por el agente;
   * este servicio no lo interpreta, sólo lo inserta en la plantilla.
   */
  async generate(input: {
    userId: string;
    organizationId: string;
    matter: { id: string; reference: string; title: string };
    documentType: string;
    /** Valores provistos por el cliente (redacción manual). Prioridad sobre `resolveValues`. */
    values?: Record<string, string>;
    /** Cuando no hay `values`, IUSIA redacta el contenido con este resolvedor (agente 08). */
    resolveValues?: ValueResolver;
    executionId?: string;
  }): Promise<GenerationResult> {
    const db = createDb(this.env.DB);
    const templatesRepo = new TemplateRepository(db);
    const documentsRepo = new DocumentRepository(db);

    const template = await templatesRepo.findByDocumentType(
      input.organizationId,
      input.documentType,
    );
    if (!template) throw new DocumentGenerationError("TEMPLATE_NOT_FOUND");
    if (template.engine !== "GOOGLE_DOCS" || !template.sourceRef || (template.variables ?? []).length === 0) {
      // El MVP renderiza con Google Docs; una plantilla sin doc fuente no es usable.
      throw new DocumentGenerationError("TEMPLATE_NOT_RENDERABLE");
    }

    // Valida y resuelve las variables requeridas contra los valores del agente.
    const variables = (template.variables ?? []).map((v) => ({
      key: v.key,
      label: v.label,
      required: v.required,
      placeholder: v.placeholder,
      type: "text" as const,
    }));

    // Origen del contenido: valores explícitos del cliente, o redacción del agente 08.
    let rawValues: Record<string, string>;
    let draftProvenance: DraftProvenance | undefined;
    if (input.values && Object.keys(input.values).length > 0) {
      rawValues = input.values;
    } else if (input.resolveValues) {
      const resolved = await input.resolveValues(
        variables.map((v) => ({ key: v.key, label: v.label, required: v.required })),
      );
      rawValues = resolved.values;
      draftProvenance = resolved.provenance;
    } else {
      throw new DocumentGenerationError("TEMPLATE_VALIDATION_FAILED", "No hay contenido para el documento.");
    }

    let values: Record<string, string>;
    try {
      values = resolveTemplateValues({ variables }, rawValues);
    } catch (error) {
      if (error instanceof TemplateValidationError) {
        throw new DocumentGenerationError("TEMPLATE_VALIDATION_FAILED", error.message);
      }
      throw error;
    }

    const drive = await this.driveCredentials.resolveAdapter(input.userId, { requireWrite: true });
    const { generated } = await this.workspace.ensureMatterFolders(
      input.userId,
      input.organizationId,
      input.matter,
    );

    const now = new Date();
    const baseName = generatedFileName({
      reference: input.matter.reference,
      documentType: input.documentType,
      date: now,
      version: template.version,
      extension: "docx",
    }).replace(/\.docx$/, "");

    let docxMeta: { provider_file_id: string; name: string };
    let pdfMeta: { provider_file_id: string; name: string };
    try {
      // 1. Copiar la plantilla Google Docs a un doc nativo editable (el master).
      const nativeId = await drive.copyFile(template.sourceRef, `${baseName} (editable)`, generated);
      // 2. Poblar variables con Docs API batchUpdate.
      // Repetir replaceAllText es idempotente: tras el primer éxito ya no quedan
      // placeholders, por lo que una respuesta perdida no duplica contenido.
      const replacements = Object.fromEntries(
        variables.flatMap((variable) => {
          const value = values[variable.key];
          return value === undefined ? [] : [[variable.placeholder ?? variable.key, value]];
        }),
      );
      await retryTransientDrive(() => drive.docsReplaceText(nativeId, replacements));
      const renderedText = await retryTransientDrive(() => drive.docsText(nativeId));
      assertRenderedTemplate(renderedText, variables);
      // 3. Exportar y persistir DOCX + PDF (Google hace el render).
      // Exportar es read-only e idempotente. Los uploads NO se reintentan aquí:
      // hacerlo a ciegas podría crear dos entregables en Drive.
      const docxBytes = await retryTransientDrive(() => drive.exportFile(nativeId, EXPORT_MIME.docx));
      const pdfBytes = await retryTransientDrive(() => drive.exportFile(nativeId, EXPORT_MIME.pdf));
      docxMeta = await drive.uploadFile({
        name: `${baseName}.docx`,
        parentId: generated,
        mimeType: EXPORT_MIME.docx,
        content: docxBytes,
      });
      pdfMeta = await drive.uploadFile({
        name: `${baseName}.pdf`,
        parentId: generated,
        mimeType: EXPORT_MIME.pdf,
        content: pdfBytes,
      });
    } catch (error) {
      throw new DocumentGenerationError(
        "DOCUMENT_GENERATION_FAILED",
        error instanceof Error ? error.message : undefined,
      );
    }

    // 4. Registrar los entregables como documentos del expediente.
    const docxDocId = await documentsRepo.link({
      organizationId: input.organizationId,
      matterId: input.matter.id,
      driveFileId: docxMeta.provider_file_id,
      name: docxMeta.name,
      mimeType: EXPORT_MIME.docx,
      classification: "ENTREGABLE",
      linkedBy: input.userId,
    });
    const pdfDocId = await documentsRepo.link({
      organizationId: input.organizationId,
      matterId: input.matter.id,
      driveFileId: pdfMeta.provider_file_id,
      name: pdfMeta.name,
      mimeType: EXPORT_MIME.pdf,
      classification: "ENTREGABLE",
      linkedBy: input.userId,
    });

    return {
      docx: { drive_file_id: docxMeta.provider_file_id, name: docxMeta.name, document_id: docxDocId },
      pdf: { drive_file_id: pdfMeta.provider_file_id, name: pdfMeta.name, document_id: pdfDocId },
      template_id: template.id,
      template_version: template.version,
      draft: draftProvenance,
    };
  }
}

/** Falla cerrada: nunca se exporta un borrador con tokens o instrucciones editoriales. */
export function assertRenderedTemplate(text: string, variables: readonly GenerationTemplateVariable[]): void {
  const residualKnown = variables.map((v) => v.placeholder ?? `{{${v.key}}}`).filter((token) => text.includes(token));
  const residualGeneric = text.match(/\{\{[^}]+\}\}|\$\{[^}]+\}|\[[^\]\r\n]{2,240}\]/g) ?? [];
  if (residualKnown.length || residualGeneric.length) {
    throw new DocumentGenerationError("TEMPLATE_VALIDATION_FAILED", "La plantilla conserva campos o instrucciones sin completar.");
  }
}
