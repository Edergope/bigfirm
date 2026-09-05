/**
 * Extracción de texto de imágenes y escaneos.
 *
 * LA REGLA QUE GOBIERNA TODO ESTE MÓDULO: se transcribe lo que se ve, y nada más.
 *
 * Un modelo de visión sabe hacer dos cosas muy distintas y sólo una sirve aquí.
 * Describir —«un documento con texto impreso y un sello»— produce prosa nueva que
 * nadie escribió en el expediente, y citarla como evidencia sería atribuirle al
 * documento algo que no dice. Transcribir devuelve el texto que está en la imagen.
 * El prompt de abajo pide lo segundo y prohíbe lo primero de forma explícita, porque
 * la diferencia entre ambas es la diferencia entre una prueba y una invención.
 *
 * De ahí también que la temperatura sea cero y el razonamiento vaya apagado: no
 * queremos que el modelo piense sobre el documento, queremos que lo lea.
 */

/**
 * Instrucción de transcripción.
 *
 * Se prohíbe expresamente rellenar lo ilegible. Un número de cédula medio borroso
 * completado «con criterio» es exactamente el tipo de error que nadie detecta hasta
 * que ya está en un escrito judicial.
 */
export const OCR_TRANSCRIPTION_PROMPT = [
  "Transcribe literalmente todo el texto visible en esta imagen.",
  "Conserva el orden de lectura, los saltos de línea y los números tal como aparecen.",
  "No describas la imagen. No expliques qué tipo de documento es. No resumas.",
  "No completes, corrijas ni adivines texto ilegible: escribe [ilegible] en su lugar.",
  "Si la imagen no contiene ningún texto legible, responde exactamente: SIN_TEXTO.",
].join(" ");

/** Lo que el modelo responde cuando no hay nada que leer. */
export const OCR_NO_TEXT_SENTINEL = "SIN_TEXTO";

/**
 * Longitud mínima para considerar que hubo transcripción.
 *
 * Una respuesta de tres caracteres no es el contenido de una cédula. Por debajo de
 * este umbral se trata como imagen sin texto: es preferible decir «no pude leerlo» a
 * indexar un fragmento que no sostiene nada y que además ensucia la recuperación.
 */
export const OCR_MIN_TEXT_LENGTH = 12;

export type OcrOutcome =
  | { status: "TEXT"; text: string }
  | { status: "NO_TEXT" };

/**
 * Interpreta la respuesta cruda del modelo.
 *
 * Es determinista y vive en el dominio para poder probar las reglas sin invocar a
 * ningún modelo: qué cuenta como texto, qué cuenta como nada, y qué se hace con las
 * respuestas evasivas que un modelo de visión produce cuando no encuentra nada.
 */
export function interpretOcrAnswer(raw: string | null | undefined): OcrOutcome {
  const text = (raw ?? "").trim();
  if (text.length === 0) return { status: "NO_TEXT" };
  if (text.toUpperCase().includes(OCR_NO_TEXT_SENTINEL)) return { status: "NO_TEXT" };

  /*
    Respuestas que son una descripción disfrazada. Aunque el prompt lo prohíbe, un
    modelo de visión a veces contesta «la imagen muestra…» en vez de transcribir. Eso
    NO es el texto del documento y no puede entrar al índice como si lo fuera.
  */
  const descripcion = /^(la imagen|esta imagen|the image|se (observa|aprecia|ve)\b)/i;
  if (descripcion.test(text)) return { status: "NO_TEXT" };

  if (text.length < OCR_MIN_TEXT_LENGTH) return { status: "NO_TEXT" };
  return { status: "TEXT", text };
}

/**
 * ¿La conversión de un documento devolvió algo utilizable?
 *
 * Un PDF escaneado pasa por la conversión sin error y devuelve una cadena vacía o
 * cuatro caracteres de metadatos: la plataforma extrae texto, no hace OCR. Antes eso
 * se subía igual al índice, producía cero fragmentos, y la confirmación lo perseguía
 * durante horas antes de darse por vencida. Seis horas para averiguar que el archivo
 * no tenía texto que leer.
 *
 * Se comprueba antes de subir nada.
 */
export function hasUsableText(text: string): boolean {
  return text.trim().length >= OCR_MIN_TEXT_LENGTH;
}

/**
 * De dónde salió el texto de un documento. Viaja con el contenido hasta la evidencia.
 *
 * `OCR_EXTRACTED` no es lo mismo que `NATIVE_TEXT`: uno lo escribió quien redactó el
 * documento y el otro lo leyó una máquina de una fotografía. Quien después construya
 * un argumento jurídico sobre ese texto tiene derecho a saber cuál de los dos es.
 */
export const TEXT_SOURCES = ["NATIVE_TEXT", "OCR_EXTRACTED"] as const;
export type TextSource = (typeof TEXT_SOURCES)[number];

/** Motivo, en las palabras que lee el abogado, de que algo no tenga texto. */
export const NO_TEXT_REASON = {
  IMAGE:
    "No se detectó texto legible en esta imagen. Se conserva en el expediente, pero IUSIA no puede citarla.",
  SCANNED_PDF:
    "Este PDF no contiene texto: es un escaneo o una imagen. Se conserva en el expediente, pero IUSIA no puede citarlo. Si tienes una versión con texto seleccionable, súbela.",
} as const;
