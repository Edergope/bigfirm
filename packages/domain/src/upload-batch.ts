/**
 * Progreso de una carga múltiple y disponibilidad parcial del expediente.
 *
 * Un lote NO es una transacción: no se confirma ni se revierte en bloque. Que un
 * archivo falle no puede convertir la carga entera en «Error al procesar expediente»,
 * y que tres sigan procesándose no puede bloquear los doce que ya están listos.
 *
 * Todo lo de aquí es determinista y se calcula sobre los estados que el servidor ya
 * guarda: no hay estado nuevo que mantener sincronizado.
 */

/**
 * Estados de ingestión que ya no van a cambiar solos.
 *
 * Es lo que decide cuándo dejar de preguntar por un documento: sondear indefinidamente
 * quince archivos que ya terminaron es trabajo que nadie pidió.
 */
export const TERMINAL_INGESTION_STATUSES = new Set([
  "AI_INDEXED",
  "NOT_INDEXABLE",
  "ERROR",
  "UPLOAD_FAILED",
]);

export function isTerminalIngestion(status: string): boolean {
  return TERMINAL_INGESTION_STATUSES.has(status);
}

export interface BatchProgress {
  total: number;
  /**
   * Bytes ya a salvo en IUSIA. Es el número que cierra la ansiedad del abogado: el
   * archivo ya no depende de su navegador ni de su conexión.
   */
  uploaded: number;
  /** Todavía transfiriéndose. Aquí «Subiendo» significa de verdad subiendo. */
  uploading: number;
  /** Documentos que ya pueden usarse en el análisis. */
  indexed: number;
  /** Almacenados y consultables, pero fuera del RAG (imágenes, formatos no indexables). */
  notIndexable: number;
  /** Terminaron mal. Cada uno es reintentable por separado. */
  failed: number;
  /** Cargados y en proceso de inteligencia. */
  processing: number;
  /** Dejaron de avanzar. Reintentables, y NO deben contarse como «procesando». */
  stalled: number;
  /** Nada en curso: el lote ya no va a cambiar por sí solo. */
  settled: boolean;
}

/**
 * Agregado del lote a partir de los estados DERIVADOS, no de la columna cruda.
 *
 * Es la corrección de una contradicción que el abogado vio en pantalla: la cabecera
 * decía «5 archivos cargados · 5 procesando» mientras las cinco filas decían
 * «Procesamiento detenido». Las filas pasaban por `documentIntelligenceState` —que
 * aplica la regla de antigüedad— y la cabecera leía `ingestion_status` directamente.
 * Dos derivaciones del mismo dato sólo pueden coincidir por casualidad.
 *
 * Ahora ambas parten de lo mismo: quien llama deriva el estado una vez y lo pasa aquí.
 */
export function batchProgress(states: readonly string[]): BatchProgress {
  let uploading = 0;
  let indexed = 0;
  let notIndexable = 0;
  let failed = 0;
  let processing = 0;
  let stalled = 0;
  for (const state of states) {
    switch (state) {
      case "INDEXED":
      case "AI_INDEXED":
        indexed += 1;
        break;
      case "NOT_INDEXABLE":
        notIndexable += 1;
        break;
      case "ERROR":
      case "UPLOAD_FAILED":
        failed += 1;
        break;
      case "STALLED":
        stalled += 1;
        break;
      case "UPLOADING":
      case "FILE_STORED":
        uploading += 1;
        break;
      default:
        processing += 1;
    }
  }
  return {
    total: states.length,
    // Todo lo que ya no está transfiriéndose tiene sus bytes a salvo.
    uploaded: states.length - uploading,
    uploading,
    indexed,
    notIndexable,
    failed,
    stalled,
    processing,
    settled: processing === 0 && uploading === 0,
  };
}

/**
 * Frase de progreso para el abogado.
 *
 * «Preparado» significa que el documento ya no está en camino: incluye los que no son
 * indexables, porque el abogado puede abrirlos y consultarlos aunque no entren al
 * análisis. Contarlos como pendientes dejaría un lote de imágenes en «0 de 5» para
 * siempre.
 */
