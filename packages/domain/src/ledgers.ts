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

// ────────────────── Extracción de ledgers desde salidas de agente ──────────────────

/**
 * Extrae hechos y autoridades ESTRUCTURADOS de la salida de un agente.
 *
 * Regla no negociable: sólo se persiste lo que llega como objeto válido contra el
 * contrato canónico. La prosa libre del modelo NUNCA se convierte en un hecho del
 * expediente: un elemento que no valide se descarta en silencio, no se "repara".
 *
 * El schema de salida de los agentes no es estable (los arreglos pueden venir en la
 * raíz o anidados bajo `payload`/`output`/`result`), así que la búsqueda es por clave
 * conocida en profundidad acotada, igual que hace `deriveConclusionText`.
 */
const FACT_ARRAY_KEYS = ["facts", "fact_ledger", "canonical_facts", "hechos"] as const;
const AUTHORITY_ARRAY_KEYS = ["authorities", "authority_ledger", "autoridades"] as const;

export interface ExtractedLedgers {
  facts: CanonicalFact[];
  authorities: Authority[];
  /** Elementos presentes pero descartados por no cumplir el contrato canónico. */
  rejected: number;
}

export function extractLedgerEntries(text: string): ExtractedLedgers {
  const root = parseJsonObject(text);
  if (!root) return { facts: [], authorities: [], rejected: 0 };

  let rejected = 0;
  const facts = new Map<string, CanonicalFact>();
  const authorities = new Map<string, Authority>();

  for (const raw of collectArrays(root, FACT_ARRAY_KEYS)) {
    const parsed = CanonicalFact.safeParse(raw);
    if (parsed.success) facts.set(parsed.data.fact_id, parsed.data);
    else rejected += 1;
  }
  for (const raw of collectArrays(root, AUTHORITY_ARRAY_KEYS)) {
    const parsed = Authority.safeParse(raw);
    if (parsed.success) authorities.set(parsed.data.authority_id, parsed.data);
    else rejected += 1;
  }

  return { facts: [...facts.values()], authorities: [...authorities.values()], rejected };
}

/** Recolecta los elementos de todo arreglo alcanzable bajo alguna de las claves dadas. */
function collectArrays(
  node: unknown,
  keys: readonly string[],
  depth = 5,
): unknown[] {
  if (depth < 0 || node === null || typeof node !== "object") return [];
  const out: unknown[] = [];
  if (Array.isArray(node)) {
    for (const el of node) out.push(...collectArrays(el, keys, depth - 1));
    return out;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (keys.includes(key) && Array.isArray(value)) out.push(...value);
    else out.push(...collectArrays(value, keys, depth - 1));
  }
  return out;
}

/** Recorta y parsea el primer objeto JSON balanceado del texto. Tolera prosa y fences. */
function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
