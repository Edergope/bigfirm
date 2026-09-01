/**
 * Identidad funcional de un expediente: cuándo dos altas describen el MISMO asunto.
 *
 * Es distinto de la idempotencia técnica. La idempotencia impide que un reintento
 * cree dos expedientes; esto impide que una persona, horas o días después, vuelva a
 * abrir en silencio un asunto que la firma ya tiene abierto.
 *
 * DETERMINISTA por decisión: ningún modelo participa. Un LLM que decide si dos casos
 * son el mismo es un LLM que puede fusionar los expedientes de dos clientes.
 */

/** Formas societarias colombianas frecuentes; su presencia no distingue un asunto. */
const CORPORATE_SUFFIXES = [
  "sas",
  "sa",
  "s a s",
  "s a",
  "ltda",
  "limitada",
  "sca",
  "scs",
  "eu",
  "esp",
  "bic",
  "en liquidacion",
  "sucursal colombia",
];

/**
 * Normaliza un nombre para comparación: sin acentos, sin puntuación, sin formas
 * societarias, en minúsculas y con espacios colapsados.
 *
 * `Distribuciones Caribe S.A.S.` y `DISTRIBUCIONES CARIBE SAS` son la misma parte.
 */
export function normalizeMatterIdentity(value: string): string {
  const base = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (base.length === 0) return "";
  // Quita formas societarias como palabras completas, estén donde estén.
  const words = base.split(" ");
  const kept: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const two = `${words[i]} ${words[i + 1] ?? ""}`.trim();
    const three = `${two} ${words[i + 2] ?? ""}`.trim();
    if (CORPORATE_SUFFIXES.includes(three)) {
      i += 2;
      continue;
    }
    if (CORPORATE_SUFFIXES.includes(two)) {
      i += 1;
      continue;
    }
    if (CORPORATE_SUFFIXES.includes(words[i]!)) continue;
    kept.push(words[i]!);
  }
  return kept.join(" ").trim();
}

/** Huella comparable de un asunto dentro de una organización. */
export function matterIdentityFingerprint(input: {
  title: string;
  clientName: string;
}): string {
  return `${normalizeMatterIdentity(input.clientName)}::${normalizeMatterIdentity(input.title)}`;
}

export interface DuplicateCandidateInput {
  title: string;
  clientName: string;
  practiceAreas?: readonly string[];
}

export interface ExistingMatterForMatch {
  id: string;
  reference: string;
  title: string;
  clientName: string;
  status: string;
  createdAt: string;
  practiceAreas?: readonly string[] | null;
}

export interface DuplicateCandidate {
  matter_id: string;
  reference: string;
  title: string;
  client_name: string;
  created_at: string;
  /** Por qué se considera candidato. Se muestra al abogado, no se infiere. */
  reason: "SAME_CLIENT_AND_SUBJECT";
}

/** Un expediente cerrado o archivado no compite por ser "el mismo asunto abierto". */
const CLOSED_STATUSES = new Set(["CERRADO", "CLOSED", "ARCHIVED", "ARCHIVADO"]);

/**
 * Candidato de ALTA confianza: misma parte representada Y mismo asunto, dentro de la
 * misma organización. Deliberadamente estrecho — es mejor no avisar que bloquear un
 * alta legítima con una coincidencia difusa.
 *
 * El aislamiento multitenant NO se resuelve aquí: `existing` sólo puede contener
 * expedientes que el servidor ya acotó a la organización del actor.
 */
export function findDuplicateCandidate(
  input: DuplicateCandidateInput,
  existing: readonly ExistingMatterForMatch[],
): DuplicateCandidate | null {
  const client = normalizeMatterIdentity(input.clientName);
  const title = normalizeMatterIdentity(input.title);
  if (client.length === 0 || title.length === 0) return null;

  const match = existing.find(
    (m) =>
      !CLOSED_STATUSES.has(m.status) &&
      normalizeMatterIdentity(m.clientName) === client &&
      normalizeMatterIdentity(m.title) === title,
  );
  if (!match) return null;

  return {
    matter_id: match.id,
    reference: match.reference,
    title: match.title,
    client_name: match.clientName,
    created_at: match.createdAt,
    reason: "SAME_CLIENT_AND_SUBJECT",
  };
}
