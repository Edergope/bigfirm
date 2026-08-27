/**
 * LEGAL_UI_TERMINOLOGY_MAP — el idioma que lee el abogado.
 *
 * Los enums del dominio son contratos con el servidor y NO se tocan: `INTAKE`
 * gobierna routing, `HIGH_STAKES` gobierna gates obligatorios. Lo que se corrige
 * aquí es que esos identificadores estaban llegando crudos a la interfaz, y
 * "En intake" o "HIGH_STAKES" no son términos que un abogado colombiano use para
 * describir su propio expediente.
 *
 * Criterio de traducción: NO se traduce literalmente del inglés; se elige el
 * término que un despacho usa de verdad. `HIGH_STAKES` no es "altas apuestas"
 * sino la criticidad que obliga a más control. `INTAKE` no es "admisión" sino la
 * fase de estudio inicial del caso.
 *
 * Cada entrada lleva `hint` cuando el nombre por sí solo no basta para decidir.
 */

export interface TermPresentation {
  label: string;
  hint?: string;
  tone: "neutral" | "info" | "intel" | "success" | "warning" | "critical" | "gold";
}

/** Estado jurídico del expediente. */
export const MATTER_STATUS_TERMS: Record<string, TermPresentation> = {
  INTAKE: {
    label: "En estudio inicial",
    hint: "Se está encuadrando el caso: hechos, partes y objetivo.",
    tone: "info",
  },
  ACTIVE: { label: "En curso", hint: "Trabajo jurídico activo.", tone: "intel" },
  WAITING_CLIENT: {
    label: "Esperando al cliente",
    hint: "El avance depende de información o instrucción del cliente.",
    tone: "warning",
  },
  IN_REVIEW: { label: "En revisión", hint: "Pendiente de revisión interna.", tone: "info" },
  ON_HOLD: { label: "Suspendido", hint: "Detenido por decisión o causa externa.", tone: "warning" },
  CLOSED: { label: "Cerrado", tone: "success" },
  ARCHIVED: { label: "Archivado", tone: "neutral" },
};

/**
 * Materialidad. Gobierna cuántos especialistas intervienen y qué controles son
 * obligatorios, así que se nombra por lo que exige, no por su etiqueta interna.
 */
export const MATERIALITY_TERMS: Record<string, TermPresentation> = {
  SIMPLE: { label: "Ordinario", hint: "Trámite estándar.", tone: "neutral" },
  MATERIAL: { label: "Relevante", hint: "Exige análisis y control reforzado.", tone: "info" },
  HIGH_STAKES: {
    label: "Alta criticidad",
    hint: "Máximo control: intervienen más especialistas y se exigen validaciones.",
    tone: "gold",
  },
};

/** Riesgo del expediente. */
export const RISK_TERMS: Record<string, TermPresentation> = {
  LOW: { label: "Riesgo bajo", tone: "success" },
  MEDIUM: { label: "Riesgo medio", tone: "warning" },
  HIGH: { label: "Riesgo alto", tone: "critical" },
  CRITICAL: { label: "Riesgo crítico", tone: "critical" },
  UNASSESSED: { label: "Sin evaluar", tone: "neutral" },
};

/**
 * Análisis de IUSIA en lenguaje de encargo.
 *
 * "FAILED" o "CANCELLED" describen un proceso; el abogado necesita saber qué
 * pasó con SU encargo. "Con incidencias" y "Detenido" dicen eso.
 */
export const ANALYSIS_TERMS: Record<string, TermPresentation> = {
  PENDING: { label: "En cola", tone: "neutral" },
  WAITING: { label: "En espera", tone: "neutral" },
  RUNNING: { label: "En curso", tone: "intel" },
  COMPLETED: { label: "Completado", tone: "success" },
  CANCELLED: { label: "Detenido", hint: "Se interrumpió antes de concluir.", tone: "neutral" },
  FAILED: { label: "Con incidencias", hint: "No llegó a emitir conclusión.", tone: "critical" },
  BLOCKED: { label: "Bloqueado", hint: "No puede avanzar por sí solo.", tone: "warning" },
};

