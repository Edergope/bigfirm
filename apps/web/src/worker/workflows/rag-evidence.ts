import type { DocumentExcerpt, RetrievalProvider } from "@iusia/domain";

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
export async function collectMatterEvidence(args: {
  retrieval: RetrievalProvider;
  organizationId: string;
  matterId: string;
  objective: string;
  /** document_id → nombre legible, para la metadata del excerpt. */
  documentNames: Map<string, string>;
  maxResults?: number;
}): Promise<DocumentExcerpt[]> {
  if (args.retrieval.status() !== "CONNECTED") return [];

  const chunks = await args.retrieval.search({
    scope: {
      organization_id: args.organizationId,
      authorized_matter_ids: [args.matterId],
    },
    query: args.objective,
    max_results: args.maxResults ?? 5,
  });

  return chunks.map((chunk, i) => ({
    // Conserva el document_id: trazabilidad chunk → documento → matter → output.
    ref_id: `${chunk.document_id}#${i + 1}`,
    document_name: args.documentNames.get(chunk.document_id) ?? chunk.document_id,
    content: chunk.excerpt,
    page_hint: `chunk ${i + 1} · score ${chunk.score.toFixed(3)}`,
  }));
}
