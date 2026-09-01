import { and, desc, eq, isNull } from "drizzle-orm";
import { newId } from "@iusia/domain";
import type { IusiaDb } from "../client.js";
import { documents, documentVersions } from "../schema/iusia.js";

/**
 * Metadata documental. El archivo del usuario vive en Google Drive; IUSIA guarda
 * la referencia, la clasificación jurídica y el estado de revisión.
 * No se duplica Drive.
 */
/**
 * Origen verificable de un entregable generado por IUSIA. Se persiste en la fila del
 * documento para que la trazabilidad no dependa de recorrer `audit_events`.
 */
export interface DocumentProvenance {
  /** AGENT (lo redactó el agente canónico) | MANUAL (valores del abogado). */
  contentSource: "AGENT" | "MANUAL";
  templateId: string;
  templateVersion: number;
  executionId?: string | null;
  agentId?: string | null;
  promptSha256?: string | null;
  model?: string | null;
  /** Tarea del expediente que originó el borrador, si nació de una. */
  originTaskId?: string | null;
}

export class DocumentRepository {
  constructor(private readonly db: IusiaDb) {}

  async link(input: {
    organizationId: string;
    matterId: string;
    driveFileId: string;
    name: string;
    mimeType: string;
    classification?: string;
    linkedBy: string;
    sizeBytes?: number | null;
    checksum?: string | null;
    ingestionStatus?: string;
    /** Provenance del entregable cuando el documento lo generó IUSIA. */
    provenance?: DocumentProvenance | null;
  }): Promise<string> {
    const id = newId("document");
    const now = new Date().toISOString();
    // Idempotente por (matterId, driveFileId): un re-link del MISMO archivo no crea un
    // segundo documento lógico. `returning()` distingue inserción real de conflicto;
    // en conflicto se devuelve el id del documento YA existente (nunca un id fantasma
    // no persistido, que dejaría al caller apuntando a una fila inexistente).
    const inserted = await this.db
      .insert(documents)
      .values({
        id,
        organizationId: input.organizationId,
        matterId: input.matterId,
        source: "DRIVE",
        driveFileId: input.driveFileId,
        name: input.name,
        mimeType: input.mimeType,
        classification: input.classification ?? "FUENTE",
        status: "PENDIENTE",
        contentHash: null,
        r2MirrorKey: null,
        indexedAt: null,
        currentVersion: 1,
        sizeBytes: input.sizeBytes ?? null,
        ingestionStatus: input.ingestionStatus ?? "FILE_STORED",
        contentSource: input.provenance?.contentSource ?? null,
        generatedFromTemplateId: input.provenance?.templateId ?? null,
        generatedFromTemplateVersion: input.provenance?.templateVersion ?? null,
        generatedByExecutionId: input.provenance?.executionId ?? null,
        generatedByAgentId: input.provenance?.agentId ?? null,
        generatedPromptSha256: input.provenance?.promptSha256 ?? null,
        generatedModel: input.provenance?.model ?? null,
      originTaskId: input.provenance?.originTaskId ?? null,
        linkedBy: input.linkedBy,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: documents.id });

    if (inserted[0]) {
      await this.db.insert(documentVersions).values({
        id: newId("documentVersion"),
        organizationId: input.organizationId,
        matterId: input.matterId,
        documentId: inserted[0].id,
        versionNumber: 1,
        driveFileId: input.driveFileId,
        filename: input.name,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes ?? null,
        checksum: input.checksum ?? null,
        createdBy: input.linkedBy,
        createdAt: now,
        changeType: "ORIGINAL",
        changeSummary: "Versión inicial",
        ingestionStatus: input.ingestionStatus ?? "FILE_STORED",
        isCurrent: true,
      });
      return inserted[0].id;
    }

    // Conflicto de unicidad: recupera el documento existente para esa clave.
    const [existing] = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.matterId, input.matterId),
          eq(documents.driveFileId, input.driveFileId),
        ),
      )
      .limit(1);
    if (!existing) throw new Error("link: conflicto sin documento existente resoluble");
    return existing.id;
  }

  /**
   * Documento VIGENTE del expediente cuyo binario coincide exactamente con un
   * checksum. Es lo que impide que un reintento técnico de la subida incorpore dos
   * veces el mismo archivo: el contenido, no el nombre ni el id del proveedor, es lo
   * que decide si ya está.
   */
  async findByChecksum(organizationId: string, matterId: string, checksum: string) {
    const [row] = await this.db
      .select({
        documentId: documentVersions.documentId,
        filename: documentVersions.filename,
        ingestionStatus: documents.ingestionStatus,
      })
      .from(documentVersions)
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .where(
        and(
          eq(documentVersions.organizationId, organizationId),
          eq(documentVersions.matterId, matterId),
          eq(documentVersions.checksum, checksum),
          isNull(documents.retiredAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async listForMatter(organizationId: string, matterId: string) {
    return this.db
      .select()
      .from(documents)
      .where(and(eq(documents.organizationId, organizationId), eq(documents.matterId, matterId), isNull(documents.retiredAt)))
      .orderBy(desc(documents.updatedAt));
  }

  async findById(organizationId: string, documentId: string) {
    const [row] = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)))
      .limit(1);
    return row ?? null;
  }

  async listVersions(organizationId: string, documentId: string) {
    return this.db
      .select()
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.organizationId, organizationId),
          eq(documentVersions.documentId, documentId),
        ),
      )
      .orderBy(desc(documentVersions.versionNumber));
  }

  async findVersion(organizationId: string, documentId: string, versionNumber?: number) {
    const clauses = [
      eq(documentVersions.organizationId, organizationId),
      eq(documentVersions.documentId, documentId),
      versionNumber === undefined
        ? eq(documentVersions.isCurrent, true)
        : eq(documentVersions.versionNumber, versionNumber),
    ];
    const [row] = await this.db
      .select()
      .from(documentVersions)
      .where(and(...clauses))
      .limit(1);
    return row ?? null;
  }

  /** Añade una versión sin sobrescribir la anterior; el número se resuelve en servidor. */
  async addVersion(input: {
    organizationId: string;
    matterId: string;
    documentId: string;
    driveFileId: string;
    filename: string;
    mimeType: string;
    sizeBytes?: number | null;
    checksum?: string | null;
    createdBy: string;
    changeType: string;
    changeSummary: string;
    ingestionStatus?: string;
  }) {
    const document = await this.findById(input.organizationId, input.documentId);
    if (!document || document.matterId !== input.matterId || document.retiredAt) return null;

    const nextVersion = document.currentVersion + 1;
    const now = new Date().toISOString();
    const versionId = newId("documentVersion");
    await this.db.batch([
      this.db
        .update(documentVersions)
        .set({ isCurrent: false })
        .where(
          and(
            eq(documentVersions.organizationId, input.organizationId),
            eq(documentVersions.documentId, input.documentId),
            eq(documentVersions.isCurrent, true),
          ),
        ),
      this.db.insert(documentVersions).values({
        id: versionId,
        organizationId: input.organizationId,
        matterId: input.matterId,
        documentId: input.documentId,
        versionNumber: nextVersion,
        driveFileId: input.driveFileId,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes ?? null,
        checksum: input.checksum ?? null,
        createdBy: input.createdBy,
        createdAt: now,
        changeType: input.changeType,
        changeSummary: input.changeSummary,
        ingestionStatus: input.ingestionStatus ?? "FILE_STORED",
        isCurrent: true,
      }),
      this.db
        .update(documents)
        .set({
          driveFileId: input.driveFileId,
          name: input.filename,
          mimeType: input.mimeType,
          currentVersion: nextVersion,
          sizeBytes: input.sizeBytes ?? null,
          contentHash: input.checksum ?? null,
          r2MirrorKey: null,
          indexedAt: null,
          ingestionStatus: input.ingestionStatus ?? "FILE_STORED",
          linkedBy: input.createdBy,
          updatedAt: now,
        })
        .where(
          and(eq(documents.organizationId, input.organizationId), eq(documents.id, input.documentId)),
        ),
    ]);
    return { versionId, versionNumber: nextVersion };
  }

  async setStatus(organizationId: string, documentId: string, status: string) {
    await this.db
      .update(documents)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)));
  }

  /** Retiro lógico durable. No borra el binario, espejo ni versiones auditables. */
  async retire(input: { organizationId: string; documentId: string; retiredBy: string; reason?: string }) {
    const now = new Date().toISOString();
    const result = await this.db.update(documents).set({
      status: "RETIRADO",
      retiredAt: now,
      retiredBy: input.retiredBy,
      retiredReason: input.reason?.trim() || null,
      updatedAt: now,
    }).where(and(eq(documents.organizationId, input.organizationId), eq(documents.id, input.documentId), isNull(documents.retiredAt))).returning({ id: documents.id });
    return result[0] ?? null;
  }

  /** Marca un documento como indexado tras escribir su espejo normalizado en R2. */
  async markIndexed(
    organizationId: string,
    documentId: string,
    r2MirrorKey: string,
    contentHash: string,
  ) {
    const now = new Date().toISOString();
    await this.db
      .update(documents)
      .set({
        r2MirrorKey,
        contentHash,
        indexedAt: now,
        // `status` es el ciclo de revisión JURÍDICA y no lo mueve un hecho técnico:
        // indexar un documento no significa que un abogado lo haya revisado. Pisarlo
        // aquí era el origen del «En revisión» que confundía a un documento indexado.
        ingestionStatus: "AI_INDEXED",
        updatedAt: now,
      })
      .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)));
    await this.db
      .update(documentVersions)
      // El checksum de la versión es el hash del binario original y es inmutable.
      // `contentHash` corresponde al Markdown normalizado y vive en `documents`.
      .set({ ingestionStatus: "AI_INDEXED" })
      .where(
        and(
          eq(documentVersions.organizationId, organizationId),
          eq(documentVersions.documentId, documentId),
          eq(documentVersions.isCurrent, true),
        ),
      );
  }

  async markIngestionFailed(organizationId: string, documentId: string) {
    const now = new Date().toISOString();
    await this.db
      .update(documents)
      .set({
        ingestionStatus: "ERROR",
        updatedAt: now,
      })
      .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)));
    await this.db
      .update(documentVersions)
      .set({ ingestionStatus: "ERROR" })
      .where(
        and(
          eq(documentVersions.organizationId, organizationId),
          eq(documentVersions.documentId, documentId),
          eq(documentVersions.isCurrent, true),
        ),
      );
  }
}
