import { evidenceAdmits, type DocumentExcerpt, type EvidenceMember, type RetrievalProvider } from "@iusia/domain";

/**
 * Recolecta la evidencia RAG de un matter y la transforma al contrato de dominio
 * `document_excerpts` que consume el WorkPackage.
 *
 * AISLAMIENTO (no negociable): el alcance de recuperación se deriva SIEMPRE de los
 * argumentos server-side de la ejecución (organización + este matter). Nunca se
 * acepta scope desde el modelo, el prompt, el cliente o un output previo. La query
 * es el objetivo real de la ejecución, no un texto fijo.
 *
 * Si el proveedor no está configurado, devuelve `[]`: no se inventa evidencia; los
 * agentes reciben excerpts vacíos y declaran insuficiencia según su comportamiento.
 */
/**
 * Cota de la llamada al índice de recuperación.
 *
 * Medido: en la ejecución exe_20nf6k8tvj3f44se la llamada a AI Search se quedó colgada
 * 213 segundos sin devolver ni fallar. El `step.do` que la envuelve tiene un timeout de
 * 10 minutos, así que nadie la cortó: el reintento sólo llegó cuando la propia llamada
 * murió, y el segundo intento resolvió en 2,4 s. Ese cuelgue fue el 29 % de una
 * ejecución de 12 minutos, sin hacer trabajo alguno.
 *
 * Con la cota, el peor caso es ~25 s + el backoff de 10 s del step, en vez de minutos.
 * NO se degrada a evidencia vacía: eso volvería a entregar un análisis sin fundamento
 * documental sin decirlo. Se lanza, y el reintento del Workflow —que es rápido— vuelve
 * a intentarlo.
 */
export const RETRIEVAL_DEADLINE_MS = 25_000;

export class RetrievalTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`La recuperación de evidencia superó ${timeoutMs} ms`);
    this.name = "RetrievalTimeoutError";
  }
}

/** Corta una promesa que no responde. El temporizador se limpia siempre. */
export async function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new RetrievalTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function collectMatterEvidence(args: {
  retrieval: RetrievalProvider;
  organizationId: string;
  matterId: string;
  objective: string;
  /** document_id → nombre legible, para la metadata del excerpt. */
  documentNames: Map<string, string>;
  /**
   * Conjunto congelado al arrancar el análisis. Filtra por documento Y por parte.
   *
   * Sin él, un fragmento de la página 73 de un documento cuyo análisis empezó con las
   * páginas 1 a 40 disponibles entraría igual: se indexó después de que el abogado
   * pulsara el botón, y citarlo sería apoyar el dictamen en una fuente que no existía
   * cuando se tomó la decisión.
   */
  evidenceSet?: readonly EvidenceMember[];
  maxResults?: number;
  /** Cota de la llamada al índice. Ver `RETRIEVAL_DEADLINE_MS`. */
  timeoutMs?: number;
}): Promise<DocumentExcerpt[]> {
  if (args.retrieval.status() !== "CONNECTED") return [];

  const chunks = await withDeadline(
    args.retrieval.search({
      scope: {
        organization_id: args.organizationId,
        authorized_matter_ids: [args.matterId],
      },
      query: args.objective,
      max_results: args.maxResults ?? 5,
    }),
    args.timeoutMs ?? RETRIEVAL_DEADLINE_MS,
  );

  const admitido = (chunk: { document_id: string; partition_ordinal?: number }): boolean =>
    args.documentNames.has(chunk.document_id)
    && (args.evidenceSet === undefined || evidenceAdmits(args.evidenceSet, chunk));

  return chunks.filter(admitido).map((chunk, i) => ({
    // Conserva el document_id: trazabilidad chunk → documento → matter → output.
    ref_id: `${chunk.document_id}#${i + 1}`,
    document_name: args.documentNames.get(chunk.document_id) ?? chunk.document_id,
    content: chunk.excerpt,
    // Procedencia: sin la parte, una cita de un documento de cien páginas no puede
    // volver al sitio del que salió, y eso no sirve en un escrito.
    page_hint: chunk.partition_ordinal === undefined
      ? `chunk ${i + 1} · score ${chunk.score.toFixed(3)}`
      : `parte ${chunk.partition_ordinal} · chunk ${i + 1} · score ${chunk.score.toFixed(3)}`,
  }));
}
