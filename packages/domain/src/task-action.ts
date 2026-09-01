/**
 * Semántica de acción de una tarea del expediente.
 *
 * La estrategia de IUSIA ya produce tareas reales —12 en la última ejecución—, pero
 * eran texto con una casilla: «Enviar requerimiento escrito de incumplimiento con 30
 * días de subsanación» y una casilla de completado. Redactar ese requerimiento es
 * trabajo que el sistema YA sabe hacer, y el abogado tenía que empezarlo desde cero en
 * otra pantalla, volviendo a explicar un contexto que IUSIA ya conoce.
 *
 * Esto NO es un segundo sistema de tareas: extiende el contrato existente con dos
 * campos, y la generación reutiliza el mismo Document Engine, el mismo Template
 * Registry y el mismo agente 08 que la ruta manual.
 */

/**
 * Qué CLASE de actuación jurídica representa la tarea.
 *
 * Determina la acción primaria que se ofrece. No es una etiqueta decorativa: una tarea
 * de recolección de prueba y una de redacción se atienden de formas distintas, y
 * ofrecer «Generar borrador» en la primera invita a fabricar lo que hay que conseguir.
 */
export const TASK_ACTION_TYPES = [
  "DOCUMENT_DRAFT",
  "EVIDENCE_COLLECTION",
  "LEGAL_RESEARCH",
  "LEGAL_ANALYSIS",
  "CLIENT_ACTION",
  "FILING",
  "INTERNAL_REVIEW",
  "OTHER",
] as const;
export type TaskActionType = (typeof TASK_ACTION_TYPES)[number];

export function isTaskActionType(value: string): value is TaskActionType {
  return (TASK_ACTION_TYPES as readonly string[]).includes(value);
}

/**
 * Qué documento hay que producir, cuando la tarea es de redacción.
 *
 * Es semántica del sistema, no una lista que el abogado escoja: se usa para seleccionar
 * la plantilla oficial. Sin intención documental no se elige plantilla, y sin plantilla
 * no se genera —nunca se cae a un DOCX genérico.
 */
export const DOCUMENT_INTENTS = [
  "REQUIREMENT",
  "NOTICE",
  "LEGAL_OPINION",
  "CONTRACT",
  "CLAIM",
  "RESPONSE",
  "APPEAL",
  "MEMORANDUM",
  "MINUTES",
  "POWER_OF_ATTORNEY",
  "OTHER",
] as const;
export type DocumentIntent = (typeof DOCUMENT_INTENTS)[number];

export function isDocumentIntent(value: string): value is DocumentIntent {
  return (DOCUMENT_INTENTS as readonly string[]).includes(value);
}

/** Sólo esta clase de tarea produce un documento. */
export function producesDocument(actionType: string | null | undefined): boolean {
  return actionType === "DOCUMENT_DRAFT";
}

/**
 * Acción primaria que la tarjeta de la tarea ofrece, en lenguaje del despacho.
 *
 * `kind` es la clave estable que consume la UI; `label` es lo que lee el abogado.
 */
export interface TaskPrimaryAction {
  kind: "GENERATE_DRAFT" | "OPEN_DRAFT" | "ATTACH_EVIDENCE" | "RESEARCH" | "ANALYZE" | "LOG_ACTION" | "PREPARE_FILING" | "REVIEW" | "OPEN_DETAIL";
  label: string;
}

export function taskPrimaryAction(task: {
  actionType?: string | null;
  generatedDocumentId?: string | null;
  status?: string | null;
}): TaskPrimaryAction {
  if (producesDocument(task.actionType)) {
    // Generado ya: la acción deja de ser producirlo y pasa a ser leerlo.
    return task.generatedDocumentId
      ? { kind: "OPEN_DRAFT", label: "Abrir borrador" }
      : { kind: "GENERATE_DRAFT", label: "Generar borrador" };
  }
  switch (task.actionType) {
    case "EVIDENCE_COLLECTION":
      return { kind: "ATTACH_EVIDENCE", label: "Adjuntar evidencia" };
    case "LEGAL_RESEARCH":
      return { kind: "RESEARCH", label: "Investigar con IUSIA" };
    case "LEGAL_ANALYSIS":
      return { kind: "ANALYZE", label: "Analizar" };
    case "CLIENT_ACTION":
      return { kind: "LOG_ACTION", label: "Registrar gestión" };
    case "FILING":
      return { kind: "PREPARE_FILING", label: "Preparar radicación" };
    case "INTERNAL_REVIEW":
      return { kind: "REVIEW", label: "Revisar" };
    default:
      return { kind: "OPEN_DETAIL", label: "Abrir detalle" };
  }
}

