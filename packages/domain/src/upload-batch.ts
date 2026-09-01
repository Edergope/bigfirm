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
]);

export function isTerminalIngestion(status: string): boolean {
  return TERMINAL_INGESTION_STATUSES.has(status);
}

export interface BatchProgress {
  total: number;
  /** Documentos que ya pueden usarse en el análisis. */
  indexed: number;
  /** Almacenados y visibles, pero fuera del RAG (imágenes, formatos no indexables). */
  notIndexable: number;
  /** Terminaron mal. Cada uno es reintentable por separado. */
  failed: number;
  /** Todavía en curso. */
  processing: number;
  /** Nada en curso: el lote ya no va a cambiar por sí solo. */
  settled: boolean;
}

export function batchProgress(statuses: readonly string[]): BatchProgress {
  let indexed = 0;
  let notIndexable = 0;
  let failed = 0;
  let processing = 0;
  for (const status of statuses) {
    if (status === "AI_INDEXED") indexed += 1;
    else if (status === "NOT_INDEXABLE") notIndexable += 1;
    else if (status === "ERROR") failed += 1;
    else processing += 1;
  }
  return {
    total: statuses.length,
    indexed,
    notIndexable,
    failed,
    processing,
    settled: processing === 0,
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
  const ready = progress.indexed + progress.notIndexable;
  if (progress.total === 0) return "Sin documentos";
  if (progress.processing > 0) {
    return `${ready} de ${progress.total} documentos preparados`;
  }
  if (progress.failed > 0) {
    const plural = progress.failed === 1 ? "documento" : "documentos";
    return `${ready} preparados · ${progress.failed} ${plural} con error`;
  }
  return `${progress.total} ${progress.total === 1 ? "documento preparado" : "documentos preparados"}`;
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
    case "FILE_STORED":
      return { label: "Subiendo", tone: "neutral" };
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
  if (p.processing === 0) {
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
      `Si analizas ahora, ${p.processing} quedarán fuera de la evidencia.`,
    usableCount: usable,
    pendingCount: p.processing,
  };
}
