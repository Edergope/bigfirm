import { and, asc, desc, eq, isNotNull, lt, gte, inArray, sql } from "drizzle-orm";
import { newId } from "@iusia/domain";
import type { IusiaDb } from "../client.js";
import { tasks, matterMembers } from "../schema/iusia.js";

export interface CreateTaskInput {
  organizationId: string;
  matterId: string;
  title: string;
  description?: string | null;
  kind?: "TASK" | "PROCEDURAL_DEADLINE" | "HEARING";
  dueAt?: string | null;
  deadlineRule?: string | null;
  deadlineSource?: string | null;
  assignedTo?: string | null;
  createdBy: string;
}

export class TaskRepository {
  constructor(private readonly db: IusiaDb) {}

  async create(input: CreateTaskInput): Promise<string> {
    const id = newId("task");
    const now = new Date().toISOString();
    await this.db.insert(tasks).values({
      id,
      organizationId: input.organizationId,
      matterId: input.matterId,
      title: input.title,
      description: input.description ?? null,
      kind: input.kind ?? "TASK",
      status: "PENDIENTE",
      dueAt: input.dueAt ?? null,
      deadlineRule: input.deadlineRule ?? null,
      deadlineSource: input.deadlineSource ?? null,
      assignedTo: input.assignedTo ?? null,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  async listForMatter(organizationId: string, matterId: string) {
    return this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.organizationId, organizationId), eq(tasks.matterId, matterId)))
      .orderBy(asc(tasks.dueAt));
  }

  async findById(organizationId: string, taskId: string) {
    const [row] = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.organizationId, organizationId), eq(tasks.id, taskId)))
      .limit(1);
    return row ?? null;
  }

  async setStatus(organizationId: string, taskId: string, status: string) {
    await this.db
      .update(tasks)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(and(eq(tasks.organizationId, organizationId), eq(tasks.id, taskId)));
  }

  /** Ids de matters en los que un usuario es miembro activo. Base del alcance. */
  private async userMatterIds(organizationId: string, userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ matterId: matterMembers.matterId })
      .from(matterMembers)
      .where(
        and(
          eq(matterMembers.organizationId, organizationId),
          eq(matterMembers.userId, userId),
        ),
      );
    return rows.map((r) => r.matterId);
  }

  /**
   * Tareas vencidas dentro del alcance. Si `scopeMatterIds` es null, cubre toda la
   * firma (uso de dirección, ya autorizado y auditado por el caller).
   */
  async overdue(
    organizationId: string,
    scopeMatterIds: readonly string[] | null,
    nowIso = new Date().toISOString(),
  ) {
    const base = and(
      eq(tasks.organizationId, organizationId),
      isNotNull(tasks.dueAt),
      lt(tasks.dueAt, nowIso),
      sql`${tasks.status} NOT IN ('COMPLETADA','CANCELADA')`,
    );
    const where =
      scopeMatterIds === null
        ? base
        : scopeMatterIds.length === 0
          ? sql`0 = 1`
          : and(base, inArray(tasks.matterId, scopeMatterIds));
    return this.db.select().from(tasks).where(where).orderBy(asc(tasks.dueAt));
  }

  /** Términos/tareas próximos entre ahora y `untilIso`. */
  async upcoming(
    organizationId: string,
    scopeMatterIds: readonly string[] | null,
    untilIso: string,
    nowIso = new Date().toISOString(),
  ) {
    const base = and(
      eq(tasks.organizationId, organizationId),
      isNotNull(tasks.dueAt),
      gte(tasks.dueAt, nowIso),
      lt(tasks.dueAt, untilIso),
      sql`${tasks.status} NOT IN ('COMPLETADA','CANCELADA')`,
    );
    const where =
      scopeMatterIds === null
        ? base
        : scopeMatterIds.length === 0
          ? sql`0 = 1`
          : and(base, inArray(tasks.matterId, scopeMatterIds));
    return this.db.select().from(tasks).where(where).orderBy(asc(tasks.dueAt));
  }

  /** Carga (conteo de tareas abiertas) por usuario asignado, en la firma. */
  async workloadByAssignee(organizationId: string) {
    return this.db
      .select({
        assignedTo: tasks.assignedTo,
        openTasks: sql<number>`count(*)`,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.organizationId, organizationId),
          isNotNull(tasks.assignedTo),
          sql`${tasks.status} NOT IN ('COMPLETADA','CANCELADA')`,
        ),
      )
      .groupBy(tasks.assignedTo)
      .orderBy(desc(sql`count(*)`));
  }

  scopeForUser(organizationId: string, userId: string): Promise<string[]> {
    return this.userMatterIds(organizationId, userId);
  }
}
