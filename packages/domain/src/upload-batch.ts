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
  /** Cargados y esperando turno. Nadie los ha tomado todavía. */
  queued: number;
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
  let queued = 0;
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
      case "DELIVERY_FAILED":
        // Que la preparación no llegara a empezar es un fallo con todas las letras: el
        // documento no va a avanzar solo y hay que reintentarlo.
        failed += 1;
        break;
      case "STALLED":
      case "PROCESSING_STALLED":
        stalled += 1;
        break;
      case "INDEXING_DELAYED":
        // Va lento, no está roto: el documento está entero en el proveedor y IUSIA
        // sigue comprobándolo. Cuenta como trabajo en curso —todavía puede entrar al
        // análisis— y NUNCA como detenido, que es lo que obligaría al abogado a
        // reintentar algo que él no puede arreglar.
        processing += 1;
        break;
      case "QUEUED":
        // A salvo y esperando turno. Cuenta como cargado y como pendiente, nunca como
        // trabajo en curso: nadie lo ha tomado todavía.
        queued += 1;
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
    queued,
    processing,
    // El lote sigue vivo mientras algo se transfiera, espere turno o se esté
    // procesando. Un lote donde todo falló también está asentado: no cambiará solo.
    settled: processing === 0 && uploading === 0 && queued === 0,
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
  if (progress.queued > 0) parts.push(`${progress.queued} en preparación`);
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
    case "INDEXING":
      // Subido al índice, pendiente de confirmar que se recupera. Para el abogado es
      // proceso en curso; el estado sólo avanza cuando una recuperación real responde.
      return { label: "Procesando", tone: "warning" };
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
  /** Total de documentos del expediente. `usable + excludedNow` siempre lo iguala. */
  total: number;
  /**
   * Documentos que SÍ entrarían al análisis si decide no esperar.
   *
   * Es exactamente el tamaño del conjunto que el servidor congela al arrancar
   * (`freezeEvidenceSet`), y es el número que rotula el botón. Que estas tres cuentas
   * fueran independientes es como el botón llegó a ofrecer «Analizar los 6 preparados»
   * mientras el mensaje hablaba de un solo documento excluido sobre nueve.
   */
  usableCount: number;
  /** De los excluidos, los que TODAVÍA podrían entrar si espera. */
  pendingCount: number;
  /** Todo lo que no entra hoy: los que aún pueden más los que nunca podrán. */
  excludedNow: number;
  /** Se conservan y se consultan, pero su formato los deja fuera del análisis. */
  viewOnlyCount: number;
}

export function convocationReadiness(statuses: readonly string[]): ReadinessDecision {
  const p = batchProgress(statuses);
  const usable = p.indexed;

  if (p.total === 0) {
    return {
      ready: true,
      statement:
        "Este expediente no tiene documentos: el análisis se apoyará en los hechos que declares.",
      total: 0,
      usableCount: 0,
      pendingCount: 0,
      excludedNow: 0,
      viewOnlyCount: 0,
    };
  }

  /*
    LA CUENTA TIENE QUE CUADRAR.

    La frase anterior decía «6 de 9 documentos están preparados. Si analizas ahora, 1
    quedarán fuera de la evidencia» sobre un expediente con 6 indexados, 1 procesando y 2
    no indexables. Los dos no indexables no aparecían ni entre los preparados ni entre los
    que quedaban fuera: sencillamente no existían para el mensaje, y 6 + 1 no suman 9.

    Un abogado que lee eso no puede saber sobre qué va a trabajar IUSIA. Ahora cada
    documento del expediente cae en exactamente una de tres categorías —entra, todavía
    puede entrar, o no va a entrar nunca— y las tres se enuncian.
  */
  const willNeverEnter = p.notIndexable + p.failed + p.stalled;
  const stillCould = p.processing + p.queued + p.uploading;

  const excluded: string[] = [];
  if (p.notIndexable > 0) {
    excluded.push(
      `${p.notIndexable} ${p.notIndexable === 1 ? "no es analizable" : "no son analizables"} por su formato`,
    );
  }
  if (p.failed > 0) {
    excluded.push(`${p.failed} no ${p.failed === 1 ? "pudo" : "pudieron"} procesarse`);
  }
  if (p.stalled > 0) {
    excluded.push(`${p.stalled} ${p.stalled === 1 ? "quedó" : "quedaron"} a medio procesar`);
  }
  const excludedPhrase = excluded.length > 0 ? ` ${excluded.join(" y ")}.` : "";

  if (stillCould === 0) {
    return {
      ready: true,
      statement:
        willNeverEnter === 0
          ? `Los ${p.total} documentos del expediente están preparados.`
          : `${usable} de ${p.total} documentos entrarán al análisis:${excludedPhrase}`,
      total: p.total,
      usableCount: usable,
      pendingCount: 0,
      excludedNow: willNeverEnter,
      viewOnlyCount: p.notIndexable,
    };
  }

  return {
    ready: false,
    statement:
      `${usable} de ${p.total} documentos están preparados. ` +
      `Si analizas ahora, ${stillCould} ${stillCould === 1 ? "seguirá" : "seguirán"} sin estar listo ` +
      `y ${stillCould === 1 ? "quedará" : "quedarán"} fuera de la evidencia.${excludedPhrase}`,
    total: p.total,
    usableCount: usable,
    pendingCount: stillCould,
    excludedNow: stillCould + willNeverEnter,
    viewOnlyCount: p.notIndexable,
  };
}

