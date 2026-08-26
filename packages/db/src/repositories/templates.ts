import { and, desc, eq, max, or } from "drizzle-orm";
import { newId } from "@iusia/domain";
import type { IusiaDb } from "../client.js";
import { templates } from "../schema/iusia.js";

/**
 * Plantillas documentales. La fuente de verdad del contenido/versión es esta tabla;
 * el archivo operativo de Google Docs se referencia por `sourceRef`. Un archivo
 * generado nunca es source of truth.
 */
export class TemplateRepository {
  constructor(private readonly db: IusiaDb) {}

  /** Plantillas visibles para una firma: institucionales (SYSTEM) + propias. */
  async listForOrganization(organizationId: string) {
    return this.db
      .select()
      .from(templates)
      .where(
        and(
          eq(templates.status, "ACTIVE"),
          or(eq(templates.scope, "SYSTEM"), eq(templates.organizationId, organizationId)),
        ),
      )
      .orderBy(desc(templates.updatedAt));
  }

  async findById(id: string) {
    const rows = await this.db.select().from(templates).where(eq(templates.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async findVisibleById(organizationId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(templates)
      .where(
        and(
          eq(templates.id, id),
          or(eq(templates.scope, "SYSTEM"), eq(templates.organizationId, organizationId)),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** Catálogo completo para la autoridad de sistema, incluido historial y retiradas. */
  async listSystemHistory() {
    return this.db
      .select()
      .from(templates)
      .where(eq(templates.scope, "SYSTEM"))
      .orderBy(desc(templates.updatedAt));
  }

  async createSystemVersion(input: {
    familyId?: string;
    name: string;
    documentType: string;
    category: string;
    description?: string | null;
    sourceRef: string;
    originalSourceRef: string;
    mimeType: string;
    checksum: string;
    originalFilename: string;
    variables: Array<{ key: string; label: string; required: boolean; placeholder?: string }>;
    createdBy: string;
    activate?: boolean;
  }) {
    const familyId = input.familyId || newId("template");
    const [latest] = await this.db
      .select({ version: max(templates.version) })
      .from(templates)
      .where(eq(templates.familyId, familyId));
    const version = (latest?.version ?? 0) + 1;
    const id = newId("template");
    const now = new Date().toISOString();

    if (input.activate !== false) {
      await this.db
        .update(templates)
        .set({ status: "INACTIVE", updatedAt: now })
        .where(and(eq(templates.familyId, familyId), eq(templates.status, "ACTIVE")));
    }
    await this.db.insert(templates).values({
      id,
      familyId,
      scope: "SYSTEM",
      organizationId: null,
      name: input.name,
      documentType: input.documentType,
      version,
      status: input.activate === false ? "INACTIVE" : "ACTIVE",
      engine: "GOOGLE_DOCS",
      sourceRef: input.sourceRef,
      originalSourceRef: input.originalSourceRef,
      category: input.category,
      description: input.description ?? null,
      mimeType: input.mimeType,
      checksum: input.checksum,
      originalFilename: input.originalFilename,
      variables: input.variables,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    });
    return { id, familyId, version };
  }

  async setSystemStatus(id: string, status: "ACTIVE" | "INACTIVE" | "RETIRED") {
    const row = await this.findById(id);
    if (!row || row.scope !== "SYSTEM") return null;
    const now = new Date().toISOString();
    if (status === "ACTIVE") {
      await this.db
        .update(templates)
        .set({ status: "INACTIVE", updatedAt: now })
        .where(and(eq(templates.familyId, row.familyId), eq(templates.status, "ACTIVE")));
    }
    await this.db.update(templates).set({ status, updatedAt: now }).where(eq(templates.id, id));
    return { ...row, status };
  }

  /**
   * Mejor plantilla ACTIVE para un tipo documental, con acceso de la firma. Prefiere
   * la propia de la organización sobre la institucional, y la versión más alta.
   */
  async findByDocumentType(organizationId: string, documentType: string) {
    const rows = await this.db
      .select()
      .from(templates)
      .where(
        and(
          eq(templates.status, "ACTIVE"),
          eq(templates.documentType, documentType),
          or(eq(templates.scope, "SYSTEM"), eq(templates.organizationId, organizationId)),
        ),
      );
    if (rows.length === 0) return null;
    return rows.sort((a, b) => {
      const own = (r: (typeof rows)[number]) => (r.organizationId === organizationId ? 1 : 0);
      return own(b) - own(a) || b.version - a.version;
    })[0]!;
  }

  /** Alta/actualización idempotente de una plantilla del catálogo institucional. */
  async upsertSystem(input: {
    id: string;
    name: string;
    documentType: string;
    version: number;
    engine: string;
    sourceRef: string | null;
    variables: Array<{ key: string; label: string; required: boolean; placeholder?: string }>;
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .insert(templates)
      .values({
        id: input.id,
        familyId: input.id,
        scope: "SYSTEM",
        organizationId: null,
        name: input.name,
        documentType: input.documentType,
        version: input.version,
        status: "ACTIVE",
        engine: input.engine,
        sourceRef: input.sourceRef,
        variables: input.variables,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: templates.id,
        set: {
          name: input.name,
          version: input.version,
          engine: input.engine,
          sourceRef: input.sourceRef,
          variables: input.variables,
          updatedAt: now,
        },
      });
  }

  async count(): Promise<number> {
    const rows = await this.db.select({ id: templates.id }).from(templates);
    return rows.length;
  }
}
