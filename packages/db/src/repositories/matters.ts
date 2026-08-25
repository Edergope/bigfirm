import { and, desc, eq, isNull, inArray } from "drizzle-orm";
import {
  IusiaError,
  newId,
  type CreateMatterInput,
  type MatterRole,
} from "@iusia/domain";
import type { IusiaDb } from "../client.js";
import { matters, matterMembers } from "../schema/iusia.js";
import { user } from "../schema/auth.js";

export interface MatterRow {
  id: string;
  organizationId: string;
  reference: string;
  title: string;
  clientName: string;
  status: string;
  materiality: string;
  practiceAreas: string[];
  jurisdiction: string;
  riskLevel: string;
  riskRationale: string | null;
  objective: string | null;
  openedAt: string;
  updatedAt: string;
}

export class MatterRepository {
  constructor(private readonly db: IusiaDb) {}

  async create(
    organizationId: string,
    userId: string,
    input: CreateMatterInput,
    reference: string,
  ): Promise<string> {
    const id = newId("matter");
    const now = new Date().toISOString();
    await this.db.insert(matters).values({
      id,
      organizationId,
      reference,
      title: input.title,
      clientName: input.client_name,
      status: "INTAKE",
      materiality: input.materiality,
      practiceAreas: input.practice_areas,
      jurisdiction: input.jurisdiction,
      parties: input.parties ?? [],
      objective: input.objective ?? null,
      riskLevel: "UNASSESSED",
      riskRationale: null,
      openedAt: now,
      closedAt: null,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    // Quien abre el matter queda OWNER; sin esto nadie tendría acceso al caso.
    await this.addMember(organizationId, id, userId, "OWNER", userId);
    return id;
  }

  /** Siguiente referencia por organización, con formato IUS-AAAA-NNN. */
  async nextReference(organizationId: string): Promise<string> {
    const year = new Date().getUTCFullYear();
    const rows = await this.db
      .select({ reference: matters.reference })
      .from(matters)
      .where(eq(matters.organizationId, organizationId));

    const prefix = `IUS-${year}-`;
    let max = 0;
    for (const r of rows) {
      if (!r.reference.startsWith(prefix)) continue;
      const n = Number.parseInt(r.reference.slice(prefix.length), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return `${prefix}${String(max + 1).padStart(3, "0")}`;
  }

  async findById(organizationId: string, matterId: string) {
    const [row] = await this.db
      .select()
      .from(matters)
      .where(and(eq(matters.organizationId, organizationId), eq(matters.id, matterId)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Matters visibles para un usuario.
   * `includeAll` sólo debe pasarse tras verificar rol de supervisión de dirección,
   * y la llamada debe quedar auditada por el caller.
   */
  async listForUser(
    organizationId: string,
    userId: string,
    opts: { includeAll: boolean; limit?: number },
  ) {
    if (opts.includeAll) {
      return this.db
        .select()
        .from(matters)
        .where(eq(matters.organizationId, organizationId))
        .orderBy(desc(matters.updatedAt))
        .limit(opts.limit ?? 100);
    }

    const memberships = await this.db
      .select({ matterId: matterMembers.matterId })
      .from(matterMembers)
      .where(
        and(
          eq(matterMembers.organizationId, organizationId),
          eq(matterMembers.userId, userId),
          isNull(matterMembers.revokedAt),
        ),
      );

    const ids = memberships.map((m) => m.matterId);
    if (ids.length === 0) return [];

    return this.db
      .select()
      .from(matters)
      .where(and(eq(matters.organizationId, organizationId), inArray(matters.id, ids)))
      .orderBy(desc(matters.updatedAt))
      .limit(opts.limit ?? 100);
  }

  async addMember(
    organizationId: string,
    matterId: string,
    userId: string,
    role: MatterRole,
    grantedBy: string,
    delegatedByUserId?: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .insert(matterMembers)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        matterId,
        userId,
        role,
        delegatedByUserId: delegatedByUserId ?? null,
        grantedBy,
        grantedAt: now,
        revokedAt: null,
      })
      .onConflictDoUpdate({
        target: [matterMembers.matterId, matterMembers.userId],
        set: { role, revokedAt: null, grantedAt: now, grantedBy },
      });
  }

  async revokeMember(matterId: string, userId: string): Promise<void> {
    await this.db
      .update(matterMembers)
      .set({ revokedAt: new Date().toISOString() })
      .where(and(eq(matterMembers.matterId, matterId), eq(matterMembers.userId, userId)));
  }

  /** Rol del usuario en el matter, o null si no es miembro activo. */
  async roleFor(matterId: string, userId: string): Promise<MatterRole | null> {
    const [row] = await this.db
      .select({ role: matterMembers.role })
      .from(matterMembers)
      .where(
        and(
          eq(matterMembers.matterId, matterId),
          eq(matterMembers.userId, userId),
          isNull(matterMembers.revokedAt),
        ),
      )
      .limit(1);
    return (row?.role as MatterRole | undefined) ?? null;
  }

  /**
   * Miembros activos del expediente, con el nombre de la persona.
   *
   * El id de usuario no le dice a nadie quién lleva el caso: la vista mostraba
   * cadenas como `Me9nmiaFFMnJ…` donde debía haber un nombre. El id se conserva
   * porque las acciones de gestión lo necesitan, pero deja de ser lo que se lee.
   */
  async listMembers(matterId: string) {
    return this.db
      .select({
        matterId: matterMembers.matterId,
        userId: matterMembers.userId,
        role: matterMembers.role,
        delegatedByUserId: matterMembers.delegatedByUserId,
        grantedAt: matterMembers.grantedAt,
        revokedAt: matterMembers.revokedAt,
        name: user.name,
        email: user.email,
      })
      .from(matterMembers)
      .innerJoin(user, eq(matterMembers.userId, user.id))
      .where(and(eq(matterMembers.matterId, matterId), isNull(matterMembers.revokedAt)));
  }

  /** Email del OWNER activo del matter (para notificaciones), o null. */
  async ownerEmail(matterId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ email: user.email })
      .from(matterMembers)
      .innerJoin(user, eq(matterMembers.userId, user.id))
      .where(
        and(
          eq(matterMembers.matterId, matterId),
          eq(matterMembers.role, "OWNER"),
          isNull(matterMembers.revokedAt),
        ),
      )
      .limit(1);
    return row?.email ?? null;
  }

  async setRisk(
    organizationId: string,
    matterId: string,
    level: string,
    rationale: string,
  ): Promise<void> {
    if (level !== "UNASSESSED" && rationale.trim() === "") {
      throw new IusiaError(
        "VALIDATION_FAILED",
        "No se puede fijar un nivel de riesgo sin justificación metodológica",
      );
    }
    await this.db
      .update(matters)
      .set({ riskLevel: level, riskRationale: rationale, updatedAt: new Date().toISOString() })
      .where(and(eq(matters.organizationId, organizationId), eq(matters.id, matterId)));
  }

  async setStatus(organizationId: string, matterId: string, status: string) {
    await this.db
      .update(matters)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(and(eq(matters.organizationId, organizationId), eq(matters.id, matterId)));
  }
}