/**
 * Archivos que se admiten en UNA operación de carga.
 *
 * El formulario de alta recortaba la selección con `slice(0, 10)` sin decir nada. En la
 * prueba real se seleccionaron 17 documentos y sólo llegaron 10 al servidor: siete se
 * descartaron en el navegador antes de que la petición saliera, y la auditoría registró
 * `count: 10` como si eso fuera lo que el abogado había pedido.
 *
 * El límite existe —una sola petición multiparte no puede crecer sin fin— pero tiene que
 * ser explícito, compartido por cliente y servidor, y NUNCA silencioso. El techo cubre
 * con margen el objetivo de producto de 15 documentos por expediente.
 */
export const MAX_FILES_PER_UPLOAD = 25;

export interface FileSelection {
  /** Los que entran en esta carga. */
  accepted: number;
  /** Los que NO caben. Cero significa que no se descartó nada. */
  rejected: number;
  /** Qué decirle al abogado. `null` cuando la selección cabe entera. */
  notice: string | null;
}

/**
 * Decide qué archivos entran y qué se le dice al abogado.
 *
 * Nunca devuelve un recorte mudo: si sobran archivos, el aviso los nombra en número para
 * que la decisión de cuáles quitar sea suya y no del componente.
 */
export function planFileSelection(
  fileNames: readonly string[],
  limit = MAX_FILES_PER_UPLOAD,
): FileSelection {
  if (fileNames.length <= limit) {
    return { accepted: fileNames.length, rejected: 0, notice: null };
  }
  const rejected = fileNames.length - limit;
  return {
    accepted: limit,
    rejected,
    notice:
      `Seleccionaste ${fileNames.length} archivos y en una sola carga caben ${limit}. ` +
      `${rejected === 1 ? "Queda 1 fuera" : `Quedan ${rejected} fuera`}: quita los que no necesites ahora ` +
      "o adjunta el resto en una segunda carga.",
  };
}

/**
 * Qué le pasó a cada archivo que el abogado pidió subir.
 *
 * En el lote de 17 el servidor respondió `count: 10, failed: 0` y sólo se crearon
 * nueve filas. Los dos números eran ciertos y aun así el informe era falso: `failed`
 * contaba únicamente `UPLOAD_FAILED`, y un archivo rechazado por formato o unificado
 * con otro idéntico no es ninguna de esas cosas. La respuesta por archivo existía y
 * nadie la miraba; nada quedaba escrito, así que la reconstrucción posterior no pudo
 * decidir cuál de los dos caminos tomó el décimo.
 *
 * Ahora todo archivo pedido termina en exactamente una de estas casillas, y la suma de
 * las cinco es el número que el abogado seleccionó.
 */
export interface UploadOutcome {
  name: string;
  status: string;
  deduplicated?: boolean;
}

export interface UploadAccounting {
  requested: number;
  accepted: number;
  duplicate: number;
  unsupported: number;
  failed: number;
  /** Nombres de lo que no entró, para poder decirlo archivo por archivo. */
  duplicateNames: string[];
  unsupportedNames: string[];
  failedNames: string[];
}

export function accountUploads(results: readonly UploadOutcome[]): UploadAccounting {
  const acc: UploadAccounting = {
    requested: results.length,
    accepted: 0,
    duplicate: 0,
    unsupported: 0,
    failed: 0,
    duplicateNames: [],
    unsupportedNames: [],
    failedNames: [],
  };
  for (const r of results) {
    if (r.deduplicated) {
      acc.duplicate += 1;
      acc.duplicateNames.push(r.name);
    } else if (r.status === "UNSUPPORTED") {
      acc.unsupported += 1;
      acc.unsupportedNames.push(r.name);
    } else if (r.status === "UPLOAD_FAILED") {
      acc.failed += 1;
      acc.failedNames.push(r.name);
    } else {
      acc.accepted += 1;
    }
  }
  return acc;
}

/**
 * El resultado dicho en una frase, sin celebrar de más.
 *
 * «Subida completada» sobre diecisiete archivos de los que llegaron nueve es la clase
 * de mensaje que hace que un abogado descubra la pérdida tres días después, en la
 * audiencia. Si algo no entró, se nombra.
 */
export function uploadAccountingStatement(acc: UploadAccounting): string {
  if (acc.requested === 0) return "No seleccionaste ningún archivo.";
  if (acc.accepted === acc.requested) {
    return acc.requested === 1
      ? "El documento se guardó en el expediente."
      : `Los ${acc.requested} documentos se guardaron en el expediente.`;
  }

  const partes: string[] = [];
  partes.push(
    acc.accepted === 1
      ? "1 documento se guardó en el expediente"
      : `${acc.accepted} documentos se guardaron en el expediente`,
  );
  if (acc.duplicate > 0) {
    partes.push(
      acc.duplicate === 1
        ? `1 ya estaba en el expediente (${acc.duplicateNames[0]})`
        : `${acc.duplicate} ya estaban en el expediente`,
    );
  }
  if (acc.unsupported > 0) {
    partes.push(
      acc.unsupported === 1
        ? `1 no se admite por su formato (${acc.unsupportedNames[0]})`
        : `${acc.unsupported} no se admiten por su formato`,
    );
  }
  if (acc.failed > 0) {
    partes.push(
      acc.failed === 1
        ? `1 no pudo subirse (${acc.failedNames[0]})`
        : `${acc.failed} no pudieron subirse`,
    );
  }
  return `De ${acc.requested} archivos: ${partes.join("; ")}.`;
}
