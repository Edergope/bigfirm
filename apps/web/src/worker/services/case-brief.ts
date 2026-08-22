import type { CaseBrief, RiskLevel } from "@iusia/domain";
import type { RequestContext } from "../context.js";

/**
 * Compone el Case Brief a partir de datos estructurados del expediente.
 * Regenerable y trazable: no inventa nada, sólo proyecta lo que existe en los
 * ledgers y el registro documental.
 */
export async function buildCaseBrief(
  ctx: RequestContext,
  organizationId: string,
  matterId: string,
): Promise<CaseBrief> {
  const matter = await ctx.matters.findById(organizationId, matterId);
  if (!matter) throw new Error("matter no encontrado");

  const [facts, authorities, docs, execs, tasks] = await Promise.all([
    ctx.facts.listForMatter(organizationId, matterId),
    ctx.authorities.listForMatter(organizationId, matterId),
    ctx.documents.listForMatter(organizationId, matterId),
    ctx.executions.listByMatter(organizationId, matterId, 200),
    ctx.tasks.listForMatter(organizationId, matterId),
  ]);

  // Preguntas abiertas = hechos no verificados o contradichos.
  const openQuestions = facts
    .filter((f) => f.certainty === "[U]" || f.certainty === "[C]")
    .map((f) => `¿Verificar? ${f.statement}`);

  const nodeExecs = execs.filter((e) => e.parentExecutionId !== null);

  const sources = [
    ...docs.map((d) => `documento:${d.name}`),
    ...authorities.filter((a) => a.status === "VERIFIED_CURRENT").map((a) => `autoridad:${a.citation}`),
  ];

  return {
    matter_id: matterId,
    generated_at: new Date().toISOString(),
    objective: matter.objective,
    matter_type: matter.practiceAreas,
    status: matter.status,
    materiality: matter.materiality,
    parties: (matter.parties as Array<{ kind: string; name: string }>).map((p) => ({
      kind: p.kind,
      name: p.name,
    })),
    risk: { level: matter.riskLevel as RiskLevel, rationale: matter.riskRationale },
    facts: facts.map((f) => ({
      fact_id: f.factKey,
      statement: f.statement,
      certainty: f.certainty,
      primary_source: f.primarySource,
    })),
    authorities: authorities.map((a) => ({
      authority_id: a.authorityKey,
      citation: a.citation,
      type: a.type,
      status: a.status,
    })),
    document_count: docs.length,
    deadlines: tasks
      .filter((t) => t.kind === "PROCEDURAL_DEADLINE" || t.dueAt !== null)
      .map((t) => ({
        task_id: t.id,
        title: t.title,
        due_at: t.dueAt,
        rule: t.deadlineRule,
        source: t.deadlineSource,
      })),
    open_task_count: tasks.filter(
      (t) => t.status !== "COMPLETADA" && t.status !== "CANCELADA",
    ).length,
    ai_executions: {
      total: nodeExecs.length,
      completed: nodeExecs.filter((e) => e.status === "COMPLETED").length,
      failed: nodeExecs.filter((e) => e.status === "FAILED").length,
    },
    open_questions: openQuestions,
    sources,
  };
}
