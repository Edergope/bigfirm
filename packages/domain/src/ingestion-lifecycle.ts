/**
 * Ciclo de vida de la ingestión de un documento.
 *
 * EL DEFECTO QUE ORIGINA ESTE MÓDULO. El abogado pulsó «Reintentar» sobre
 * `CC JFRR.pdf`, la pantalla dijo «Reintentando…» y el documento volvió a
 * «Procesamiento detenido». La fila en D1 no se tocó: su `updated_at` seguía siendo el
 * segundo de la carga original. El endpoint había devuelto 409 y nadie lo mostró.
 *
 * La razón es que había DOS definiciones de «reintentable». La pantalla ofrecía el
 * botón a partir del estado DERIVADO —`STALLED`, calculado por antigüedad—, y el
 * servidor lo validaba contra la COLUMNA CRUDA, que decía `PROCESSING`. Dos
 * derivaciones del mismo concepto sólo coinciden por casualidad; ésta no coincidía.
 *
 * Aquí vive la única definición. La usan la pantalla y el endpoint, así que el botón
 * no puede ofrecer algo que el servidor vaya a rechazar.
 *
 * LA SEGUNDA CORRECCIÓN, más de fondo: `PROCESSING` se escribía al ENCOLAR. Un
 * documento que ningún consumidor había tocado se presentaba como «Procesando», y
 * cuando pasaban diez minutos se declaraba «Procesamiento detenido» — un trabajo que
 * jamás empezó descrito como un trabajo que se paró. Ahora encolar y procesar son
 * estados distintos, y sólo se llama detenido a lo que de verdad arrancó.
 */

export const INGESTION_LIFECYCLE = [
  /** Los bytes viajan del navegador a IUSIA. */
  "UPLOADING",
  /** La transferencia se interrumpió: el archivo NO llegó. */
  "UPLOAD_FAILED",
  /** A salvo y encolado. Ningún consumidor lo ha tomado todavía. */
  "QUEUED",
  /** Encolado hace demasiado sin que nadie lo tomara. NO es «detenido». */
  "DELIVERY_FAILED",
  /** Un consumidor lo tomó y sigue dando señales. */
  "PROCESSING",
  /** Un consumidor lo tomó y dejó de dar señales. */
  "PROCESSING_STALLED",
  /**
   * Subido al índice, y el proveedor tarda más de lo habitual en terminar.
   *
   * NO es un fallo y NO es trabajo detenido: el documento está entero en el proveedor,
   * con su identidad de item, y IUSIA sigue preguntando por él —más despacio, porque
   * preguntar cada minuto durante una hora no acelera nada—. Es el estado que faltaba:
   * sin él, una lentitud del proveedor se presentaba al abogado como avería suya y con
   * un botón de «Reintentar» que no arreglaba nada y sí volvía a subirlo todo.
   */
  "INDEXING_DELAYED",
  /** Disponible para el análisis. */
  "INDEXED",
  /** Almacenado y consultable, fuera del RAG. */
  "NOT_INDEXABLE",
  /** Falló una etapa del procesamiento. */
  "ERROR",
] as const;
export type IngestionLifecycle = (typeof INGESTION_LIFECYCLE)[number];

/**
 * Margen sin señales de vida antes de dar por detenido un trabajo YA EMPEZADO.
 * Se mide contra el latido, no contra la hora de carga.
 */
export const PROCESSING_STALL_MINUTES = 10;

/**
 * Margen para que la cola entregue un mensaje a algún consumidor.
 *
 * Es un problema DISTINTO de que el procesamiento se atasque, y por eso tiene su propio
 * umbral y su propio nombre: aquí no ha empezado nada, así que no hay nada que se haya
 * «detenido». Más corto que el de procesamiento porque entregar es inmediato cuando
 * funciona: cinco minutos sin que nadie lo tome ya es anómalo.
 */
export const QUEUE_DELIVERY_MINUTES = 5;

/**
 * Comprobaciones tras las cuales la indexación se considera demorada, no detenida.
 *
 * Debe coincidir con `INDEX_CONFIRM_MAX_ATTEMPTS` del servidor. Vive aquí porque la
 * pantalla y el endpoint de reintento tienen que leer el mismo número: que fueran dos
 * es como el botón «Reintentar» llegó a ofrecerse sobre documentos perfectamente sanos.
 */
export const INDEX_CONFIRM_EXHAUSTED_AT = 12;

