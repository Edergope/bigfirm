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
  /** Cuántas partes tiene. 0 o 1 ⇒ documento entero en un item. */
  partitionCount?: number;
  /** Ordinales ya disponibles, si está partido. */
  readyPartitions?: readonly number[];
}

export interface EvidenceMember {
  document_id: string;
  version: number;
  /**
   * Partes del documento que ya se podían citar cuando arrancó el análisis.
   *
   * Vacío significa «el documento entero», que es el caso de todo lo que cabe en un
   * item. Para un documento de cien páginas significa exactamente qué páginas entraron:
   * se eligió que las partes listas puedan ser evidencia sin esperar a la última,
   * porque hacer esperar un expediente entero por su documento más lento es lo que
   * convierte una herramienta en un estorbo.
   *
   * Eso sólo es defendible con procedencia exacta, y la hay: el ordinal viaja en la
   * clave del item y vuelve con cada fragmento recuperado. Sin esa precisión habría
   * elegido lo contrario —documento completo o nada—, porque una cita que no puede
   * volver a su página no sirve en un escrito.
   */
  partitions?: readonly number[];
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
    .filter((d) => {
      if (d.retiredAt) return false;
      // Un documento partido entra con las partes que ya tenga listas, aunque le
      // falten otras: su estado sigue siendo INDEXING hasta la última.
      if ((d.partitionCount ?? 0) > 1) return (d.readyPartitions?.length ?? 0) > 0;
      return d.ingestionStatus === "AI_INDEXED";
    })
    .map((d) => ({
      document_id: d.id,
      version: d.currentVersion,
      ...((d.partitionCount ?? 0) > 1
        ? { partitions: [...(d.readyPartitions ?? [])].sort((a, b) => a - b) }
        : {}),
    }))
    .sort((a, b) => a.document_id.localeCompare(b.document_id));
}

/**
 * ¿Puede citarse este fragmento?
 *
 * Se comprueba el documento Y la parte. Un fragmento de la página 73 de un documento
 * cuyo análisis arrancó con las páginas 1 a 40 disponibles NO puede entrar: se indexó
 * después de que el abogado pulsara el botón, y dejarlo pasar sería citar una fuente
 * que no existía cuando se tomó la decisión.
 */
export function evidenceAdmits(
  members: readonly EvidenceMember[],
  chunk: { document_id: string; partition_ordinal?: number },
): boolean {
  const member = members.find((m) => m.document_id === chunk.document_id);
  if (!member) return false;
  if (!member.partitions) return true;
  if (chunk.partition_ordinal === undefined) return false;
  return member.partitions.includes(chunk.partition_ordinal);
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
