import { and, desc, eq } from "drizzle-orm";
import { newId } from "@iusia/domain";
import type { IusiaDb } from "../client.js";
import { documents } from "../schema/iusia.js";

/**
 * Metadata documental. El archivo del usuario vive en Google Drive; IUSIA guarda
 * la referencia, la clasificación jurídica y el estado de revisión.
 * No se duplica Drive.
 */
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
  }): Promise<string> {
    const id = newId("document");
    const now = new Date().toISOString();
    await this.db
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
        linkedBy: input.linkedBy,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    return id;
  }

  async listForMatter(organizationId: string, matterId: string) {
    return this.db
      .select()
      .from(documents)
      .where(and(eq(documents.organizationId, organizationId), eq(documents.matterId, matterId)))
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

  async setStatus(organizationId: string, documentId: string, status: string) {
    await this.db
      .update(documents)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)));
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
      .set({ r2MirrorKey, contentHash, indexedAt: now, status: "EN_REVISION", updatedAt: now })
      .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)));
  }
}
