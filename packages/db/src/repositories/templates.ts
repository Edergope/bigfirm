import { and, desc, eq, or } from "drizzle-orm";
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
    variables: Array<{ key: string; label: string; required: boolean }>;
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .insert(templates)
      .values({
        id: input.id,
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