/** Cómo se nombra la clase de tarea ante el abogado. Nunca se muestra el enum. */
export const TASK_ACTION_LABEL: Record<TaskActionType, string> = {
  DOCUMENT_DRAFT: "Redacción",
  EVIDENCE_COLLECTION: "Prueba",
  LEGAL_RESEARCH: "Investigación",
  LEGAL_ANALYSIS: "Análisis",
  CLIENT_ACTION: "Gestión con el cliente",
  FILING: "Radicación",
  INTERNAL_REVIEW: "Revisión interna",
  OTHER: "Actuación",
};

/**
 * Tipo de documento del Template Registry para una intención documental.
 *
 * La correspondencia es explícita: si no hay tipo para la intención, NO se inventa uno
 * y la generación falla con `TEMPLATE_NOT_FOUND`, que es lo que el abogado necesita
 * saber. Un borrador con la plantilla equivocada es peor que ningún borrador.
 */
const DOCUMENT_TYPE_BY_INTENT: Record<DocumentIntent, string | null> = {
  REQUIREMENT: "REQUERIMIENTO",
  NOTICE: "COMUNICACION",
  LEGAL_OPINION: "OPINION_LEGAL",
  CONTRACT: "CONTRATO",
  CLAIM: "DEMANDA",
  RESPONSE: "CONTESTACION",
  APPEAL: "RECURSO",
  MEMORANDUM: "MEMORANDO",
  MINUTES: "ACTA",
  POWER_OF_ATTORNEY: "PODER",
  OTHER: null,
};

export function documentTypeForIntent(intent: string | null | undefined): string | null {
  if (!intent || !isDocumentIntent(intent)) return null;
  return DOCUMENT_TYPE_BY_INTENT[intent];
}

// ─────────────────────────── Ciclo de vida ───────────────────────────

/**
 * Estados de una tarea documental.
 *
 * Se apoyan en el `status` que la tabla ya tiene (`PENDIENTE` por defecto) y añaden los
 * intermedios que el ciclo documental necesita. No sustituyen al ciclo de revisión del
 * documento: la tarea sigue el trabajo, el documento sigue su propia versión.
 */
export const TASK_STATUSES = [
  "PENDIENTE",
  "BORRADOR_GENERANDO",
  "BORRADOR_LISTO",
  "EN_REVISION",
  "COMPLETADA",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Sólo este estado significa COMPLETADA. La casilla no puede decir otra cosa. */
export function isTaskCompleted(status: string | null | undefined): boolean {
  return status === "COMPLETADA";
}

/**
 * Estado tras generar un borrador.
 *
 * Generar NO cierra la tarea. El borrador es trabajo hecho por IUSIA; enviarlo, firmarlo
 * o darlo por bueno es una decisión del abogado, y cerrar la tarea automáticamente le
 * quitaría esa decisión sin que nadie la haya tomado.
 */
export function statusAfterDraftGenerated(): TaskStatus {
  return "BORRADOR_LISTO";
}

/** Agrupación de la pestaña del expediente. Cuatro columnas de lectura, no un Kanban. */
export const TASK_GROUPS = ["todo", "in_progress", "review", "done"] as const;
export type TaskGroup = (typeof TASK_GROUPS)[number];

export const TASK_GROUP_LABEL: Record<TaskGroup, string> = {
  todo: "Para hacer",
  in_progress: "En curso",
  review: "Listo para revisar",
  done: "Completadas",
};

export function taskGroupOf(status: string | null | undefined): TaskGroup {
  switch (status) {
    case "COMPLETADA":
      return "done";
    case "EN_REVISION":
    case "BORRADOR_LISTO":
      return "review";
    case "BORRADOR_GENERANDO":
      return "in_progress";
    default:
      return "todo";
  }
}
