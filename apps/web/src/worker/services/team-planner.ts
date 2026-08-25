import {
  IusiaError,
  ORCHESTRATION_LIMITS,
  validateTeamPlan,
  type PlanValidationError,
  type TeamPlan,
} from "@iusia/domain";
import type { AgentCatalogEntry } from "@iusia/agents";
import { PLANNER_SYSTEM_PROMPT } from "../orchestration/planner-prompt.js";
import type { ModelMessage } from "./model-gateway.js";

/**
 * Planner del Managing Partner (fase 00 PLAN).
 *
 * Propone un TeamPlan (modelo) → el servidor lo VALIDA → si es inválido, 1 intento de
 * reparación → si sigue inválido, SAFE_FALLBACK determinista. El scope (org/matter),
 * modelo, proveedor y tools SIEMPRE los pone el servidor, nunca el plan.
 */

export type PlanSource = "llm" | "repair" | "fallback";

export interface MatterBrief {
  title: string;
  materiality: string;
  jurisdiction: string;
  practice_areas: readonly string[];
  document_summary: readonly string[];
}

/** Runner de modelo inyectable: recibe mensajes y devuelve el texto crudo. */
export type PlannerModelRunner = (messages: ModelMessage[]) => Promise<string>;

export interface PlanTeamArgs {
  objective: string;
  brief: MatterBrief;
  catalog: readonly AgentCatalogEntry[];
  eligible: ReadonlySet<string>;
  runModel: PlannerModelRunner;
  /** Fallback determinista (buildFallbackTeamPlan cableado por el workflow). */
  fallback: () => TeamPlan;
  limits?: typeof ORCHESTRATION_LIMITS;
}

export interface PlanTeamResult {
  plan: TeamPlan;
  source: PlanSource;
  validation_errors: PlanValidationError[];
}

/** Extrae el primer objeto JSON de una respuesta (tolera fences ```json). */
export function extractJsonObject(raw: string): unknown {
  const text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1]!.trim() : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function buildPlannerMessages(args: PlanTeamArgs): ModelMessage[] {
  const brief = [
    `<matter_brief>`,
    `titulo: ${args.brief.title}`,
    `materialidad: ${args.brief.materiality}`,
    `jurisdiccion: ${args.brief.jurisdiction}`,
    `areas_practica: ${args.brief.practice_areas.join(", ") || "(no especificadas)"}`,
    `documentos:`,
    ...args.brief.document_summary.map((d) => `- ${d}`),
    `</matter_brief>`,
  ].join("\n");
  const catalog = `<agent_catalog>\n${JSON.stringify(args.catalog, null, 2)}\n</agent_catalog>`;
  const objective = `<objective>\n${args.objective}\n</objective>`;
  return [
    { role: "system", content: PLANNER_SYSTEM_PROMPT },
    { role: "user", content: `${brief}\n\n${catalog}\n\n${objective}\n\nDevuelve SÓLO el TeamPlan JSON.` },
  ];
}

export async function planTeam(args: PlanTeamArgs): Promise<PlanTeamResult> {
  const limits = args.limits ?? ORCHESTRATION_LIMITS;
  const messages = buildPlannerMessages(args);

  // Intento LLM.
  const raw1 = await args.runModel(messages);
  const v1 = validateTeamPlan(extractJsonObject(raw1), args.eligible, limits);
  if (v1.ok) return { plan: v1.plan, source: "llm", validation_errors: [] };

  // Reparación única con feedback estructurado de los errores.
  const repairMessages: ModelMessage[] = [
    ...messages,
    { role: "assistant", content: raw1.slice(0, 4000) },
    {
      role: "user",
      content:
        "El plan es inválido por: " +
        v1.errors.map((e) => `${e.code}(${e.detail})`).join("; ") +
        ". Devuelve SÓLO el TeamPlan JSON corregido, sin texto adicional.",
    },
  ];
  const raw2 = await args.runModel(repairMessages);
  const v2 = validateTeamPlan(extractJsonObject(raw2), args.eligible, limits);
  if (v2.ok) return { plan: v2.plan, source: "repair", validation_errors: v1.errors };

  // SAFE_FALLBACK determinista.
  const fallbackPlan = args.fallback();
  const vf = validateTeamPlan(fallbackPlan, args.eligible, limits);
  if (!vf.ok) {
    throw new IusiaError("PLAN_INVALID", "El SAFE_FALLBACK produjo un plan inválido", {
      errors: vf.errors,
    });
  }
  return { plan: vf.plan, source: "fallback", validation_errors: [...v1.errors, ...v2.errors] };
}
