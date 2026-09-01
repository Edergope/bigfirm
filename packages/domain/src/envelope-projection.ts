import type { Authority, CanonicalFact } from "./ledgers.js";
import type {
  EnvelopeAuthority,
  EnvelopeFact,
  EnvelopeRisk,
  EnvelopeTask,
  StructuredExecutionEnvelope,
  RiskSeverity,
} from "./execution-envelope.js";

/**
 * Proyección del envelope a las superficies del expediente.
 *
 * Éste es el punto donde una AFIRMACIÓN del modelo se convierte —o no— en un registro
 * del expediente del que responde el despacho. Todas las reglas son deterministas: no
 * hay modelo, no hay heurística de lenguaje, y ningún elemento se "repara" para que
 * pase. Lo que no cumple se descarta y se cuenta.
 *
 * Las cuatro reglas, en orden de aplicación:
 *
 * 1. PROCEDENCIA. Cada `source_ref` debe estar en el conjunto de referencias que el
 *    servidor entregó realmente en el WorkPackage. Una referencia inventada se elimina
 *    del elemento; no se le concede el beneficio de la duda.
 * 2. FUNDAMENTO. Tras el filtro anterior, un elemento sin ninguna referencia
 *    superviviente NO se proyecta. Sigue visible en la salida del agente —el abogado ve
 *    todo lo que el equipo dijo— pero no se convierte en un hecho, una autoridad, una
 *    tarea ni un riesgo del expediente.
 * 3. UNICIDAD. Se deduplica por contenido normalizado, no por el identificador que
 *    inventó el modelo: dos ejecuciones distintas producen `fact_id` distintos para el
 *    mismo hecho, y el expediente terminaría con el mismo hecho repetido cada vez.
 * 4. VOLUMEN. Topes por ejecución. Un modelo que se desborda no puede inundar el
 *    expediente de cientos de registros que ningún abogado va a poder revisar.
 */

/** Topes por ejecución. Generosos para trabajo real, letales para un desbordamiento. */
export const PROJECTION_CAPS = {
  facts: 40,
  authorities: 30,
  risks: 15,
  tasks: 15,
} as const;

export interface ProjectionInput {
  envelope: StructuredExecutionEnvelope;
  /** Referencias REALMENTE entregadas al agente en su WorkPackage. */
  authorizedRefs: readonly string[];
  /** Títulos de tareas que ya existen en el expediente, normalizados por el caller. */
  existingTaskTitles?: readonly string[];
}

export interface ProjectedRisk {
  description: string;
  severity: RiskSeverity;
  likelihood: string;
  rationale: string;
  source_refs: string[];
}

export interface ProjectedTask {
  title: string;
  description: string;
  priority: string;
  source_refs: string[];
}

export interface ProjectionResult {
  facts: CanonicalFact[];
  authorities: Authority[];
  risks: ProjectedRisk[];
  tasks: ProjectedTask[];
  /** Procedencia conservada por elemento proyectado, para auditoría. */
  provenance: {
    facts: Record<string, string[]>;
    authorities: Record<string, string[]>;
  };
  /** Por qué se descartó cada cosa. Es lo que hace auditable el filtro. */
  dropped: {
    unsourced: number;
    duplicate: number;
    over_cap: number;
    unknown_refs: number;
  };
}

