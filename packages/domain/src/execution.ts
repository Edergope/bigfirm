import { z } from "zod";
import { ExecutionId, MatterId, OrganizationId, UserId } from "./ids.js";

/**
 * Execution Ledger — fuente neutral de verdad de lo que REALMENTE ocurrió.
 *
 * Regla crítica del proyecto: nunca presentar como ejecución multiagente lo que
 * ocurrió dentro de una sola llamada monolítica. Cada ejecución real tiene
 * identidad propia, registro propio y aparece aquí.
 */

export const EXECUTION_STATUSES = [
  "PENDING",
  "RUNNING",
  "WAITING",
  "BLOCKED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export const ExecutionStatus = z.enum(EXECUTION_STATUSES);
export type ExecutionStatus = z.infer<typeof ExecutionStatus>;

export const TERMINAL_STATUSES: readonly ExecutionStatus[] = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
];

/** Transiciones permitidas. Una ejecución no puede "saltar" a COMPLETED. */
const ALLOWED_TRANSITIONS: Record<ExecutionStatus, readonly ExecutionStatus[]> = {
  PENDING: ["RUNNING", "CANCELLED", "FAILED"],
  RUNNING: ["WAITING", "BLOCKED", "COMPLETED", "FAILED", "CANCELLED"],
  WAITING: ["RUNNING", "BLOCKED", "FAILED", "CANCELLED"],
  BLOCKED: ["RUNNING", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransition(from: ExecutionStatus, to: ExecutionStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export const TokenUsage = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cached_input_tokens: z.number().int().nonnegative().default(0),
});
export type TokenUsage = z.infer<typeof TokenUsage>;

export const ExecutionRecord = z.object({
  execution_id: ExecutionId,
  organization_id: OrganizationId,
  matter_id: MatterId,
  agent_id: z.string().min(1),
  parent_execution_id: ExecutionId.nullable(),
  /** Instancia de Cloudflare Workflow que gobierna el DAG, si aplica. */
  workflow_instance_id: z.string().nullable(),

  status: ExecutionStatus,

  provider: z.string().nullable(),
  model: z.string().nullable(),
  /** Versión de prompt efectivamente ejecutada; permite replay fiel. */
  prompt_version: z.string().nullable(),
  prompt_sha256: z.string().nullable(),

  work_package_ref: z.string().nullable(),
  output_ref: z.string().nullable(),
  output_type: z.string().nullable(),

  token_usage: TokenUsage.nullable(),
  provider_cost_usd: z.number().nonnegative().nullable(),
  credits_consumed: z.number().nonnegative().nullable(),

  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  retries: z.number().int().nonnegative().default(0),

  started_by: UserId.nullable(),
  started_at: z.string().datetime().nullable(),
  completed_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
});
export type ExecutionRecord = z.infer<typeof ExecutionRecord>;

/**
 * Contrato de salida común (envelope). Cada agente añade su schema específico;
 * no se fuerza un único schema universal para los 30 agentes (Blueprint §05).
 * Los enums replican `repo/schemas/agent_output_contract.schema.json`.
 */
export const OUTPUT_STATUSES = [
  "COMPLETED",
  "READY_WITH_RESERVATIONS",
  "BLOCKED",
  "REMEDIATED",
] as const;
export const OutputStatus = z.enum(OUTPUT_STATUSES);

export const OUTPUT_TYPES = [
  "INTAKE",
  "EVIDENTIARY",
  "RESEARCH",
  "PROCEDURAL",
  "SPECIALIST_DICTAMEN",
  "STRATEGY",
  "RED_TEAM",
  "CITATION_AUDIT",
  "FINAL_DELIVERABLE",
] as const;
export const OutputType = z.enum(OUTPUT_TYPES);
export type OutputType = z.infer<typeof OutputType>;

export const ExecutionEnvelope = z.object({
  matter_id: MatterId,
  agent_id: z.string().min(1),
  execution_id: ExecutionId,
  output_type: OutputType,
  status: OutputStatus,
  /** Payload específico del agente, validado contra su propio schema. */
  payload: z.unknown(),
  unknowns: z
    .array(z.object({ unknown_id: z.string(), description: z.string() }))
    .default([]),
  provenance: z.object({
    produced_by: z.string(),
    execution_id: ExecutionId,
    prompt_sha256: z.string(),
    model: z.string(),
    provider: z.string(),
    produced_at: z.string().datetime(),
  }),
});
export type ExecutionEnvelope = z.infer<typeof ExecutionEnvelope>;
