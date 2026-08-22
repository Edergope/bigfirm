import { z } from "zod";
import { MatterId } from "./ids.js";
import { RiskLevel } from "./matter.js";

/**
 * Case Brief — vista estructurada del expediente, NO un resumen libre.
 *
 * Es regenerable y trazable: cada sección se compone de datos estructurados del
 * Matter (hechos, autoridades, ejecuciones, tareas). El Design System §06 fija la
 * jerarquía: qué pasa / qué debo hacer / qué sabemos / qué recomienda IUSIA / qué ocurrió.
 */

export const BriefFact = z.object({
  fact_id: z.string(),
  statement: z.string(),
  certainty: z.string(),
  primary_source: z.string(),
});

export const BriefAuthority = z.object({
  authority_id: z.string(),
  citation: z.string(),
  type: z.string(),
  status: z.string(),
});

export const BriefDeadline = z.object({
  task_id: z.string(),
  title: z.string(),
  due_at: z.string().nullable(),
  rule: z.string().nullable(),
  source: z.string().nullable(),
});

export const CaseBrief = z.object({
  matter_id: MatterId,
  generated_at: z.string().datetime(),
  /** Qué pasa. */
  objective: z.string().nullable(),
  matter_type: z.array(z.string()),
  status: z.string(),
  materiality: z.string(),
  parties: z.array(z.object({ kind: z.string(), name: z.string() })),
  risk: z.object({ level: RiskLevel, rationale: z.string().nullable() }),
  /** Qué sabemos. */
  facts: z.array(BriefFact),
  authorities: z.array(BriefAuthority),
  document_count: z.number().int().nonnegative(),
  /** Qué debo hacer. */
  deadlines: z.array(BriefDeadline),
  open_task_count: z.number().int().nonnegative(),
  /** Qué recomienda IUSIA: cuántas ejecuciones y su estado agregado. */
  ai_executions: z.object({
    total: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  /** Preguntas abiertas derivadas de hechos no verificados. */
  open_questions: z.array(z.string()),
  /** Fuentes que respaldan el brief (documentos + autoridades verificadas). */
  sources: z.array(z.string()),
});
export type CaseBrief = z.infer<typeof CaseBrief>;
