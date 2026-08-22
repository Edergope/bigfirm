import type { RequestContext } from "../context.js";

/**
 * IUSIA Intelligence (fundación).
 *
 * NO es un chatbot: es un conjunto de tools read-only sobre datos estructurados.
 * La base aporta verdad estructurada; la interpretación (que vendrá de un agente
 * de Legal BI) se construye encima. Toda lectura respeta el alcance del usuario:
 * un abogado ve sus matters; la dirección ve la firma, y ese acceso se audita.
 */
export class IntelligenceService {
  constructor(
    private readonly ctx: RequestContext,
    private readonly organizationId: string,
  ) {}

  /**
   * Resuelve el alcance de matters: null = toda la firma (sólo dirección, auditado);
   * si no, la lista de matters del usuario.
   */
  private async scope(userId: string, firmWide: boolean): Promise<string[] | null> {
    if (firmWide) return null;
    return this.ctx.tasks.scopeForUser(this.organizationId, userId);
  }

  /** Salud de casos: conteo por estado dentro del alcance. */
  async caseHealth(userId: string, firmWide: boolean) {
    const matters = await this.ctx.matters.listForUser(this.organizationId, userId, {
      includeAll: firmWide,
    });
    const byStatus: Record<string, number> = {};
    let atRisk = 0;
    for (const m of matters) {
      byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
      if ((m.riskLevel === "HIGH" || m.riskLevel === "CRITICAL") && m.riskRationale) atRisk += 1;
    }
    return { total: matters.length, by_status: byStatus, at_risk: atRisk };
  }

  async overdueTasks(userId: string, firmWide: boolean) {
    const scope = await this.scope(userId, firmWide);
    const rows = await this.ctx.tasks.overdue(this.organizationId, scope);
    return rows.map((t) => ({
      task_id: t.id,
      matter_id: t.matterId,
      title: t.title,
      due_at: t.dueAt,
      kind: t.kind,
    }));
  }

  async upcomingDeadlines(userId: string, firmWide: boolean, days = 15) {
    const scope = await this.scope(userId, firmWide);
    const until = new Date(Date.now() + days * 86_400_000).toISOString();
    const rows = await this.ctx.tasks.upcoming(this.organizationId, scope, until);
    return rows.map((t) => ({
      task_id: t.id,
      matter_id: t.matterId,
      title: t.title,
      due_at: t.dueAt,
      rule: t.deadlineRule,
      source: t.deadlineSource,
    }));
  }

  /** Carga del equipo (sólo dirección: es visión transversal). */
  async workload() {
    const rows = await this.ctx.tasks.workloadByAssignee(this.organizationId);
    return rows.map((r) => ({ user_id: r.assignedTo, open_tasks: Number(r.openTasks) }));
  }

  /** Riesgos de casos con metodología registrada (nunca riesgo ficticio). */
  async caseRisks(userId: string, firmWide: boolean) {
    const matters = await this.ctx.matters.listForUser(this.organizationId, userId, {
      includeAll: firmWide,
    });
    return matters
      .filter((m) => m.riskLevel !== "UNASSESSED" && m.riskRationale)
      .map((m) => ({
        matter_id: m.id,
        title: m.title,
        risk_level: m.riskLevel,
        rationale: m.riskRationale,
      }));
  }

  /** Matters sin actividad reciente (por updated_at). */
  async inactiveMatters(userId: string, firmWide: boolean, days = 30) {
    const matters = await this.ctx.matters.listForUser(this.organizationId, userId, {
      includeAll: firmWide,
    });
    const threshold = Date.now() - days * 86_400_000;
    return matters
      .filter((m) => {
        if (m.status === "CLOSED" || m.status === "ARCHIVED") return false;
        return new Date(m.updatedAt).getTime() < threshold;
      })
      .map((m) => ({ matter_id: m.id, title: m.title, updated_at: m.updatedAt }));
  }
}