/** Papel de una persona DENTRO de un expediente concreto. */
export const MATTER_ROLE_TERMS: Record<string, TermPresentation> = {
  OWNER: { label: "Abogado líder", hint: "Dirige el expediente.", tone: "info" },
  COLLABORATOR: { label: "Abogado colaborador", tone: "neutral" },
  REVIEWER: { label: "Revisor", tone: "neutral" },
  ASSISTANT: { label: "Asistente", tone: "neutral" },
  EXTERNAL: { label: "Abogado externo", hint: "Ajeno a la firma.", tone: "warning" },
  READ_ONLY: { label: "Consulta", tone: "neutral" },
};

/** Tareas y términos procesales. */
export const TASK_STATUS_TERMS: Record<string, TermPresentation> = {
  PENDIENTE: { label: "Pendiente", tone: "neutral" },
  EN_CURSO: { label: "En curso", tone: "info" },
  COMPLETADA: { label: "Completada", tone: "success" },
  CANCELADA: { label: "Cancelada", tone: "neutral" },
};

export const TASK_KIND_TERMS: Record<string, TermPresentation> = {
  TASK: { label: "Tarea", tone: "neutral" },
  PROCEDURAL_DEADLINE: { label: "Término procesal", tone: "warning" },
  HEARING: { label: "Audiencia", tone: "info" },
};

/** Estado de una invitación al despacho. */
export const INVITATION_TERMS: Record<string, TermPresentation> = {
  pending: { label: "Pendiente", tone: "info" },
  accepted: { label: "Aceptada", tone: "success" },
  rejected: { label: "Rechazada", tone: "neutral" },
  canceled: { label: "Cancelada", tone: "neutral" },
  expired: { label: "Caducada", tone: "neutral" },
};

/** Áreas de práctica, para no mostrar `COMERCIAL_CONTRACTUAL` en pantalla. */
export const PRACTICE_AREA_TERMS: Record<string, string> = {
  CIVIL: "Civil",
  COMERCIAL_CONTRACTUAL: "Comercial y contractual",
  SOCIETARIO_MA: "Societario y M&A",
  LABORAL: "Laboral",
  TRIBUTARIO: "Tributario",
  PENAL_ECONOMICO: "Penal económico",
  ADMINISTRATIVO: "Administrativo",
  CONSTITUCIONAL: "Constitucional",
  FAMILIA: "Familia",
  INMOBILIARIO: "Inmobiliario",
  PROPIEDAD_INTELECTUAL: "Propiedad intelectual",
  INSOLVENCIA: "Insolvencia",
  MIGRATORIO: "Migratorio",
  FINANCIERO: "Financiero",
  COMPLIANCE: "Cumplimiento",
  OTRO: "Otra",
};

/** Estado de una integración técnica (Control IUSIA). */
export const INTEGRATION_TERMS: Record<string, TermPresentation> = {
  CONNECTED: { label: "Conectada", tone: "success" },
  NOT_CONFIGURED: { label: "Sin configurar", tone: "neutral" },
  ERROR: { label: "Con error", tone: "critical" },
};

/**
 * Resuelve un término, devolviendo el identificador crudo si no hay traducción.
 * Nunca inventa: un enum nuevo se ve tal cual y así se detecta que falta mapearlo.
 */
export function term(
  map: Record<string, TermPresentation>,
  key: string | null | undefined,
): TermPresentation {
  if (!key) return { label: "—", tone: "neutral" };
  return map[key] ?? { label: key, tone: "neutral" };
}

export const matterStatusTerm = (k?: string | null) => term(MATTER_STATUS_TERMS, k);
export const materialityTerm = (k?: string | null) => term(MATERIALITY_TERMS, k);
export const riskTerm = (k?: string | null) => term(RISK_TERMS, k);
export const analysisTerm = (k?: string | null) => term(ANALYSIS_TERMS, k);
export const matterRoleTerm = (k?: string | null) => term(MATTER_ROLE_TERMS, k);
export const invitationTerm = (k?: string | null) => term(INVITATION_TERMS, k);
export const practiceAreaLabel = (k: string) => PRACTICE_AREA_TERMS[k] ?? k;

