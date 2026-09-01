import { z } from "zod";
import { Authority, CanonicalFact } from "./ledgers.js";
import { RISK_LEVELS } from "./matter.js";

/**
 * Structured Execution Envelope.
 *
 * PROBLEMA. Los agentes canónicos devuelven prosa jurídica. Las superficies del
 * expediente —Fact Ledger, Authority Ledger, Tareas, Riesgo— sólo aceptan estructura
 * validada, así que quedaban permanentemente vacías: el equipo trabajaba y el abogado
 * recibía un dictamen sin que nada aterrizara en el expediente.
 *
 * Había tres salidas posibles y dos eran inaceptables: modificar los 30 `agent.md`
 * canónicos (prohibido; el árbol debe permanecer en 1525d8f6…), o pasar la prosa por
 * una segunda llamada LLM que la convirtiera en hechos (fabricación de estructura
 * sobre texto jurídico, y el doble de costo por ejecución).
 *
 * SOLUCIÓN. El contrato se declara en RUNTIME, dentro del WorkPackage —que es dato de
 * ejecución, no prompt canónico—, y el agente lo cumple en LA MISMA llamada: primero
 * su análisis narrativo completo, tal y como su `agent.md` le indica, y al final un
 * bloque delimitado con la estructura. Ni un archivo canónico tocado, ni una llamada
 * de más.
 *
 * REGLA DE ORO. El envelope es una AFIRMACIÓN del modelo, no una verdad. Nada llega al
 * expediente sin superar validaciones deterministas y sin conservar procedencia: la
 * prosa nunca se convierte en hecho, y un elemento que cita una fuente que no se le
 * entregó se descarta en vez de repararse.
 */

export const ENVELOPE_VERSION = "iusia.envelope.v1";

/**
 * Delimitadores del bloque. Deliberadamente improbables en prosa jurídica y asimétricos
 * (`<<<` abre, `>>>` cierra) para que un fragmento citado del expediente no los imite.
 */
export const ENVELOPE_OPEN = "<<<IUSIA_ENVELOPE_V1";
export const ENVELOPE_CLOSE = "IUSIA_ENVELOPE_V1>>>";

/**
 * Referencia sintética del contexto declarado por el abogado. Es fuente legítima
 * —el abogado responde por ella— pero NO es prueba documental, y por eso se nombra
 * aparte de los `ref_id` de documentos.
 */
export const LAWYER_CONTEXT_REF = "LAWYER_CONTEXT";

// ─────────────────────────────── Contratos ───────────────────────────────

const SourceRefs = z.array(z.string().min(1)).default([]);

/**
 * Hecho del envelope: el contrato canónico EXACTO más la procedencia.
 *
 * `CanonicalFact` no se redefine ni se relaja: replica
 * `repo/schemas/canonical_fact_ledger.schema.json`, que es la fuente jurídica de
 * verdad. `source_refs` es metadato de runtime para el filtro de procedencia y no
 * viaja al ledger como parte del hecho.
 */
export const EnvelopeFact = CanonicalFact.extend({ source_refs: SourceRefs });
export type EnvelopeFact = z.infer<typeof EnvelopeFact>;

export const EnvelopeAuthority = Authority.extend({ source_refs: SourceRefs });
export type EnvelopeAuthority = z.infer<typeof EnvelopeAuthority>;

/** Severidades: las mismas del expediente, sin UNASSESSED (que no es una afirmación). */
export const RISK_SEVERITIES = RISK_LEVELS.filter((l) => l !== "UNASSESSED");
export const RiskSeverity = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const RISK_LIKELIHOODS = ["REMOTE", "POSSIBLE", "PROBABLE", "NEAR_CERTAIN"] as const;
export const RiskLikelihood = z.enum(RISK_LIKELIHOODS);

export const EnvelopeRisk = z.object({
  risk_id: z.string().min(1),
  description: z.string().min(1),
  severity: RiskSeverity,
  likelihood: RiskLikelihood,
  /** Por qué se califica así. Sin metodología no se muestra riesgo en el expediente. */
  rationale: z.string().min(1),
  source_refs: SourceRefs,
});
export type EnvelopeRisk = z.infer<typeof EnvelopeRisk>;

