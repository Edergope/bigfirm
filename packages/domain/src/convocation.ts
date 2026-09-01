/**
 * Contrato de la convocatoria: cuándo puede analizarse y qué lee el abogado.
 *
 * Vive en el dominio —junto a `documentErrorMessage` y `matterLoadFailure`— porque es
 * LÓGICA y no interfaz: se prueba sin DOM, y el runtime del Worker puede auditar
 * exactamente las mismas frases que verá el abogado.
 */

/** Metadata autorizada del expediente candidato. Nunca contenido del expediente. */
export interface DuplicateCandidateView {
  matter_id: string;
  reference: string;
  title: string;
  client_name: string;
  created_at: string;
}

/**
 * ¿Están los documentos aportados listos para el análisis documental?
 *
 * Antes esto era una ESPERA BLOQUEANTE de doce intentos (~30 s) que decidía si la
 * convocatoria entera había funcionado. La ingestión real de un PDF tarda alrededor
 * de 90 s, así que la espera vencía siempre: el expediente quedaba creado, con su
 * carpeta y su documento, pero la pantalla volvía al formulario como si nada hubiera
 * pasado — y el siguiente intento abría otro expediente. Ese fue el incidente
 * IUS-2026-011/012/013.
 *
 * Ahora es una consulta única, sin espera: la creación no depende de ella.
 * `ingestion_status` es el campo correcto —`status` es el ciclo de revisión jurídica,
 * no la disponibilidad para el RAG—.
 */
const NOT_READY_FOR_ANALYSIS = new Set(["PENDIENTE", "PROCESSING", "FILE_STORED"]);

export function documentsReadyForAnalysis(
  uploaded: readonly { ingestion_status: string }[],
  expected: number,
): boolean {
  if (uploaded.length < expected) return false;
  return uploaded.every((d) => !NOT_READY_FOR_ANALYSIS.has(d.ingestion_status));
}

/** Etapa de la convocatoria que falló. Cada una se dice distinto al abogado. */
export type ConvocationStage =
  | "MATTER_CREATION_FAILED"
  | "DOCUMENT_UPLOAD_FAILED"
  | "ORCHESTRATION_START_FAILED"
  | "TEMPORARY_SERVICE_FAILURE"
  | "POSSIBLE_DUPLICATE_MATTER";

/**
 * Qué leerá el abogado cuando algo falle. «No fue posible convocar al equipo» era
 * la misma frase para cinco situaciones distintas, y tres de ellas dejaban el
 * expediente perfectamente creado.
 */
export function convocationErrorCopy(
  stage: ConvocationStage,
  matterCreated: boolean,
): { message: string; keepsMatter: boolean } {
  switch (stage) {
    case "MATTER_CREATION_FAILED":
      return { message: "No fue posible crear el expediente. Inténtalo de nuevo.", keepsMatter: false };
    case "DOCUMENT_UPLOAD_FAILED":
      return {
        message:
          "El expediente fue creado, pero no pudimos incorporar el documento. Puedes reintentarlo o abrir el expediente.",
        keepsMatter: true,
      };
    case "ORCHESTRATION_START_FAILED":
      return {
        message:
          "No fue posible iniciar el análisis. El expediente y sus documentos están seguros.",
        keepsMatter: true,
      };
    case "POSSIBLE_DUPLICATE_MATTER":
      return { message: "Ya existe un expediente que parece corresponder a este asunto.", keepsMatter: false };
    case "TEMPORARY_SERVICE_FAILURE":
    default:
      return {
        message: matterCreated
          ? "Hubo un problema temporal del servicio. El expediente está a salvo."
          : "Hubo un problema temporal del servicio. Inténtalo de nuevo.",
        keepsMatter: matterCreated,
      };
  }
}
