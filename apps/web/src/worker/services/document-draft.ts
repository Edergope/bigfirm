import { getAgentDefinition, PromptLoader, R2PromptSource } from "@iusia/agents";
import { deriveConclusionText, type CaseBrief } from "@iusia/domain";
import { buildCaseBrief } from "./case-brief.js";
import { ModelGateway } from "./model-gateway.js";
import { UNTRUSTED_SYSTEM_GUARD } from "../agents/guards.js";
import type { RequestContext } from "../context.js";
import type { Env } from "../env.js";

/**
 * Document Draft — redacción jurídica REAL, no relleno de campos.
 *
 * Despacha el agente canónico 08 (Redacción Senior Jurídica) directamente sobre
 * el Case Brief del expediente para producir el CONTENIDO de cada variable de la
 * plantilla. El agente redacta desde hechos, autoridades, análisis y estrategia
 * verificados; el Document Engine sólo inserta ese contenido en la plantilla.
 *
 * Ruta determinista, FUERA del planner: el 08 sigue `enabled:false` en el registry
 * (el planner dinámico no lo elige), pero su prompt canónico —verificado por SHA—
 * se ejecuta aquí igual que cualquier especialista. No se modifica ningún agent.md
 * ni el árbol canónico; no se tocan los límites de seguridad del planner.
 */

const DRAFTER_AGENT_ID = "08-redactor-senior-juridico";

export interface DraftVariable {
  key: string;
  label: string;
  required: boolean;
}

export interface DraftResult {
  values: Record<string, string>;
  agent_id: string;
  provider: string;
  model: string;
  prompt_sha256: string;
  usage: { input_tokens: number; output_tokens: number };
}

export class DocumentDraftError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DocumentDraftError";
  }
}

export class DocumentDraftService {
  constructor(private readonly env: Env) {}

  static forEnv(env: Env): DocumentDraftService {
    return new DocumentDraftService(env);
  }

  /**
   * Redacta el contenido de las variables de la plantilla para un expediente.
   * `instructions` son indicaciones opcionales del abogado; nunca sustituyen el
   * grounding, sólo lo orientan.
   */
  async draft(input: {
    ctx: RequestContext;
    organizationId: string;
    matterId: string;
    documentType: string;
    variables: readonly DraftVariable[];
    instructions?: string;
    executionId?: string;
  }): Promise<DraftResult> {
    const brief = await buildCaseBrief(input.ctx, input.organizationId, input.matterId);
    // El análisis multiagente ya producido para este expediente es contexto legítimo
    // del entregable: sin esto, el redactor trabajaba sobre un Case Brief que ignoraba
    // por completo lo que el equipo había concluido, y ese vacío era la puerta por la
    // que un dato objetivo podía entrar sin fundamento.
    const analysis = await this.latestAnalysis(input.ctx, input.organizationId, input.matterId);

    const def = getAgentDefinition(DRAFTER_AGENT_ID);
    const loader = new PromptLoader(new R2PromptSource(this.env.PROMPTS));
    // Falla cerrada si el prompt canónico no está sincronizado en R2 o el hash no coincide.
    const prompt = await loader.load(def);

    const messages = [
      { role: "system" as const, content: UNTRUSTED_SYSTEM_GUARD },
      // El agent.md canónico del 08 se inyecta íntegro y sin modificaciones.
      { role: "system" as const, content: prompt.text },
      {
        role: "user" as const,
        content: renderDraftRequest(
          input.documentType,
          brief,
          input.variables,
          input.instructions,
          analysis,
        ),
      },
    ];

    const gateway = new ModelGateway(this.env);
    const result = await gateway.complete(def.model_policy, messages, {
      organization_id: input.organizationId,
      matter_id: input.matterId,
      agent_id: def.agent_id,
      execution_id: input.executionId ?? `draft_${input.matterId}`,
    });

    const parsed = extractValues(result.text, input.variables);
    if (!parsed) {
      throw new DocumentDraftError(
        "DOCUMENT_DRAFT_UNPARSEABLE",
        "El agente redactor no devolvió el contenido en el formato esperado.",
      );
    }

    return {
      values: parsed,
      agent_id: def.agent_id,
      provider: result.provider,
      model: result.model,
      prompt_sha256: prompt.sha256,
      usage: { input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens },
    };
  }