export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export const TaskPriority = z.enum(TASK_PRIORITIES);

export const EnvelopeTask = z.object({
  task_id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  priority: TaskPriority,
  source_refs: SourceRefs,
});
export type EnvelopeTask = z.infer<typeof EnvelopeTask>;

export const StructuredExecutionEnvelope = z.object({
  envelope_version: z.literal(ENVELOPE_VERSION),
  conclusion_brief: z.string().optional(),
  facts: z.array(EnvelopeFact).default([]),
  authorities: z.array(EnvelopeAuthority).default([]),
  risks: z.array(EnvelopeRisk).default([]),
  tasks: z.array(EnvelopeTask).default([]),
});
export type StructuredExecutionEnvelope = z.infer<typeof StructuredExecutionEnvelope>;

// ─────────────────────── Qué produce cada rol ───────────────────────

export const ENVELOPE_FIELDS = [
  "conclusion_brief",
  "facts",
  "authorities",
  "risks",
  "tasks",
] as const;
export type EnvelopeField = (typeof ENVELOPE_FIELDS)[number];

/**
 * Campos que se le piden a cada agente, derivados de su `runtime_role` —taxonomía que
 * YA existe en el registry— y no de una lista por `agent_id`.
 *
 * Se pide a cada rol lo que su trabajo produce de verdad: pedirle autoridades a un
 * agente de intake es invitarlo a inventarlas. Un rol desconocido recibe únicamente
 * `conclusion_brief`, que es lo que cualquier agente puede afirmar sobre su propia
 * salida.
 */
const FIELDS_BY_ROLE: Record<string, readonly EnvelopeField[]> = {
  ORCHESTRATOR: ["conclusion_brief", "risks", "tasks"],
  CASE_INTAKE: ["conclusion_brief", "facts"],
  LEGAL_RESEARCH: ["conclusion_brief", "authorities"],
  EVIDENCE_ANALYSIS: ["conclusion_brief", "facts"],
  PROCESS_STRATEGY: ["conclusion_brief", "risks", "tasks"],
  LEGAL_STRATEGY: ["conclusion_brief", "risks", "tasks"],
  LEGAL_SPECIALIST: ["conclusion_brief", "facts", "authorities", "risks"],
  QUALITY_REVIEW: ["conclusion_brief", "risks"],
  DOCUMENT_DRAFTER: ["conclusion_brief"],
  DOCUMENT_COMPILER: ["conclusion_brief"],
};

export function envelopeFieldsFor(runtimeRole: string): readonly EnvelopeField[] {
  return FIELDS_BY_ROLE[runtimeRole] ?? ["conclusion_brief"];
}

// ─────────────────────── Contrato enviado al agente ───────────────────────

