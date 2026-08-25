import { z } from "zod";
import { OutputType } from "@iusia/domain";

/**
 * Metadata de agente. Describe CÓMO se ejecuta un agente,
 * nunca QUÉ dice su prompt. El conocimiento jurídico permanece en agent.md.
 */

export const ModelPolicy = z.object({
  /** Ruta lógica del AI Gateway; el dominio no conoce SDKs de proveedor. */
  route: z.string().min(1),
  /** Preferencia y fallback. El gateway resuelve la conmutación. */
  preferred: z.object({ provider: z.string(), model: z.string() }),
  fallback: z.array(z.object({ provider: z.string(), model: z.string() })).default([]),
  temperature: z.number().min(0).max(2).default(0.2),
  max_output_tokens: z.number().int().positive().default(8000),
});
export type ModelPolicy = z.infer<typeof ModelPolicy>;

export const AgentDefinition = z.object({
  /** Id canónico: coincide con el directorio en repo/agents/. */
  agent_id: z.string().min(1),
  /** Código corto del nodo en el DAG jurídico (00, 01, 03, ...). */
  node_code: z.string().min(2).max(4),
  name: z.string().min(1),
  role: z.string().min(1),
  domain: z.string().min(1),

  /** Ruta al prompt canónico dentro del repo. Fuente de la sincronización a R2. */
  prompt_source_path: z.string().min(1),
  /** Clave del artefacto desplegado en R2. */
  prompt_ref: z.string().min(1),
  prompt_version: z.string().min(1),
  /** SHA-256 del agent.md canónico. Verificado en cada carga. */
  prompt_sha256: z.string().length(64),

  enabled: z.boolean(),
  model_policy: ModelPolicy,
  tools_policy: z.array(z.string()).default([]),

  output_type: OutputType,
  output_schema_id: z.string().min(1),

  /**
   * Rol operacional del agente dentro del runtime. Se deriva de la taxonomía que ya
   * existe en el registry (`domain` + `output_type`); no inventa una taxonomía nueva.
   */
  runtime_role: z
    .enum([
      "ORCHESTRATOR",
      "CASE_INTAKE",
      "LEGAL_RESEARCH",
      "EVIDENCE_ANALYSIS",
      "PROCESS_STRATEGY",
      "LEGAL_STRATEGY",
      "LEGAL_SPECIALIST",
      "QUALITY_REVIEW",
      "DOCUMENT_DRAFTER",
      "DOCUMENT_COMPILER",
    ])
    .default("LEGAL_SPECIALIST"),

  /**
   * ¿Puede el Managing Partner (00 PLAN) seleccionarlo como ESPECIALISTA de un equipo?
   * Ser operacional (`enabled`) no implica ser seleccionable: el orquestador ejecuta
   * las fases PLAN/INTEGRATE y los roles de documento/auditoría pertenecen a etapas
   * posteriores del pipeline, no al análisis jurídico del Matter.
   */
  planner_eligible: z.boolean().default(false),

  /**
   * Frase corta y discriminativa que ve el planner para saber CUÁNDO elegir a este
   * agente. Procede de la metadata canónica (`description` del frontmatter del
   * agent.md); nunca del cuerpo del prompt. No sustituye al agent.md ni lo modifica.
   */
  specialty: z.string().min(1).max(400).default(""),

  /** Ola del DAG canónico a la que pertenece (WAVE_1..WAVE_5). */
  wave: z
    .enum([
      "WAVE_1_INTAKE_AND_RESEARCH",
      "WAVE_2_SUBSTANTIVE_SPECIALISTS",
      "WAVE_3_STRATEGY_AND_LITIGATION",
      "WAVE_4_AUDITING_AND_INTEGRITY",
      "WAVE_5_SYNTHESIS_AND_DELIVERY",
    ])
    .optional(),

  /** Agentes que deben haber terminado antes de despachar éste. */
  dependencies: z.array(z.string()).default([]),
  parallelizable: z.boolean().default(true),
  timeout_ms: z.number().int().positive().default(120_000),

  governance: z
    .object({
      /** Requiere aprobación humana antes de que su salida avance en el DAG. */
      requires_human_gate: z.boolean().default(false),
      /** Su salida puede escribir en el Fact Ledger. */
      may_write_facts: z.boolean().default(false),
      /** Su salida puede escribir en el Authority Ledger. */
      may_write_authorities: z.boolean().default(false),
    })
    .default({
      requires_human_gate: false,
      may_write_facts: false,
      may_write_authorities: false,
    }),
});
export type AgentDefinition = z.infer<typeof AgentDefinition>;