  /**
   * Conclusión del análisis más reciente del expediente, leída del artefacto que el
   * integrador ya dejó en R2. Es lectura pura: no ejecuta agentes ni consume créditos.
   * Devuelve `null` si el expediente aún no tiene análisis — un entregable puede
   * redactarse sin él, pero entonces el redactor lo sabe.
   */
  private async latestAnalysis(
    ctx: RequestContext,
    organizationId: string,
    matterId: string,
  ): Promise<string | null> {
    try {
      const rows = await ctx.executions.listByMatter(organizationId, matterId, 100);
      const candidates = rows
        .filter((r) => r.status === "COMPLETED" && r.outputRef && r.parentExecutionId !== null)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      for (const row of candidates) {
        const object = await this.env.ARTIFACTS.get(row.outputRef!);
        if (!object) continue;
        const stored = await object.json<{ text?: string }>();
        const text = deriveConclusionText(stored.text ?? "").trim();
        if (text.length > 0) return text.slice(0, 6000);
      }
      return null;
    } catch {
      // La ausencia de análisis nunca impide redactar: se declara y se sigue.
      return null;
    }
  }
}

/**
 * Compone la instrucción de redacción para el 08: expediente completo + campos a
 * producir. El contrato de salida (JSON con las claves de las variables) vive en
 * la capa de usuario, nunca en el prompt canónico.
 */
function renderDraftRequest(
  documentType: string,
  brief: CaseBrief,
  variables: readonly DraftVariable[],
  instructions?: string,
  analysis?: string | null,
): string {
  const parties = brief.parties.map((p) => `- ${p.kind}: ${p.name}`).join("\n") || "- (sin partes registradas)";
  const facts =
    brief.facts.map((f) => `- [${f.certainty}] ${f.statement} (fuente: ${f.primary_source})`).join("\n") ||
    "- (sin hechos registrados)";
  const authorities =
    brief.authorities
      .map((a) => `- ${a.citation} · ${a.type} · ${a.status}`)
      .join("\n") || "- (sin autoridades registradas)";
  const sources = brief.sources.map((s) => `- ${s}`).join("\n") || "- (sin fuentes)";
  const openQuestions = brief.open_questions.map((q) => `- ${q}`).join("\n") || "- (ninguna)";

  const fieldSpec = variables
    .map((v) => `- "${v.key}": ${v.label}${v.required ? " (obligatorio)" : ""}`)
    .join("\n");

  const jsonSkeleton = `{\n${variables.map((v) => `  "${v.key}": "..."`).join(",\n")}\n}`;

  return [
    `# Encargo de redacción — documento tipo: ${documentType}`,
    "",
    "Eres el redactor senior. Redacta el contenido de un entregable oficial de la firma",
    "a partir EXCLUSIVAMENTE del expediente que sigue. No inventes hechos, partes,",
    "cifras, fechas ni autoridades que no consten aquí. Si un dato no consta, redáctalo",
    "de forma prudente y señala expresamente lo que debe verificarse.",
    "",
    "## Expediente",
    `- Objetivo: ${brief.objective}`,
    `- Áreas: ${brief.matter_type.join(", ")}`,
    `- Materialidad: ${brief.materiality}`,
    `- Riesgo: ${brief.risk.level} — ${brief.risk.rationale}`,
    "",
    "### Partes",
    parties,
    "",
    "### Hechos",
    facts,
    "",
    "### Autoridades",
    authorities,
    "",
    "### Fuentes",
    sources,
    "",
    "### Cuestiones abiertas",
    openQuestions,
    ...(analysis
      ? [
          "",
          "### Análisis del equipo jurídico de IUSIA para este expediente",
          "Conclusión ya producida y trazable en el expediente. Es contexto de trabajo:",
          "no la copies, redáctala como documento oficial y no añadas hechos que no consten.",
          analysis,
        ]
      : [
          "",
          "### Análisis del equipo jurídico",
          "(este expediente todavía no tiene un análisis multiagente registrado)",
        ]),
    ...(instructions
      ? ["", "### Instrucciones del abogado responsable", instructions.trim()]
      : []),
    "",
    "## Campos a redactar",
    "Produce el contenido de EXACTAMENTE estos campos. Cada valor es texto jurídico",
    "final, en prosa, listo para insertarse en la plantilla (sin marcadores ni títulos",
    "de campo dentro del valor):",
    fieldSpec,
    "",
    "## Formato de salida (obligatorio)",
    "Devuelve ÚNICAMENTE un objeto JSON válido, sin texto antes ni después, sin bloques",
    "de código, con esta forma exacta:",
    jsonSkeleton,
  ].join("\n");
}

/**
 * Extrae el objeto JSON de la respuesta del agente y lo proyecta a las variables
 * esperadas. Tolera prosa alrededor y bloques ```json, pero exige que todas las
 * claves esperadas estén presentes con texto no vacío.
 */
export function extractValues(
  text: string,
  variables: readonly DraftVariable[],
): Record<string, string> | null {
  const json = sliceJsonObject(text);
  if (!json) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const record = obj as Record<string, unknown>;

  const values: Record<string, string> = {};
  for (const v of variables) {
    const raw = record[v.key];
    if (typeof raw !== "string" || raw.trim().length === 0) return null;
    values[v.key] = raw.trim();
  }
  return values;
}

/** Recorta el primer objeto JSON balanceado del texto (ignora ```json y prosa). */
function sliceJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
