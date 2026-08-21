import { z } from "zod";
import { MatterId, OrganizationId, UserId } from "./ids.js";

/**
 * Modelo jurídico de Matter. Un Matter NO es una carpeta de documentos:
 * es el expediente con partes, jurisdicción, materialidad, riesgo y equipo.
 */

export const MATTER_STATUSES = [
  "INTAKE",
  "ACTIVE",
  "WAITING_CLIENT",
  "IN_REVIEW",
  "ON_HOLD",
  "CLOSED",
  "ARCHIVED",
] as const;
export const MatterStatus = z.enum(MATTER_STATUSES);
export type MatterStatus = z.infer<typeof MatterStatus>;

/**
 * Materialidad. Determina el routing del DAG (cuántos agentes se ejecutan).
 * No es una etiqueta cosmética: gobierna gates obligatorios.
 */
export const MATERIALITY_LEVELS = ["SIMPLE", "MATERIAL", "HIGH_STAKES"] as const;
export const Materiality = z.enum(MATERIALITY_LEVELS);
export type Materiality = z.infer<typeof Materiality>;

export const PRACTICE_AREAS = [
  "CIVIL",
  "COMERCIAL_CONTRACTUAL",
  "SOCIETARIO_MA",
  "LABORAL",
  "TRIBUTARIO",
  "PENAL_ECONOMICO",
  "ADMINISTRATIVO",
  "CONSTITUCIONAL",
  "FAMILIA",
  "INMOBILIARIO",
  "PROPIEDAD_INTELECTUAL",
  "INSOLVENCIA",
  "MIGRATORIO",
  "FINANCIERO",
  "COMPLIANCE",
  "OTRO",
] as const;
export const PracticeArea = z.enum(PRACTICE_AREAS);
export type PracticeArea = z.infer<typeof PracticeArea>;

export const PARTY_KINDS = [
  "CLIENT",
  "COUNTERPARTY",
  "THIRD_PARTY",
  "AUTHORITY",
  "COUNSEL",
] as const;
export const PartyKind = z.enum(PARTY_KINDS);

export const MatterParty = z.object({
  kind: PartyKind,
  name: z.string().min(1).max(300),
  identification: z.string().max(100).optional(),
  role_note: z.string().max(500).optional(),
});
export type MatterParty = z.infer<typeof MatterParty>;

/**
 * Nivel de riesgo cualitativo. El Design System (§06) prohíbe porcentajes
 * sin metodología: en MVP sólo niveles explicables + justificación textual.
 */
export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL", "UNASSESSED"] as const;
export const RiskLevel = z.enum(RISK_LEVELS);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const Matter = z.object({
  id: MatterId,
  organization_id: OrganizationId,
  reference: z.string().min(1).max(50),
  title: z.string().min(1).max(300),
  client_name: z.string().min(1).max(300),
  status: MatterStatus,
  materiality: Materiality,
  practice_areas: z.array(PracticeArea).min(1),
  jurisdiction: z.string().min(1).max(120),
  parties: z.array(MatterParty).default([]),
  objective: z.string().max(4000).nullable(),
  risk_level: RiskLevel,
  /** Obligatorio cuando risk_level != UNASSESSED: sin metodología no se muestra riesgo. */
  risk_rationale: z.string().max(2000).nullable(),
  opened_at: z.string().datetime(),
  closed_at: z.string().datetime().nullable(),
  created_by: UserId,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Matter = z.infer<typeof Matter>;

export const CreateMatterInput = Matter.pick({
  title: true,
  client_name: true,
  materiality: true,
  practice_areas: true,
  jurisdiction: true,
}).extend({
  reference: z.string().min(1).max(50).optional(),
  objective: z.string().max(4000).optional(),
  parties: z.array(MatterParty).max(50).optional(),
});
export type CreateMatterInput = z.infer<typeof CreateMatterInput>;

/** Un indicador de riesgo sin justificación es "riesgo ficticio" (Design System §06). */
export function assertRiskIsExplainable(
  level: RiskLevel,
  rationale: string | null,
): void {
  if (level !== "UNASSESSED" && (!rationale || rationale.trim().length === 0)) {
    throw new Error(
      "risk_level requiere risk_rationale: no se muestran indicadores de riesgo sin metodología",
    );
  }
}