const FIELD_SPEC: Record<EnvelopeField, string[]> = {
  conclusion_brief: [
    '  "conclusion_brief": "string — tu conclusión en 2-4 frases, en los términos que usarías con el abogado responsable",',
  ],
  facts: [
    '  "facts": [{',
    '    "fact_id": "string estable y único dentro de esta salida",',
    '    "statement": "string — el hecho, en una afirmación verificable",',
    '    "certainty": "[F] acreditado | [D] documental | [A] alegado por parte | [I] inferido | [C] contradicho | [U] no verificado | [R] referido por tercero | [X] descartado",',
    '    "source_class": "Class A | Class B | Class C | Class D | Class E | Class F",',
    '    "primary_source": "string — de dónde sale el hecho",',
    '    "numbers": [{ "raw_text": "string", "value": number, "unit": "string" }],',
    '    "source_refs": ["ref_id de <authorized_refs>"]',
    "  }],",
  ],
  authorities: [
    '  "authorities": [{',
    '    "authority_id": "string estable y único dentro de esta salida",',
    '    "citation": "string — la cita normativa o jurisprudencial completa",',
    '    "type": "CONSTITUTION | STATUTE | DECREE | RESOLUTION | CIRCULAR | JURISPRUDENCE | DOCTRINE",',
    '    "status": "VERIFIED_CURRENT | SUPERSEDED | REQUIRES_CALIBRATION",',
    '    "rule_summary": "string — qué regla aporta al caso",',
    '    "source_refs": ["ref_id de <authorized_refs>"]',
    "  }],",
  ],
  risks: [
    '  "risks": [{',
    '    "risk_id": "string estable y único dentro de esta salida",',
    '    "description": "string — el riesgo concreto para este expediente",',
    '    "severity": "LOW | MEDIUM | HIGH | CRITICAL",',
    '    "likelihood": "REMOTE | POSSIBLE | PROBABLE | NEAR_CERTAIN",',
    '    "rationale": "string — por qué lo calificas así",',
    '    "source_refs": ["ref_id de <authorized_refs>"]',
    "  }],",
  ],
  tasks: [
    '  "tasks": [{',
    '    "task_id": "string estable y único dentro de esta salida",',
    '    "title": "string — acción concreta, en imperativo",',
    '    "description": "string — qué hay que hacer y por qué",',
    '    "priority": "LOW | MEDIUM | HIGH | URGENT",',
    '    "source_refs": ["ref_id de <authorized_refs>"]',
    "  }],",
  ],
};

/**
 * Renderiza el contrato del envelope para incrustarlo en el WorkPackage.
 *
 * Va en el WorkPackage y NO en el `agent.md`: el prompt canónico se inyecta íntegro y
 * verificado por SHA, y este bloque viaja como dato de la ejecución. El agente conserva
 * su método, su voz y su estructura narrativa; lo único que se añade es un apéndice
 * legible por máquina.
 *
 * Las referencias autorizadas se enumeran explícitamente porque el filtro de proyección
 * es determinista: citar algo que no está en esta lista no acerca el elemento al
 * expediente, lo descarta.
 */
export function renderEnvelopeContract(args: {
  fields: readonly EnvelopeField[];
  authorizedRefs: readonly string[];
}): string {
  const fields = ENVELOPE_FIELDS.filter((f) => args.fields.includes(f));
  if (fields.length === 0) return "";

  const lines: string[] = [];
  lines.push("<output_envelope_contract>");
  lines.push(
    "Tu salida tiene DOS partes y en este orden:",
    "",
    "1. TU ANÁLISIS NARRATIVO COMPLETO, exactamente como te indica tu método. No lo",
    "   abrevies, no lo resumas y no cambies su estructura por culpa de este contrato.",
    "   Es el trabajo que lee el abogado.",
    "",
    `2. Al FINAL de todo, un único bloque delimitado por ${ENVELOPE_OPEN} y ${ENVELOPE_CLOSE}`,
    "   que contenga SÓLO un objeto JSON válido con esta forma:",
    "",
    ENVELOPE_OPEN,
    "{",
    `  "envelope_version": "${ENVELOPE_VERSION}",`,
  );
  for (const field of fields) lines.push(...FIELD_SPEC[field]);
  lines.push("}", ENVELOPE_CLOSE, "");

  lines.push(
    "REGLAS DEL BLOQUE, que se verifican de forma determinista en el servidor:",
    "- Incluye únicamente los campos enumerados arriba. Un arreglo vacío es una respuesta",
    "  legítima y preferible a rellenarlo: no completes por completar.",
    "- Cada elemento debe declarar en `source_refs` al menos una referencia de",
    "  <authorized_refs>. Un elemento que cite una referencia inexistente se DESCARTA;",
    "  inventar una cita no lo acerca al expediente, lo elimina.",
    "- El bloque no sustituye ni resume tu análisis: lo acompaña.",
    "- No escribas nada después del cierre del bloque.",
  );

  lines.push("<authorized_refs>");
  if (args.authorizedRefs.length === 0) {
    lines.push("- (ninguna: no cites fuentes en source_refs)");
  } else {
    for (const ref of args.authorizedRefs) {
      lines.push(
        ref === LAWYER_CONTEXT_REF
          ? `- ${LAWYER_CONTEXT_REF} :: contexto y hechos declarados por el abogado responsable (no es prueba documental)`
          : `- ${ref}`,
      );
    }
  }
  lines.push("</authorized_refs>");
  lines.push("</output_envelope_contract>");
  return lines.join("\n");
}