export function batchProgressLabel(progress: BatchProgress): string {
  if (progress.total === 0) return "Sin documentos";

  // Se cuentan por separado dos cosas que NO son la misma: tener el archivo a salvo y
  // poder analizarlo. Un lote con imágenes decía «5 de 5 preparados» y sonaba a que
  // IUSIA las había leído; no las había leído, ni va a hacerlo.
  const parts = [`${progress.total} ${progress.total === 1 ? "archivo" : "archivos"} cargados`];
  if (progress.uploading > 0) {
    return `${progress.uploaded} de ${progress.total} archivos cargados · ${progress.uploading} subiendo`;
  }
  if (progress.indexed > 0) parts.push(`${progress.indexed} indexados por IUSIA`);
  if (progress.processing > 0) parts.push(`${progress.processing} procesando`);
  if (progress.stalled > 0) {
    parts.push(
      `${progress.stalled} con procesamiento detenido`,
    );
  }
  if (progress.notIndexable > 0) {
    parts.push(`${progress.notIndexable} disponibles para consulta`);
  }
  if (progress.failed > 0) {
    parts.push(`${progress.failed} con error`);
  }
  return parts.join(" · ");
}

/**
 * Estado de un documento en lenguaje del despacho.
 *
 * Ni una palabra de la maquinaria: nada de cola, worker, índice, chunk ni OCR. El
 * abogado necesita saber si puede usarlo, no cómo se procesó.
 */
export function documentStatusLabel(ingestionStatus: string): {
  label: string;
  tone: "success" | "warning" | "critical" | "neutral";
} {
  switch (ingestionStatus) {
    case "AI_INDEXED":
      return { label: "Indexado por IUSIA", tone: "success" };
    case "NOT_INDEXABLE":
      return { label: "Vista disponible · no indexado", tone: "neutral" };
    case "ERROR":
      return { label: "Error de procesamiento", tone: "critical" };
    case "UPLOADING":
    case "FILE_STORED":
      // «Subiendo» dura EXACTAMENTE la transferencia. Antes cubría también la creación
      // de carpetas en el proveedor y la subida a Drive, y por eso se quedaba minutos.
      return { label: "Subiendo", tone: "neutral" };
    case "UPLOAD_FAILED":
      return { label: "Error al subir", tone: "critical" };
    case "UPLOADED":
      // Los bytes ya están a salvo en IUSIA; lo que sigue ocurre en segundo plano.
      return { label: "Cargado · Procesando", tone: "warning" };
    default:
      // PROCESSING y cualquier estado intermedio futuro: al abogado le basta saber que
      // está en curso. Distinguir «en cola» de «procesando» no cambia nada de lo que
      // puede hacer ahora mismo.
      return { label: "Procesando", tone: "warning" };
  }
}

/**
 * Aviso antes de convocar a IUSIA con documentos aún en proceso.
 *
 * Nunca se arranca en silencio ignorando archivos que el abogado cree incluidos: si
 * faltan, se dice cuántos y se le deja decidir. Un análisis que omite prueba sin
 * avisar es peor que uno que espera.
 */
export interface ReadinessDecision {
  /** El conjunto está completo: se puede convocar sin advertencia. */
  ready: boolean;
  statement: string;
  /** Documentos que SÍ entrarían al análisis si decide no esperar. */
  usableCount: number;
  pendingCount: number;
}

export function convocationReadiness(statuses: readonly string[]): ReadinessDecision {
  const p = batchProgress(statuses);
  const usable = p.indexed;
  if (p.total === 0) {
    return {
      ready: true,
      statement: "Este expediente no tiene documentos: el análisis se apoyará en los hechos que declares.",
      usableCount: 0,
      pendingCount: 0,
    };
  }
  // Un archivo que todavía se está subiendo cuenta como pendiente igual que uno que
  // se está procesando: en ambos casos NO entraría a la evidencia si se analiza ahora.
  const pending = p.processing + p.uploading;
  if (pending === 0) {
    return {
      ready: true,
      statement:
        p.failed > 0
          ? `${usable} de ${p.total} documentos entrarán al análisis; ${p.failed} no pudieron procesarse.`
          : `Los ${p.total} documentos del expediente están preparados.`,
      usableCount: usable,
      pendingCount: 0,
    };
  }
  return {
    ready: false,
    statement:
      `${usable} de ${p.total} documentos están preparados. ` +
      `Si analizas ahora, ${pending} quedarán fuera de la evidencia.`,
    usableCount: usable,
    pendingCount: pending,
  };
}