/**
 * Capacidades reales de un rol dentro de un expediente, en lenguaje de despacho.
 *
 * Las claves son las acciones que el control de acceso YA evalúa
 * (`MATTER_ACTIONS`); aquí sólo se nombran. No se inventa ninguna capacidad: si
 * una acción no está en el modelo, no aparece, y si aparece una nueva se verá con
 * su identificador crudo hasta que alguien decida cómo se llama.
 */
export const MATTER_ACTION_TERMS: Record<string, string> = {
  "matter:read": "Ver el expediente",
  "matter:update": "Editar datos del expediente",
  "matter:archive": "Archivar el expediente",
  "matter:manage_members": "Dar y quitar acceso a otras personas",
  "document:read": "Ver documentos",
  "document:link": "Vincular documentos",
  "document:unlink": "Desvincular documentos",
  "task:read": "Ver tareas y términos",
  "task:write": "Crear y cerrar tareas y términos",
  "fact:read": "Ver hechos y fuentes",
  "fact:write": "Establecer hechos y fuentes",
  "execution:read": "Ver los análisis de IUSIA",
  "execution:start": "Iniciar análisis con IUSIA",
  "execution:cancel": "Detener un análisis",
  "gate:approve": "Aprobar los controles de calidad",
  "deliverable:read": "Ver entregables",
  "deliverable:publish": "Publicar entregables",
};

export const matterActionLabel = (action: string) => MATTER_ACTION_TERMS[action] ?? action;

// ─────────────────────── Actividad del expediente ───────────────────────

/**
 * ACTIVITY_EVENT_LABEL_MAP — qué ocurrió, en lenguaje de despacho.
 *
 * El ledger registra acciones con nombre de sistema (`agent.execution.completed`)
 * porque es un registro de auditoría, y así debe seguir. Lo que no puede es llegar
 * así al abogado: "agent.execution.completed / SUCCESS" no le dice que IUSIA
 * terminó de analizar su caso.
 *
 * `kind` clasifica el evento para elegir icono y color sin repetir la decisión en
 * cada vista. `noise: true` marca lo que es telemetría de acceso, no trabajo
 * jurídico: en staging hay 1.853 registros de `intelligence.firm_scope` y
 * `portfolio.list` frente a unas decenas de eventos reales, y mezclarlos entierra
 * la actividad del expediente. Esos eventos NO se borran —la auditoría los
 * necesita— pero pertenecen a Control IUSIA, no a la vista jurídica.
 */
export interface ActivityPresentation {
  label: string;
  kind: "analysis" | "document" | "matter" | "people" | "access" | "system";
  /** Telemetría de acceso: se conserva en auditoría, se excluye de la vista jurídica. */
  noise?: boolean;
}

export const ACTIVITY_EVENT_LABELS: Record<string, ActivityPresentation> = {
  "execution.start": { label: "Análisis iniciado con IUSIA", kind: "analysis" },
  "agent.execution.completed": { label: "Análisis jurídico completado", kind: "analysis" },
  "agent.execution.failed": { label: "El análisis no pudo completarse", kind: "analysis" },
  "execution.cancel": { label: "Análisis detenido", kind: "analysis" },
  "document.link": { label: "Documento incorporado al expediente", kind: "document" },
  "document.unlink": { label: "Documento retirado del expediente", kind: "document" },
  "document.ingested": { label: "Documento procesado y disponible", kind: "document" },
  "matter.create": { label: "Expediente abierto", kind: "matter" },
  "matter.update": { label: "Expediente actualizado", kind: "matter" },
  "matter.archive": { label: "Expediente archivado", kind: "matter" },
  "member.add": { label: "Persona añadida al expediente", kind: "people" },
  "member.remove": { label: "Persona retirada del expediente", kind: "people" },
  "member.role": { label: "Rol actualizado", kind: "people" },
  "invitation.email": { label: "Invitación enviada", kind: "people" },
  "task.create": { label: "Tarea creada", kind: "matter" },
  "task.update": { label: "Tarea actualizada", kind: "matter" },
  "gate.approve": { label: "Control de calidad aprobado", kind: "analysis" },
  // Telemetría de acceso. Real y auditable, pero no es actividad del caso.
  "portfolio.list": { label: "Consulta de cartera", kind: "access", noise: true },
  "intelligence.firm_scope": { label: "Consulta de dirección", kind: "access", noise: true },
  "matter.read": { label: "Expediente consultado", kind: "access", noise: true },
  "document:read": { label: "Acceso a documentos denegado", kind: "access" },
};

