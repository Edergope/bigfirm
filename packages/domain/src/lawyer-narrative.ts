/**
 * Presentación del dictamen para el abogado.
 *
 * El trabajo técnico se conserva ÍNTEGRO en R2 y en el ledger: esto es una capa de
 * presentación, nunca una reescritura del producto. Lo que cambia es qué ve quien lee.
 *
 * Lo observado en exe_20nf6k8tvj3f44se: la conclusión que llegaba al abogado incluía
 * «MONOLITHIC FALLBACK EXECUTION», «AGENT EXECUTION LEDGER», «STATUS: COMPLETED
 * upstream», «WorkPackage» y los identificadores `10-auditor-juridico-y-red-team` y
 * `11-auditor-de-citas-y-vigencia». Los hechos citaban «Consta en doc_d4mysy6pspxap6aq#1».
 * Nada de eso es lenguaje jurídico: es telemetría de ejecución filtrada al producto.
 *
 * LÍMITE DURO. Sólo se eliminan bloques de TELEMETRÍA y se traducen IDENTIFICADORES.
 * Ninguna advertencia jurídica se suaviza, se acorta ni se reescribe: la detección de
 * que el documento aportado no corresponde a las partes del expediente —que es
 * exactamente el comportamiento que se quiere preservar— pasa intacta.
 */

/**
 * Encabezados de secciones que son registro de ejecución, no análisis jurídico.
 *
 * Se eliminan desde el encabezado hasta el siguiente encabezado en mayúsculas o el
 * final del texto. La lista es explícita y cerrada: no se borra por parecido.
 */
const TELEMETRY_HEADINGS = [
  "AGENT EXECUTION LEDGER",
  "MONOLITHIC FALLBACK EXECUTION",
  "MULTIAGENT EXECUTION NOT COMPLETED",
  "EXECUTION LEDGER",
] as const;

/** Términos internos que, sueltos en una línea, delatan la maquinaria. */
const INTERNAL_TERMS = [
  "WorkPackage",
  "work_package",
  "STATUS: COMPLETED upstream",
  "output_ref",
  "execution_id",
  "root_execution_id",
  "prompt_sha256",
  "envelope_version",
  "iusia.envelope.v1",
] as const;

export interface LawyerNarrative {
  text: string;
  /** Cuántos bloques de telemetría se retiraron. Para pruebas y auditoría. */
  redactions: number;
}

/**
 * Retira los BLOQUES de telemetría de ejecución del cuerpo del dictamen.
 *
 * Complementa a `sanitizeLegalOutput`, que ya traduce identificadores sueltos de agente
 * y de documento: lo que aquí se elimina son secciones enteras de registro de ejecución
 * que ningún abogado debe leer y que aquella función, por trabajar token a token, deja
 * en pie.
 *
 * La lista de encabezados es explícita y cerrada: nunca se borra por parecido, y
 * ninguna sección de análisis jurídico está en ella.
 */
export function stripTelemetrySections(text: string): LawyerNarrative {
  let redactions = 0;
  let out = text;

  for (const heading of TELEMETRY_HEADINGS) {
    const stripped = stripSection(out, heading);
    if (stripped !== out) redactions += 1;
    out = stripped;
  }

  const kept: string[] = [];
  for (const line of out.split("\n")) {
    if (INTERNAL_TERMS.some((term) => line.includes(term))) {
      redactions += 1;
      continue;
    }
    kept.push(line);
  }
  out = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  return { text: out, redactions };
}

/**
 * Elimina la sección que empieza en `heading` hasta el siguiente encabezado en
 * mayúsculas al inicio de línea, o hasta el final.
 */
function stripSection(text: string, heading: string): string {
  // ANCLADO A INICIO DE LÍNEA. Sin esto, la mención del término en mitad de un párrafo
  // se tomaba por encabezado y se llevaba por delante todo el texto siguiente —incluida
  // la recomendación jurídica—. Un dictamen no puede perder su cierre porque una
  // palabra aparezca dentro de una frase.
  const upper = text.toUpperCase();
  let idx = -1;
  for (let from = 0; ; ) {
    const found = upper.indexOf(heading, from);
    if (found === -1) break;
    const atLineStart = found === 0 || text[found - 1] === "\n";
    if (atLineStart) {
      idx = found;
      break;
    }
    from = found + 1;
  }
  if (idx === -1) return text;
  const lineStart = text.lastIndexOf("\n", idx) + 1;
  const rest = text.slice(idx + heading.length);
  const next = rest.search(/\n[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 ­—·:,()/-]{2,}\n/);
  const end = next === -1 ? text.length : idx + heading.length + next + 1;
  return `${text.slice(0, lineStart)}${text.slice(end)}`.replace(/\n{3,}/g, "\n\n");
}

// ───────────────────────── Nivel de aseguramiento ─────────────────────────

/**
 * Roles cuya ejecución constituye una revisión independiente del trabajo.
 * Se corresponden con `runtime_role: QUALITY_REVIEW` del registry.
 */
export const ASSURANCE_ROLE = "QUALITY_REVIEW";

export interface AssuranceInput {
  /** Materialidad del expediente: determina si la revisión era exigible. */
  materiality: string;
  /** Agentes de revisión que COMPLETARON en esta raíz. */
  completedReviewAgents: readonly string[];
  /** Agentes de revisión exigibles según el routing determinista. */
  requiredReviewAgents: readonly string[];
}

export interface AssuranceNotice {
  /** `true` sólo si se ejecutó toda la revisión exigible. */
  cleared: boolean;
  /** Frase para el abogado. Nunca menciona identificadores de agente. */
  statement: string;
}

/**
 * Declara, en lenguaje jurídico, si el análisis pasó por revisión independiente.
 *
 * Existe porque el sistema afirmaba dos cosas incompatibles: `routing.ts` establece que
 * a partir de materialidad MATERIAL el equipo incluye auditoría jurídica y auditoría de
 * citas, mientras esos dos agentes están `enabled: false` en el registro y el planner
 * dinámico no puede seleccionarlos. El integrador lo notaba y lo decía —con sus
 * identificadores internos— y el resultado se presentaba igualmente como concluido.
 *
 * La regla aquí no oculta la brecha: la nombra en términos que un abogado usa para
 * decidir si el trabajo sirve para radicar o necesita una segunda lectura.
 */
export function assuranceNotice(input: AssuranceInput): AssuranceNotice {
  const pending = input.requiredReviewAgents.filter(
    (a) => !input.completedReviewAgents.includes(a),
  );
  if (input.requiredReviewAgents.length === 0) {
    return {
      cleared: true,
      statement:
        "Por la materialidad de este asunto no se requería una revisión independiente adicional.",
    };
  }
  if (pending.length === 0) {
    return {
      cleared: true,
      statement:
        "El análisis pasó por la revisión independiente prevista para asuntos de esta materialidad.",
    };
  }
  return {
    cleared: false,
    statement:
      "Este análisis no incluye la revisión independiente prevista para asuntos de esta materialidad " +
      "—auditoría jurídica contradictoria y verificación de vigencia de las fuentes citadas—. " +
      "Contrasta las citas y las conclusiones antes de usarlo para radicar o para comprometer una posición.",
  };
}
