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
  OWNER: { label: "Responsable", hint: "Dirige el expediente.", tone: "info" },
  COLLABORATOR: { label: "Colabora", tone: "neutral" },
  REVIEWER: { label: "Revisa", tone: "neutral" },
  ASSISTANT: { label: "Apoya", tone: "neutral" },
  EXTERNAL: { label: "Externo", hint: "Ajeno a la firma.", tone: "warning" },
  READ_ONLY: { label: "Sólo lectura", tone: "neutral" },
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
