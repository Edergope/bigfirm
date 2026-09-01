/**
 * Routing económico por CLASE DE TRABAJO.
 *
 * Punto de partida medido, no supuesto: las 79 llamadas registradas en staging son
 * TODAS a `gpt-5` con `max_output_tokens: 16000`, y 377.599 tokens de salida
 * representan el 82 % de los 4,62 USD contabilizados. El costo no está en elegir mal
 * el modelo: está en pagar salida de modelo premium para todo, incluida la selección
 * de un equipo y la extracción de campos.
 *
 * La política NO es «el modelo más barato para todo». Es el modelo más barato que
 * supera el listón de cada trabajo, con escalamiento por criterios DETERMINISTAS
 * —materialidad del asunto, fallo de validación estructurada— nunca por lo que el
 * propio modelo diga sobre su confianza.
 *
 * Vive en el dominio y no en los 30 `agent.md`: cambiar de modelo no puede exigir
 * tocar el árbol canónico de agentes ni sus prompts.
 */

/** Clases de trabajo. T0 no llega aquí: es determinista y no usa modelo. */
export const TASK_CLASSES = [
  /** T1 — extracción/clasificación estructurada de bajo riesgo. */
  "EXTRACTION",
  /** T2 — planificación: elegir equipo y misiones, en JSON validado por el servidor. */
  "PLAN",
  /** T3 — análisis jurídico de especialista. */
  "SPECIALIST",
  /** T4 — integración final. Una sola vez por expediente analizado. */
  "INTEGRATION",
  /** T5 — redacción de entregable. */
  "DOCUMENT_GENERATION",
] as const;
export type TaskClass = (typeof TASK_CLASSES)[number];

export interface RoutedModel {
  provider: string;
  model: string;
}

export interface RoutingDecision {
  preferred: RoutedModel;
  fallback: RoutedModel[];
  /** Techo de salida: donde vive el 82 % del costo. */
  max_output_tokens: number;
  temperature: number;
  /** Por qué se eligió, para que la decisión sea auditable y no mágica. */
  reason: string;
}

const GPT5: RoutedModel = { provider: "openai", model: "gpt-5" };
const GPT5_MINI: RoutedModel = { provider: "openai", model: "gpt-5-mini" };
const GPT5_NANO: RoutedModel = { provider: "openai", model: "gpt-5-nano" };
const GEMINI_PRO: RoutedModel = { provider: "google", model: "gemini-2.5-pro" };

/**
 * Materialidades que escalan al modelo superior. Es el único disparador automático
 * de escalamiento: lo decide el expediente, no el modelo.
 */
const ESCALATED_MATERIALITIES = new Set(["HIGH_STAKES"]);

export interface RoutingContext {
  taskClass: TaskClass;
  /** Materialidad del expediente. Determina el escalamiento por riesgo. */
  materiality?: string;
  /**
   * La salida estructurada anterior no validó tras la reparación acotada. Es el
   * segundo disparador legítimo: capacidad demostrada como insuficiente, no opinión.
   */
  structuredOutputFailed?: boolean;
}

/**
 * Decide modelo y techo de salida para un trabajo concreto.
 *
 * Los techos salen de la medición real: las salidas observadas van de 2.365 a 10.283
 * tokens con un límite de 16.000 que nadie necesitaba. Un techo ajustado a cada
 * trabajo no recorta contenido jurídico: recorta la invitación a divagar.
 */
export function routeModel(ctx: RoutingContext): RoutingDecision {
  const escalate =
    ctx.structuredOutputFailed === true ||
    (ctx.materiality !== undefined && ESCALATED_MATERIALITIES.has(ctx.materiality));

  switch (ctx.taskClass) {
    case "EXTRACTION":
      // Campos y clasificación. El servidor valida el resultado contra un contrato,
      // así que un fallo se detecta sin necesidad de un modelo caro.
      return {
        preferred: GPT5_NANO,
        fallback: [GPT5_MINI],
        max_output_tokens: 1_500,
        temperature: 0,
        reason: "extraccion_estructurada_validada_server_side",
      };

    case "PLAN":
      // Seleccionar de un catálogo de 24 y redactar misiones. El TeamPlan lo valida
      // el servidor de forma determinista, hay una reparación acotada y un
      // SAFE_FALLBACK: el peor caso de un plan flojo está cubierto por diseño.
      return {
        preferred: escalate ? GPT5 : GPT5_MINI,
        fallback: escalate ? [GEMINI_PRO] : [GPT5],
        max_output_tokens: 4_000,
        temperature: 0.15,
        reason: escalate ? "plan_escalado_por_materialidad" : "plan_es_seleccion_validada",
      };

    case "SPECIALIST":
      // Análisis jurídico sustantivo. Se escala por materialidad del asunto.
      return {
        preferred: escalate ? GPT5 : GPT5_MINI,
        fallback: escalate ? [GEMINI_PRO] : [GPT5],
        max_output_tokens: escalate ? 8_000 : 6_000,
        temperature: 0.15,
        reason: escalate ? "especialista_escalado_por_materialidad" : "especialista_estandar",
      };

    case "INTEGRATION":
      // La conclusión que lee el abogado. Ocurre UNA vez por raíz: es el lugar donde
      // el modelo superior se paga solo.
      return {
        preferred: GPT5,
        fallback: [GEMINI_PRO],
        max_output_tokens: 8_000,
        temperature: 0.15,
        reason: "integracion_final_una_vez_por_expediente",
      };

    case "DOCUMENT_GENERATION":
      // Entregable oficial que sale con la firma del despacho.
      return {
        preferred: escalate ? GPT5 : GPT5_MINI,
        fallback: [GPT5],
        max_output_tokens: escalate ? 10_000 : 6_000,
        temperature: 0.15,
        reason: escalate ? "entregable_alta_criticidad" : "entregable_estandar",
      };
  }
}

/**
 * Aplica el routing sobre la política canónica del agente, conservando su `route`.
 * El `agent.md` y su registro no se tocan: sólo se sustituye el destino del modelo.
 */
export function applyRouting<T extends { route: string }>(
  policy: T,
  decision: RoutingDecision,
): T & {
  preferred: RoutedModel;
  fallback: RoutedModel[];
  temperature: number;
  max_output_tokens: number;
} {
  return {
    ...policy,
    preferred: decision.preferred,
    fallback: decision.fallback,
    temperature: decision.temperature,
    max_output_tokens: decision.max_output_tokens,
  };
}
