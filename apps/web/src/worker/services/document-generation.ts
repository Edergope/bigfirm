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
export interface GenerationResult {
  docx: { drive_file_id: string; name: string; document_id: string };
  pdf: { drive_file_id: string; name: string; document_id: string };
  template_id: string;
  template_version: number;
}

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
    values: Record<string, string>;
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
    if (template.engine !== "GOOGLE_DOCS" || !template.sourceRef) {
      // El MVP renderiza con Google Docs; una plantilla sin doc fuente no es usable.
      throw new DocumentGenerationError("TEMPLATE_NOT_FOUND");
    }

    // Valida y resuelve las variables requeridas contra los valores del agente.
    const variables = (template.variables ?? []).map((v) => ({
      key: v.key,
      label: v.label,
      required: v.required,
      type: "text" as const,
    }));
    let values: Record<string, string>;
    try {
      values = resolveTemplateValues({ variables }, input.values);
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
      await drive.docsReplaceText(nativeId, values);
      // 3. Exportar y persistir DOCX + PDF (Google hace el render).
      const docxBytes = await drive.exportFile(nativeId, EXPORT_MIME.docx);
      const pdfBytes = await drive.exportFile(nativeId, EXPORT_MIME.pdf);
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
    };
  }
}