// ─────────────────────────── Lectura de la salida ───────────────────────────

export interface ExtractedEnvelope {
  /** El bloque venía y era JSON parseable con la versión esperada. */
  present: boolean;
  envelope: StructuredExecutionEnvelope | null;
  /** Elementos presentes que no cumplieron su contrato canónico. Nunca se reparan. */
  rejected: number;
}

/**
 * Extrae el envelope de la salida del agente.
 *
 * Tolerante en la forma, estricta en el contenido: acepta que el modelo envuelva el
 * bloque en un fence de markdown o deje espacios, pero cada elemento se valida por
 * separado y los que no cumplen se cuentan como rechazados en vez de corregirse.
 *
 * La ausencia del bloque NO es un fallo de la ejecución: el dictamen narrativo ya vale
 * por sí mismo. Simplemente no se proyecta nada.
 */
export function extractEnvelope(text: string): ExtractedEnvelope {
  const raw = envelopeBlock(text);
  if (raw === null) return { present: false, envelope: null, rejected: 0 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { present: false, envelope: null, rejected: 0 };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { present: false, envelope: null, rejected: 0 };
  }
  const root = parsed as Record<string, unknown>;
  if (root.envelope_version !== ENVELOPE_VERSION) {
    return { present: false, envelope: null, rejected: 0 };
  }

  let rejected = 0;
  const keep = <T>(schema: z.ZodType<T>, value: unknown): T[] => {
    if (!Array.isArray(value)) return [];
    const out: T[] = [];
    for (const el of value) {
      const r = schema.safeParse(el);
      if (r.success) out.push(r.data);
      else rejected += 1;
    }
    return out;
  };

  const conclusion =
    typeof root.conclusion_brief === "string" && root.conclusion_brief.trim().length > 0
      ? root.conclusion_brief.trim()
      : undefined;

  // Las validaciones se ejecutan ANTES de construir el resultado: `rejected` sólo es
  // cierto una vez que han corrido las cuatro, y leerlo en medio del literal lo dejaba
  // permanentemente en cero.
  const facts = keep(EnvelopeFact, root.facts);
  const authorities = keep(EnvelopeAuthority, root.authorities);
  const risks = keep(EnvelopeRisk, root.risks);
  const tasks = keep(EnvelopeTask, root.tasks);

  return {
    present: true,
    rejected,
    envelope: {
      envelope_version: ENVELOPE_VERSION,
      conclusion_brief: conclusion,
      facts,
      authorities,
      risks,
      tasks,
    },
  };
}

/**
 * Devuelve el análisis narrativo SIN el bloque estructurado.
 *
 * El abogado lee un dictamen, no un apéndice de JSON con identificadores internos. El
 * envelope alimenta las superficies del expediente; la prosa es lo que se le muestra.
 */
export function stripEnvelope(text: string): string {
  const open = text.indexOf(ENVELOPE_OPEN);
  if (open === -1) return text.trim();
  const before = text.slice(0, open);
  const closeIdx = text.indexOf(ENVELOPE_CLOSE, open);
  const after = closeIdx === -1 ? "" : text.slice(closeIdx + ENVELOPE_CLOSE.length);
  // Un fence de markdown que envolviera el bloque queda huérfano al quitarlo.
  return `${before}${after}`.replace(/```(?:json)?\s*```/g, "").trim();
}

function envelopeBlock(text: string): string | null {
  const open = text.indexOf(ENVELOPE_OPEN);
  if (open === -1) return null;
  const from = open + ENVELOPE_OPEN.length;
  const close = text.indexOf(ENVELOPE_CLOSE, from);
  const body = close === -1 ? text.slice(from) : text.slice(from, close);
  const trimmed = body.trim().replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
  return trimmed.length > 0 ? trimmed : null;
}
