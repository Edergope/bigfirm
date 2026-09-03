/**
 * Qué formatos entienden IUSIA y cuáles sólo guarda.
 *
 * POR QUÉ EXISTE ESTE MÓDULO. Había dos listas. La ruta de carga aceptaba
 * `application/msword`, `image/png` y `video/mp4`; la ingestión, que decide qué se
 * puede leer, no los tenía. El resultado para el abogado era que sus dos `.DOC`
 * subían sin objeción, esperaban turno, se procesaban y sólo al final aparecían como
 * «Vista disponible · no indexado» — la respuesta correcta, dada tres minutos tarde y
 * sin decir qué hacer al respecto. Lo que se puede saber al elegir el archivo se dice
 * al elegir el archivo.
 *
 * Es la misma clase de defecto que el 409 silencioso del botón «Reintentar»: dos
 * derivaciones del mismo concepto sólo coinciden por casualidad.
 *
 * LA TABLA. Los formatos ricos no los convierte IUSIA, los convierte la conversión a
 * Markdown de Workers AI, y su cobertura la fija Cloudflare, no nosotros. La lista de
 * abajo es la publicada en `ai-search/configuration/data-source/#supported-file-types`
 * (revisada el 2026-09-03, doc con fecha 2026-08-06). No se añade aquí ningún formato
 * que esa tabla no nombre: declarar una capacidad que el proveedor no tiene sólo
 * traslada el fallo desde la carga hasta el final del procesamiento.
 */

/**
 * Formatos ricos que la conversión a Markdown sabe leer SIN modelos de visión.
 *
 * Nota sobre lo que NO está: `application/msword` —el `.doc` de Word 97-2003— no
 * figura en la tabla oficial. Sólo el `.docx` moderno. No hay conversor propio ni lo
 * habrá: escribir un parser del formato binario de Word sería inventar una capacidad
 * que el resto del sistema daría por probada.
 */
const RICH_TEXT_MIME = new Set([
  "application/pdf",
  "text/html",
  // Office moderno: Word y toda la familia de Excel, incluidas las macro.
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.ms-excel.sheet.binary.macroenabled.12",
  // OpenDocument y Apple Numbers: en la tabla oficial desde antes de este sprint, y
  // fuera de IUSIA sólo porque nadie los había mirado.
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.apple.numbers",
]);

/**
 * Imágenes que la tabla oficial cubre.
 *
 * DELIBERADAMENTE APAGADAS. La conversión existe, pero pasa cada imagen por un modelo
 * de detección de objetos y otro de visión que la describe en prosa. Eso es coste por
 * archivo y, sobre todo, es una DESCRIPCIÓN GENERADA: «un documento con texto impreso
 * y un sello» no es el texto del documento, y citarla como evidencia sería atribuirle
 * al expediente algo que nadie escribió en él. Un escaneo de una demanda necesita OCR,
 * que es otra cosa.
 *
 * Encenderlas es una decisión de producto con coste asociado, no un ajuste técnico.
 * Mientras esté apagada, el abogado merece saberlo ANTES de subir cincuenta fotos.
 */
const VISION_ONLY_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
  "image/gif",
  "image/bmp",
]);

/** Formatos legibles como texto plano, sin conversión de por medio. */
function isPlainText(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/")
    || mimeType === "application/json"
    || mimeType === "application/xml"
  );
}

/** ¿Puede IUSIA leer este documento y citarlo como evidencia? */
export function isReadableMimeType(mimeType: string): boolean {
  return isPlainText(mimeType) || RICH_TEXT_MIME.has(mimeType);
}

export type FormatVerdict =
  /** Se lee y se cita. */
  | "READABLE"
  /** Se guarda y se consulta, pero no entra al análisis. */
  | "STORED_ONLY"
  /** Ni siquiera se acepta. */
  | "REJECTED";

export interface FormatCoverage {
  verdict: FormatVerdict;
  /** Qué se le dice al abogado. Sin jerga y, cuando la hay, con la salida concreta. */
  reason: string;
}

/**
 * Veredicto de formato, dicho como se le dirá al abogado.
 *
 * Se resuelve con el tipo MIME y, sólo para el `.doc`, con la extensión: los
 * navegadores no siempre etiquetan bien los formatos viejos, y un archivo que llega
 * como `application/octet-stream` no debe pasar por indexable.
 */
export function formatCoverage(mimeType: string, filename = ""): FormatCoverage {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();

  if (mimeType === "application/msword" || ext === ".doc") {
    return {
      verdict: "STORED_ONLY",
      reason:
        "El formato .doc de Word 97-2003 no puede leerse. Guárdalo como .docx o PDF y vuelve a subirlo para que IUSIA pueda citarlo.",
    };
  }
  if (VISION_ONLY_MIME.has(mimeType)) {
    return {
      verdict: "STORED_ONLY",
      reason:
        "Las imágenes se conservan en el expediente, pero IUSIA aún no lee su contenido. Si el documento es un escaneo, sube la versión en PDF con texto.",
    };
  }
  if (isReadableMimeType(mimeType)) {
    return { verdict: "READABLE", reason: "IUSIA leerá este documento y podrá citarlo." };
  }
  if (STORED_ONLY_MIME.has(mimeType)) {
    return {
      verdict: "STORED_ONLY",
      reason: "Se conserva en el expediente, pero su formato no permite usarlo como evidencia.",
    };
  }
  return {
    verdict: "REJECTED",
    reason: "IUSIA no admite este tipo de archivo.",
  };
}

/**
 * Lo que se guarda sin leer: audio y vídeo. Se admiten porque el expediente es el
 * expediente —una audiencia grabada pertenece a él— y se etiquetan como lo que son.
 */
const STORED_ONLY_MIME = new Set([
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
]);

/** Todo lo que la carga acepta, legible o no. Sustituye a la lista paralela del router. */
export const ACCEPTED_UPLOAD_MIME: ReadonlySet<string> = new Set([
  ...RICH_TEXT_MIME,
  ...VISION_ONLY_MIME,
  ...STORED_ONLY_MIME,
  "application/msword",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/xml",
  "application/json",
  "application/xml",
]);

export function isAcceptedUpload(mimeType: string): boolean {
  return ACCEPTED_UPLOAD_MIME.has(mimeType) || isPlainText(mimeType);
}

/**
 * Resumen de una selección antes de subirla: cuántos entrarán al análisis y por qué no
 * los demás. Es lo que faltaba para que dos `.DOC` no se descubrieran tres minutos tarde.
 */
export function summarizeSelection(
  files: readonly { name: string; type: string }[],
): { readable: number; storedOnly: number; rejected: number; notices: string[] } {
  const notices = new Map<string, number>();
  let readable = 0;
  let storedOnly = 0;
  let rejected = 0;

  for (const file of files) {
    const coverage = formatCoverage(file.type, file.name);
    if (coverage.verdict === "READABLE") {
      readable += 1;
      continue;
    }
    if (coverage.verdict === "STORED_ONLY") storedOnly += 1;
    else rejected += 1;
    // Un mismo motivo no se repite una vez por archivo: se cuenta.
    notices.set(coverage.reason, (notices.get(coverage.reason) ?? 0) + 1);
  }

  return {
    readable,
    storedOnly,
    rejected,
    notices: [...notices].map(([reason, count]) =>
      count === 1 ? reason : `${count} archivos: ${reason}`,
    ),
  };
}
