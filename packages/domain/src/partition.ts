/**
 * Documentos que no caben en un item del índice.
 *
 * EL LÍMITE ES DEL PROVEEDOR, no nuestro: AI Search acepta hasta 4 MB por item. Un
 * expediente de cien páginas convertido a Markdown lo supera con holgura, y hasta
 * ahora eso terminaba en `PARTITION_REQUIRED`: un código de fallo correcto que no
 * tenía destinatario. El documento quedaba fuera del análisis sin que nadie pudiera
 * hacer nada al respecto.
 *
 * Un documento se parte en trozos que sí caben, cada uno es un item, y el documento
 * está disponible en cuanto lo está su primera parte.
 *
 * LO QUE NO SE HACE AQUÍ. No hay una cola por partición, ni un worker por página, ni
 * un orquestador de particiones. El troceo es una función pura; el reparto lo hace la
 * cola que ya existe, con el mismo mensaje discriminado por `reason`; y la
 * contrapresión son las dos que ya gobiernan la ingestión —el presupuesto de bytes por
 * aislamiento y el techo de invocaciones concurrentes de la cola—. Añadir un tercer
 * mecanismo para lo mismo sólo habría añadido otra cosa que puede desincronizarse.
 */

/**
 * Tamaño máximo de una partición.
 *
 * Por debajo del techo de 4 MB del proveedor, con margen: el texto se mide en bytes
 * UTF-8 y una tilde ocupa dos. Apurar el límite exacto convierte cualquier error de
 * cálculo en un item rechazado.
 */
export const PARTITION_MAX_BYTES = 3 * 1024 * 1024;

/**
 * Umbral a partir del cual se parte.
 *
 * Igual al máximo: lo que cabe en un item va en un item. Partir un documento que no lo
 * necesita multiplica los items, las confirmaciones y la superficie de fallo sin
 * ganar nada.
 */
export const PARTITION_THRESHOLD_BYTES = PARTITION_MAX_BYTES;

export interface Partition {
  /** Posición en el documento, desde 1. Es lo que ordena y lo que da procedencia. */
  ordinal: number;
  text: string;
  bytes: number;
}

const encoder = new TextEncoder();

function byteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

/**
 * Parte un texto en trozos que caben en un item.
 *
 * Corta por PÁRRAFOS, no por bytes. Cortar a mitad de frase produce fragmentos que el
 * índice indexa igual pero que, recuperados, no sostienen nada: un abogado que lee
 * «…por lo cual se declara la» no tiene una cita, tiene una ruina. Cuando un párrafo
 * por sí solo no cabe —una tabla larga, un bloque sin saltos— se parte por líneas, y
 * sólo si tampoco así cabe se corta por longitud, que es el último recurso.
 *
 * Es determinista: el mismo texto da siempre las mismas particiones con los mismos
 * ordinales. De eso depende que reprocesar un documento no cree items nuevos.
 */
export function partitionText(
  text: string,
  maxBytes: number = PARTITION_MAX_BYTES,
): Partition[] {
  if (byteLength(text) <= maxBytes) {
    return [{ ordinal: 1, text, bytes: byteLength(text) }];
  }

  const partes: string[] = [];
  let actual = "";

  const empujar = (): void => {
    if (actual.length > 0) {
      partes.push(actual);
      actual = "";
    }
  };

  for (const bloque of dividirEnBloques(text, maxBytes)) {
    const candidato = actual.length === 0 ? bloque : `${actual}\n\n${bloque}`;
    if (byteLength(candidato) > maxBytes) {
      empujar();
      actual = bloque;
    } else {
      actual = candidato;
    }
  }
  empujar();

  return partes.map((t, i) => ({ ordinal: i + 1, text: t, bytes: byteLength(t) }));
}

/** Párrafos; y si uno no cabe por sí solo, sus líneas; y si no, por longitud. */
function dividirEnBloques(text: string, maxBytes: number): string[] {
  const salida: string[] = [];
  for (const parrafo of text.split(/\n{2,}/)) {
    if (byteLength(parrafo) <= maxBytes) {
      if (parrafo.trim().length > 0) salida.push(parrafo);
      continue;
    }
    for (const linea of parrafo.split("\n")) {
      if (byteLength(linea) <= maxBytes) {
        if (linea.trim().length > 0) salida.push(linea);
        continue;
      }
      salida.push(...trocearPorLongitud(linea, maxBytes));
    }
  }
  return salida;
}

/**
 * Último recurso: una línea única mayor que el límite.
 *
 * Se avanza por caracteres midiendo bytes, porque un carácter multibyte partido por la
 * mitad no es un carácter: es basura que además rompe la codificación del item.
 */
function trocearPorLongitud(linea: string, maxBytes: number): string[] {
  const salida: string[] = [];
  let actual = "";
  for (const ch of linea) {
    if (byteLength(actual + ch) > maxBytes) {
      salida.push(actual);
      actual = ch;
    } else {
      actual += ch;
    }
  }
  if (actual.length > 0) salida.push(actual);
  return salida;
}

/**
 * Clave en R2 de una partición.
 *
 * AQUÍ VIVE LA PROCEDENCIA. El índice admite cinco campos de metadata por instancia y
 * los cinco están ocupados por lo que sostiene el aislamiento —organización,
 * expediente, documento, versión y actividad—; no queda sitio para el ordinal. Pero la
 * clave del item vuelve con cada fragmento recuperado, así que el ordinal viaja en
 * ella. No es un truco: la clave ya era el identificador del contenido, y ahora
 * identifica también qué parte del contenido es.
 *
 * Determinista a propósito: reprocesar escribe encima del mismo objeto y reenvía el
 * mismo item. Con entrega «al menos una vez» eso es la diferencia entre una partición
 * y catorce.
 */
export function partitionKey(
  organizationId: string,
  matterId: string,
  documentId: string,
  ordinal: number,
): string {
  return `org/${organizationId}/matter/${matterId}/doc/${documentId}/p${ordinal}.txt`;
}

/** Lee el ordinal de una clave de partición. Devuelve null si no es una. */
export function ordinalFromKey(key: string): number | null {
  const m = /\/doc\/[^/]+\/p(\d+)\.txt$/.exec(key);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Cuánto de un documento está disponible, dicho para el abogado.
 *
 * Sin jerga: no se habla de particiones, ni de items, ni de fragmentos. Un documento
 * grande tarda, y lo único que el abogado necesita saber es cuánto puede ya usarse.
 */
export function partitionProgressLabel(ready: number, total: number): string {
  if (total <= 1) return ready >= 1 ? "Disponible para el análisis" : "Procesando";
  if (ready === 0) return "Procesando";
  if (ready >= total) return "Disponible para el análisis";
  const pct = Math.floor((ready / total) * 100);
  return `Disponible en un ${pct} %: IUSIA ya puede citar esta parte del documento`;
}