export interface IngestionSignals {
  /** Columna `ingestion_status`. */
  status: string;
  /** Veces que un consumidor SELLÓ haber recibido el mensaje. 0 = nunca lo tomó. */
  attempts: number;
  /** Última señal de vida del trabajo de fondo. */
  heartbeatAt?: string | null;
  /** Cuándo se puso el mensaje en la cola. */
  enqueuedAt?: string | null;
  /** Etapa interna del procesamiento. Orientativa: cualquier latido la sobrescribe. */
  stage?: string | null;
  /**
   * Comprobaciones de indexación ya hechas. Es la señal FIABLE de que la cadena rápida
   * se agotó: sólo crece, y ningún otro trabajo la pisa.
   */
  confirmAttempts?: number | null;
  updatedAt?: string | null;
}

/**
 * Estado real, derivado de las señales que el servidor persiste.
 *
 * `attempts` es la señal decisiva y por eso el consumidor la sella antes de tocar
 * ninguna dependencia externa: mientras valga 0, ningún consumidor ha empezado, y
 * llamar «Procesando» a eso era describir trabajo que no existía.
 */
export function ingestionLifecycle(
  signals: IngestionSignals,
  now: Date = new Date(),
): IngestionLifecycle {
  const { status, attempts } = signals;

  // Estados terminales: no dependen del tiempo ni de la cola.
  if (status === "AI_INDEXED") return "INDEXED";
  if (status === "NOT_INDEXABLE") return "NOT_INDEXABLE";
  if (status === "ERROR") return "ERROR";
  if (status === "UPLOAD_FAILED") return "UPLOAD_FAILED";
  if (status === "UPLOADING" || status === "FILE_STORED") return "UPLOADING";
  const olderThan = (iso: string | null | undefined, minutes: number): boolean => {
    if (!iso) return false;
    const since = now.getTime() - Date.parse(iso);
    return Number.isFinite(since) && since > minutes * 60_000;
  };

  /*
    Subido al índice, pendiente de confirmar que se recupera.

    Esto devolvía «Procesando» sin mirar nada más, y por eso un DOCX de ocho páginas
    llevaba ocho minutos —y al escribir esto, más de una hora— con el mismo rótulo
    tranquilizador. Su fila lo decía todo: etapa `INDEXING_DELAYED`, sin fecha de
    próxima confirmación y sin código de fallo. Nadie iba a volver a por él nunca, y la
    pantalla no ofrecía «Reintentar» porque, según ella, seguía trabajando.

    Un trabajo que dejó de dar señales es un trabajo detenido, esté en la etapa que
    esté. `INDEXING` se mide contra el latido igual que el resto.
  */
  if (status === "INDEXING") {
    if (attempts < 1) return "QUEUED";
    /*
      LA DISTINCIÓN QUE FALTABA.

      Un documento subido al índice puede estar en dos situaciones muy distintas, y
      hasta ahora se llamaban igual. Si la cadena de confirmación se agotó —doce
      preguntas sin respuesta afirmativa— el sistema se rendía: escribía la etapa
      `INDEXING_DELAYED`, dejaba `index_confirm_next_at` en nulo y no volvía nunca. Lo
      vi ocurrir en directo con cuatro documentos del lote de 19.

      Ahora esa etapa significa lo que dice: el proveedor va lento, IUSIA sigue
      comprobando a baja frecuencia, y NO se le pide al abogado que repare nada. Sólo
      es «detenido» lo que no tiene ningún trabajo futuro.
    */
    /*
      LA SEÑAL TIENE QUE SER LA QUE NO SE PISA.

      Primero usé la etapa, y era frágil: `ingestion_stage` lo reescribe CUALQUIER
      latido posterior. Lo comprobé sobre los cuatro documentos varados del lote de 19,
      que decían `FINAL_STORAGE` porque una sincronización con el proveedor había pasado
      por encima horas después de que la cadena de confirmación se agotara.

      El número de comprobaciones sólo crece y nadie más lo toca.
    */
    if ((signals.confirmAttempts ?? 0) >= INDEX_CONFIRM_EXHAUSTED_AT) return "INDEXING_DELAYED";
    if (signals.stage === "INDEXING_DELAYED") return "INDEXING_DELAYED";
    return olderThan(signals.heartbeatAt ?? signals.updatedAt, PROCESSING_STALL_MINUTES)
      ? "PROCESSING_STALLED"
      : "PROCESSING";
  }

  if (attempts < 1) {
    // Nadie lo ha tomado. Si lleva demasiado esperando, el fallo es de ENTREGA.
    return olderThan(signals.enqueuedAt ?? signals.updatedAt, QUEUE_DELIVERY_MINUTES)
      ? "DELIVERY_FAILED"
      : "QUEUED";
  }

  // Empezó de verdad: aquí sí tiene sentido hablar de trabajo detenido, y se mide
  // contra el latido —no contra la hora de carga, que no dice nada del trabajo—.
  return olderThan(signals.heartbeatAt ?? signals.updatedAt, PROCESSING_STALL_MINUTES)
    ? "PROCESSING_STALLED"
    : "PROCESSING";
}