export function projectEnvelope(input: ProjectionInput): ProjectionResult {
  const authorized = new Set(input.authorizedRefs);
  const dropped = { unsourced: 0, duplicate: 0, over_cap: 0, unknown_refs: 0 };

  /** Regla 1: deja sólo las referencias que el servidor entregó de verdad. */
  const validRefs = (refs: readonly string[]): string[] => {
    const kept: string[] = [];
    for (const ref of refs) {
      if (authorized.has(ref)) kept.push(ref);
      else dropped.unknown_refs += 1;
    }
    return [...new Set(kept)];
  };

  const seen = { facts: new Set<string>(), authorities: new Set<string>(), risks: new Set<string>(), tasks: new Set<string>() };

  /** Reglas 2-4, comunes a las cuatro superficies. */
  function gate<T>(
    items: readonly T[],
    kind: keyof typeof seen,
    cap: number,
    refsOf: (item: T) => readonly string[],
    keyOf: (item: T) => string,
    build: (item: T, refs: string[]) => void,
  ): void {
    let accepted = 0;
    for (const item of items) {
      const refs = validRefs(refsOf(item));
      if (refs.length === 0) {
        dropped.unsourced += 1;
        continue;
      }
      const key = normalize(keyOf(item));
      if (key.length === 0 || seen[kind].has(key)) {
        dropped.duplicate += 1;
        continue;
      }
      if (accepted >= cap) {
        dropped.over_cap += 1;
        continue;
      }
      seen[kind].add(key);
      accepted += 1;
      build(item, refs);
    }
  }

  const facts: CanonicalFact[] = [];
  const factProvenance: Record<string, string[]> = {};
  gate<EnvelopeFact>(
    input.envelope.facts,
    "facts",
    PROJECTION_CAPS.facts,
    (f) => f.source_refs,
    (f) => f.statement,
    (f, refs) => {
      // `source_refs` es metadato de runtime: el ledger recibe el hecho canónico puro.
      const { source_refs: _omit, ...canonical } = f;
      facts.push(canonical);
      factProvenance[canonical.fact_id] = refs;
    },
  );

  const authorities: Authority[] = [];
  const authorityProvenance: Record<string, string[]> = {};
  gate<EnvelopeAuthority>(
    input.envelope.authorities,
    "authorities",
    PROJECTION_CAPS.authorities,
    (a) => a.source_refs,
    (a) => a.citation,
    (a, refs) => {
      const { source_refs: _omit, ...canonical } = a;
      authorities.push(canonical);
      authorityProvenance[canonical.authority_id] = refs;
    },
  );

  const risks: ProjectedRisk[] = [];
  gate<EnvelopeRisk>(
    input.envelope.risks,
    "risks",
    PROJECTION_CAPS.risks,
    (r) => r.source_refs,
    (r) => r.description,
    (r, refs) => {
      risks.push({
        description: r.description,
        severity: r.severity,
        likelihood: r.likelihood,
        rationale: r.rationale,
        source_refs: refs,
      });
    },
  );

  // Las tareas se deduplican también contra las que YA existen en el expediente: un
  // reanálisis no puede volver a crear la misma tarea que el abogado ya tiene abierta.
  for (const title of input.existingTaskTitles ?? []) seen.tasks.add(normalize(title));

  const tasks: ProjectedTask[] = [];
  gate<EnvelopeTask>(
    input.envelope.tasks,
    "tasks",
    PROJECTION_CAPS.tasks,
    (t) => t.source_refs,
    (t) => t.title,
    (t, refs) => {
      tasks.push({
        title: t.title,
        description: t.description,
        priority: t.priority,
        source_refs: refs,
      });
    },
  );

  return {
    facts,
    authorities,
    risks,
    tasks,
    provenance: { facts: factProvenance, authorities: authorityProvenance },
    dropped,
  };
}

const SEVERITY_ORDER: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

/**
 * Nivel de riesgo del expediente a partir de los riesgos proyectados: el más alto.
 *
 * Devuelve `null` cuando no hay nada que afirmar. Quien llama decide si escribirlo, y
 * la regla operativa es que NUNCA se pisa una calificación humana: el riesgo del
 * expediente lo fija el abogado, y IUSIA sólo lo propone donde nadie ha decidido aún.
 */
export function riskLevelFrom(
  risks: readonly ProjectedRisk[],
): { level: RiskSeverity; rationale: string } | null {
  let top: ProjectedRisk | null = null;
  for (const r of risks) {
    if (!top || (SEVERITY_ORDER[r.severity] ?? 0) > (SEVERITY_ORDER[top.severity] ?? 0)) top = r;
  }
  if (!top) return null;
  return {
    level: top.severity,
    // La metodología viaja con el nivel: el expediente exige justificación para
    // mostrar un riesgo, y aquí queda explícito de dónde salió.
    rationale: `${top.description} — ${top.rationale} (probabilidad: ${top.likelihood}; IUSIA, fuentes: ${top.source_refs.join(", ")})`,
  };
}

/** Normalización para deduplicar por contenido: acentos, caso, puntuación y espacios. */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
