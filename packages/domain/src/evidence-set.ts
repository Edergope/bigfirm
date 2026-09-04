/**
 * Qué documentos constituyen la evidencia de UN análisis.
 *
 * El conjunto se fija cuando el análisis arranca y no cambia después.
 *
 * POR QUÉ. La recuperación se hacía contra el expediente vivo: cada misión preguntaba
 * al índice y aceptaba cualquier documento que estuviera en el expediente en ESE
 * instante. Un documento que terminara de indexarse a los treinta segundos entraba a
 * mitad de ejecución sin que nadie lo decidiera, de modo que el dictamen podía citar
 * una fuente que no existía cuando el abogado pulsó «Analizar los 6 preparados». Dos
 * ejecuciones del mismo expediente con el mismo objetivo podían apoyarse en conjuntos
 * distintos, y ninguna de las dos podría reproducirse más tarde.
 *
 * Que un documento llegue tarde no es un error: es lo normal cuando quince archivos
 * entran a la vez. Lo que no puede pasar es que se cuele sin decirlo. Llega al
 * siguiente análisis, que es donde el abogado lo espera.
 */

export interface EvidenceCandidate {
  id: string;
  ingestionStatus: string;
  currentVersion: number;
  retiredAt?: string | null;
}

export interface EvidenceMember {
  document_id: string;
  version: number;
}

/**
 * Documentos que IUSIA puede citar en este análisis: indexados, vigentes y en la
 * versión que tenían al empezar.
 *
 * La versión forma parte de la identidad. Sin ella, aportar una versión nueva a mitad
 * de ejecución cambiaría el contenido citado dejando intacto el `document_id`, y el
 * dictamen apuntaría a un texto que ya nadie puede leer.
 */
export function freezeEvidenceSet(docs: readonly EvidenceCandidate[]): EvidenceMember[] {
  return docs
    .filter((d) => d.ingestionStatus === "AI_INDEXED" && !d.retiredAt)
    .map((d) => ({ document_id: d.id, version: d.currentVersion }))
    .sort((a, b) => a.document_id.localeCompare(b.document_id));
}

/**
 * Cuántos documentos entrarían al análisis si se lanzara ahora.
 *
 * Es la MISMA función que decide el botón, el mensaje de disponibilidad y el conjunto
 * que congela el servidor. Que fueran tres cuentas distintas es como el botón llegó a
 * ofrecer «Analizar los 6 preparados» mientras el mensaje hablaba de un solo documento
 * excluido y el análisis recuperaba de nueve.
 */
export function evidenceSetSize(docs: readonly EvidenceCandidate[]): number {
  return freezeEvidenceSet(docs).length;
}

/** ¿Está este documento en el conjunto congelado? Filtro de los chunks recuperados. */
export function evidenceSetHas(
  members: readonly EvidenceMember[],
  documentId: string,
): boolean {
  return members.some((m) => m.document_id === documentId);
}
