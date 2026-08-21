import { z } from "zod";
import { MatterId } from "./ids.js";

/**
 * Fact Ledger y Authority Ledger.
 *
 * Los enums NO se inventan aquí: replican los contratos canónicos ya existentes en
 * `repo/schemas/canonical_fact_ledger.schema.json` y `repo/schemas/authority_ledger.schema.json`,
 * que son la fuente jurídica de verdad. Cambiar un valor aquí sin cambiarlo allá
 * rompe la compatibilidad con los 30 prompts canónicos.
 */

/** Notación canónica de certeza usada por los agentes en sus prompts. */
export const CERTAINTY_CODES = ["[F]", "[A]", "[D]", "[I]", "[C]", "[U]", "[R]", "[X]"] as const;
export const Certainty = z.enum(CERTAINTY_CODES);
export type Certainty = z.infer<typeof Certainty>;

/** Etiquetas legibles para UI. La UI nunca muestra el código crudo sin texto. */
export const CERTAINTY_LABELS: Record<Certainty, string> = {
  "[F]": "Hecho acreditado",
  "[A]": "Alegado por parte",
  "[D]": "Documental",
  "[I]": "Inferido",
  "[C]": "Contradicho",
  "[U]": "No verificado",
  "[R]": "Referido por tercero",
  "[X]": "Descartado",
};

export const SOURCE_CLASSES = [
  "Class A",
  "Class B",
  "Class C",
  "Class D",
  "Class E",
  "Class F",
] as const;
export const SourceClass = z.enum(SOURCE_CLASSES);

export const FactNumber = z.object({
  raw_text: z.string(),
  value: z.number(),
  unit: z.string(),
});

export const CanonicalFact = z.object({
  fact_id: z.string().min(1),
  statement: z.string().min(1),
  certainty: Certainty,
  source_class: SourceClass,
  primary_source: z.string().min(1),
  numbers: z.array(FactNumber).default([]),
});
export type CanonicalFact = z.infer<typeof CanonicalFact>;

export const FactLedgerEntity = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  role: z.string().min(1),
  aliases: z.array(z.string()).default([]),
});

export const CanonicalFactLedger = z.object({
  matter_id: MatterId,
  date_established: z.string(),
  governance_version: z.string(),
  entities: z.array(FactLedgerEntity).default([]),
  facts: z.array(CanonicalFact).default([]),
});
export type CanonicalFactLedger = z.infer<typeof CanonicalFactLedger>;

export const AUTHORITY_TYPES = [
  "CONSTITUTION",
  "STATUTE",
  "DECREE",
  "RESOLUTION",
  "CIRCULAR",
  "JURISPRUDENCE",
  "DOCTRINE",
] as const;
export const AuthorityType = z.enum(AUTHORITY_TYPES);

export const AUTHORITY_STATUSES = [
  "VERIFIED_CURRENT",
  "SUPERSEDED",
  "REQUIRES_CALIBRATION",
] as const;
export const AuthorityStatus = z.enum(AUTHORITY_STATUSES);

export const Authority = z.object({
  authority_id: z.string().min(1),
  citation: z.string().min(1),
  type: AuthorityType,
  status: AuthorityStatus,
  rule_summary: z.string().min(1),
});
export type Authority = z.infer<typeof Authority>;

export const AuthorityLedger = z.object({
  matter_id: MatterId,
  authorities: z.array(Authority).default([]),
});
export type AuthorityLedger = z.infer<typeof AuthorityLedger>;