/**
 * Estados desde los que reintentar tiene sentido.
 *
 * ÚNICA definición: la consumen la pantalla —para ofrecer el botón— y el endpoint
 * —para aceptarlo—. Que fueran dos listas distintas es lo que hizo que «Reintentar»
 * devolviera un 409 silencioso.
 */
export function canRetryIngestion(state: IngestionLifecycle): boolean {
  // `INDEXING_DELAYED` NO está aquí, deliberadamente. Reintentar mientras el proveedor
  // sigue trabajando vuelve a subir el documento, deja el item anterior obsoleto y
  // reinicia la cuenta: es exactamente el bucle que dejó un DOCX en 19 confirmaciones
  // sin converger. El abogado no tiene que reparar la lentitud de un proveedor.
  return (
    state === "ERROR" ||
    state === "UPLOAD_FAILED" ||
    state === "DELIVERY_FAILED" ||
    state === "PROCESSING_STALLED"
  );
}

/** ¿Sigue en movimiento? Decide si la pantalla debe seguir consultando. */
export function isIngestionInFlight(state: IngestionLifecycle): boolean {
  return (
    state === "UPLOADING"
    || state === "QUEUED"
    || state === "PROCESSING"
    // Sigue en movimiento, sólo que despacio: la pantalla debe seguir consultando.
    || state === "INDEXING_DELAYED"
  );
}

/**
 * Cómo se le dice al abogado. Ni una palabra de la maquinaria: nada de cola, mensaje,
 * consumidor, worker ni reintento de entrega.
 */
export const INGESTION_LIFECYCLE_TERMS: Record<
  IngestionLifecycle,
  { label: string; hint: string; tone: "info" | "success" | "neutral" | "critical" | "warning" }
> = {
  UPLOADING: {
    label: "Subiendo",
    hint: "El archivo se está transfiriendo a IUSIA.",
    tone: "neutral",
  },
  UPLOAD_FAILED: {
    label: "Error al subir",
    hint: "El archivo no llegó completo. Puedes volver a intentarlo.",
    tone: "critical",
  },
  QUEUED: {
    label: "Cargado · pendiente de procesamiento",
    hint: "El archivo ya está guardado en IUSIA y espera turno para prepararse.",
    tone: "info",
  },
  DELIVERY_FAILED: {
    label: "No fue posible iniciar el procesamiento",
    hint: "El archivo está guardado, pero su preparación no llegó a comenzar. Puedes reintentarla.",
    tone: "critical",
  },
  PROCESSING: {
    label: "Procesando",
    hint: "IUSIA está leyendo el documento.",
    tone: "info",
  },
  PROCESSING_STALLED: {
    label: "Procesamiento detenido",
    hint: "La preparación se interrumpió a mitad. Puedes reintentarla.",
    tone: "warning",
  },
  INDEXING_DELAYED: {
    label: "Indexación demorada",
    hint: "El documento está a salvo y en preparación. Está tardando más de lo habitual; IUSIA sigue comprobándolo y no necesitas hacer nada.",
    tone: "info",
  },
  INDEXED: {
    label: "Indexado por IUSIA",
    hint: "Disponible para el análisis: IUSIA puede citarlo como evidencia.",
    tone: "success",
  },
  NOT_INDEXABLE: {
    label: "Vista disponible · no indexado",
    hint: "Se conserva en el expediente, pero su formato no permite usarlo como evidencia.",
    tone: "neutral",
  },
  ERROR: {
    label: "Error de procesamiento",
    hint: "No pudo prepararse para el análisis. Puedes reintentarlo.",
    tone: "critical",
  },
};
