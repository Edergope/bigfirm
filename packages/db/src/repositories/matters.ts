import { and, desc, eq, isNull, inArray, ne } from "drizzle-orm";
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

  /**
   * Alta idempotente por convocatoria.
   *
   * `creationRequestKey` es la identidad de UNA acción humana. El doble clic, el
   * reintento de red y el re-submit tras una respuesta incierta comparten clave y
   * devuelven el MISMO expediente en lugar de abrir otro. Sin esto, tres pulsaciones
   * produjeron IUS-2026-011, 012 y 013 con el mismo contrato dentro.
   */
  async createIdempotent(
    organizationId: string,
    userId: string,
    input: CreateMatterInput,
    reference: string,
    creationRequestKey: string,
  ): Promise<{ matterId: string; created: boolean }> {
    const existing = await this.findByCreationRequestKey(organizationId, creationRequestKey);
    if (existing) return { matterId: existing.id, created: false };

    try {
      const matterId = await this.create(
        organizationId,
        userId,
        input,
        reference,
        this.scopedRequestKey(organizationId, creationRequestKey),
      );
      return { matterId, created: true };
    } catch (error) {
      // Carrera entre dos envíos simultáneos con la misma clave: gana el índice único
      // y el perdedor recupera el expediente del ganador. Nunca se crea un segundo.
      const winner = await this.findByCreationRequestKey(organizationId, creationRequestKey);
      if (winner) return { matterId: winner.id, created: false };
      throw error;
    }
  }

  /**
   * La clave se almacena SIEMPRE prefijada por organización. El índice único es
   * global, así que sin el prefijo una firma podría —por colisión o por copiar la
   * clave— bloquear o alcanzar el alta de otra. Una clave de convocatoria no es una
   * credencial: fuera de su organización simplemente no significa nada.
   */
  private scopedRequestKey(organizationId: string, creationRequestKey: string): string {
    return `${organizationId}:${creationRequestKey}`;
  }

  async findByCreationRequestKey(organizationId: string, creationRequestKey: string) {
    const [row] = await this.db
      .select()
      .from(matters)
      .where(
        and(
          eq(matters.organizationId, organizationId),
          eq(matters.creationRequestKey, this.scopedRequestKey(organizationId, creationRequestKey)),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** Expedientes de la organización para el chequeo determinista de duplicados. */
  async listForDuplicateCheck(organizationId: string, limit = 500) {
    return this.db
      .select({
        id: matters.id,
        reference: matters.reference,
        title: matters.title,
        clientName: matters.clientName,
        status: matters.status,
        createdAt: matters.createdAt,
      })
      .from(matters)
      .where(eq(matters.organizationId, organizationId))
      .orderBy(desc(matters.createdAt))
      .limit(limit);
  }

  async create(
    organizationId: string,
    userId: string,
    input: CreateMatterInput,
    reference: string,
    creationRequestKey?: string | null,
  ): Promise<string> {
    const id = newId("matter");
    const now = new Date().toISOString();
    await this.db.insert(matters).values({
      id,
      creationRequestKey: creationRequestKey ?? null,
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

  /**
   * Establece el único abogado líder activo. D1 ejecuta el lote de forma atómica:
   * cualquier OWNER previo pasa a COLLABORATOR y el nuevo queda OWNER.
   */
  async assignLead(
    organizationId: string,
    matterId: string,
    userId: string,
    grantedBy: string,
  ): Promise<{ previousOwnerIds: string[] }> {
    const previous = await this.db
      .select({ userId: matterMembers.userId })
      .from(matterMembers)
      .where(
        and(
          eq(matterMembers.organizationId, organizationId),
          eq(matterMembers.matterId, matterId),
          eq(matterMembers.role, "OWNER"),
          isNull(matterMembers.revokedAt),
        ),
      );
    const now = new Date().toISOString();
    await this.db.batch([
      this.db
        .update(matterMembers)
        .set({ role: "COLLABORATOR", grantedAt: now, grantedBy })
        .where(
          and(
            eq(matterMembers.organizationId, organizationId),
            eq(matterMembers.matterId, matterId),
            eq(matterMembers.role, "OWNER"),
            ne(matterMembers.userId, userId),
            isNull(matterMembers.revokedAt),
          ),
        ),
      this.db
        .insert(matterMembers)
        .values({
          id: crypto.randomUUID(),
          organizationId,
          matterId,
          userId,
          role: "OWNER",
          delegatedByUserId: null,
          grantedBy,
          grantedAt: now,
          revokedAt: null,
        })
        .onConflictDoUpdate({
          target: [matterMembers.matterId, matterMembers.userId],
          set: { role: "OWNER", revokedAt: null, grantedAt: now, grantedBy },
        }),
    ]);
    return { previousOwnerIds: previous.map((row) => row.userId).filter((id) => id !== userId) };
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