/**
 * Desenlace en lenguaje jurídico. `SUCCESS` no significa nada para un abogado; lo
 * que necesita saber es si aquello quedó hecho, se detuvo o le fue negado.
 */
export const ACTIVITY_OUTCOME_LABELS: Record<string, TermPresentation> = {
  SUCCESS: { label: "Completado", tone: "success" },
  ALLOWED: { label: "Permitido", tone: "neutral" },
  FAILURE: { label: "Con incidencia", tone: "critical" },
  DENIED: { label: "Denegado", tone: "warning" },
};

export function activityEvent(action: string): ActivityPresentation {
  return ACTIVITY_EVENT_LABELS[action] ?? { label: action, kind: "system" };
}

export function activityOutcome(outcome: string): TermPresentation {
  return ACTIVITY_OUTCOME_LABELS[outcome] ?? { label: outcome, tone: "neutral" };
}

/** ¿Este evento es trabajo jurídico y no telemetría de acceso? */
export function isLegalActivity(action: string): boolean {
  return activityEvent(action).noise !== true;
}

// ─────────────────────── Documentos del expediente ───────────────────────

/**
 * Estado de un documento, contado desde lo que le importa al abogado: si IUSIA ya
 * puede usarlo como evidencia. `EN_REVISION` o `INDEXED` describen el pipeline;
 * "Disponible para análisis" describe la consecuencia.
 */
export const DOCUMENT_STATUS_TERMS: Record<string, TermPresentation> = {
  PENDING: { label: "En cola", hint: "Esperando procesamiento.", tone: "neutral" },
  PROCESSING: { label: "Procesando", hint: "IUSIA está leyendo el documento.", tone: "info" },
  INDEXED: {
    label: "Disponible para análisis",
    hint: "IUSIA puede citarlo como evidencia.",
    tone: "success",
  },
  EN_REVISION: { label: "En revisión", hint: "Pendiente de revisión interna.", tone: "warning" },
  FAILED: { label: "Con incidencia", hint: "No pudo procesarse.", tone: "critical" },
  ARCHIVED: { label: "Archivado", tone: "neutral" },
};

/** Clasificación documental. */
export const DOCUMENT_CLASSIFICATION_TERMS: Record<string, string> = {
  FUENTE: "Fuente",
  EVIDENCIA: "Evidencia",
  CONTRATO: "Contrato",
  PROVIDENCIA: "Providencia",
  ESCRITO: "Escrito",
  CORRESPONDENCIA: "Correspondencia",
  PERICIAL: "Peritaje",
  OTRO: "Otro",
};

export const documentStatusTerm = (k?: string | null) => term(DOCUMENT_STATUS_TERMS, k);
export const documentClassLabel = (k: string) => DOCUMENT_CLASSIFICATION_TERMS[k] ?? k;

/**
 * Estado de una integración contado al abogado, no al operador.
 *
 * "NOT_CONFIGURED / GOOGLE_CLIENT_ID" describe la causa técnica; el abogado
 * necesita saber si puede trabajar y qué hacer. La causa vive en Control IUSIA.
 */
export const CAPABILITY_TERMS: Record<string, TermPresentation & { hint: string }> = {
  CONNECTED: {
    label: "Operativo",
    hint: "Disponible para trabajar.",
    tone: "success",
  },
  NOT_CONFIGURED: {
    label: "Sin habilitar",
    hint: "La dirección de la firma aún no lo ha habilitado.",
    tone: "neutral",
  },
  ERROR: {
    label: "Requiere atención",
    hint: "Contacta con quien administra la plataforma.",
    tone: "critical",
  },
};

export const capabilityTerm = (k?: string | null) =>
  CAPABILITY_TERMS[k ?? ""] ?? CAPABILITY_TERMS.NOT_CONFIGURED!;
