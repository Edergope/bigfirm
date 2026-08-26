import { TemplateRepository, createDb } from "@iusia/db";
import type { Env } from "../env.js";
import { DriveCredentialResolver } from "./drive-credentials.js";
import { DriveWorkspaceService } from "./drive-workspace.js";

/**
 * Semilla del Template Bank: crea la plantilla institucional "Opinión Legal" como
 * un Google Doc real (estándar editorial Pisoso Legal) y la registra.
 *
 * El estándar editorial vive en el propio Google Doc (estilos con nombre TITLE /
 * HEADING_1 / NORMAL_TEXT, que Word conserva al exportar). El contenido variable son
 * {{placeholders}} que el agente rellena; la plantilla nunca los inventa.
 *
 * Idempotente por template_id fijo: re-seedear actualiza la fila y crea un doc nuevo
 * sólo si aún no hay source_ref.
 */

const OPINION_TEMPLATE_ID = "tpl_system_opinion_legal";

/** Párrafos de la plantilla: estilo + texto. Los {{...}} los rellena el agente. */
const PARAGRAPHS: Array<{ style: "TITLE" | "HEADING_1" | "NORMAL_TEXT"; text: string; bold?: boolean }> = [
  { style: "TITLE", text: "OPINIÓN LEGAL" },
  { style: "NORMAL_TEXT", text: "{{lugar_fecha}}" },
  { style: "NORMAL_TEXT", text: "" },
  { style: "HEADING_1", text: "I. Asunto" },
  { style: "NORMAL_TEXT", text: "{{asunto}}" },
  { style: "HEADING_1", text: "II. Antecedentes" },
  { style: "NORMAL_TEXT", text: "{{antecedentes}}" },
  { style: "HEADING_1", text: "III. Análisis jurídico" },
  { style: "NORMAL_TEXT", text: "{{analisis}}" },
  { style: "HEADING_1", text: "IV. Conclusión" },
  { style: "NORMAL_TEXT", text: "{{conclusion}}" },
  { style: "NORMAL_TEXT", text: "" },
  { style: "NORMAL_TEXT", text: "Atentamente," },
  { style: "NORMAL_TEXT", text: "{{firmante}}" },
];

const VARIABLES = [
  { key: "lugar_fecha", label: "Lugar y fecha", required: false },
  { key: "asunto", label: "Asunto de la opinión", required: true },
  { key: "antecedentes", label: "Antecedentes del caso", required: false },
  { key: "analisis", label: "Análisis jurídico", required: true },
  { key: "conclusion", label: "Conclusión", required: true },
  { key: "firmante", label: "Firmante", required: false },
];

export async function seedOpinionTemplate(
  env: Env,
  userId: string,
  organizationId: string,
): Promise<{ template_id: string; source_ref: string; created: boolean }> {
  const db = createDb(env.DB);
  const templates = new TemplateRepository(db);

  const existing = await templates.findById(OPINION_TEMPLATE_ID);
  if (existing?.sourceRef) {
    return { template_id: OPINION_TEMPLATE_ID, source_ref: existing.sourceRef, created: false };
  }

  const resolver = DriveCredentialResolver.forEnv(env);
  const drive = await resolver.resolveAdapter(userId, { requireWrite: true });
  const workspace = DriveWorkspaceService.forEnv(env);
  const { templates: templatesFolder } = await workspace.ensureFirmStructure(userId, organizationId);

  // 1. Documento Google Doc vacío en la carpeta de Plantillas de la firma.
  const docId = await drive.createDoc("Plantilla — Opinión Legal (Pisoso Legal)", templatesFolder);

  // 2. Insertar todo el cuerpo de una vez y luego dar estilo por rangos conocidos.
  const fullText = PARAGRAPHS.map((p) => p.text).join("\n") + "\n";
  const requests: unknown[] = [{ insertText: { location: { index: 1 }, text: fullText } }];

  let cursor = 1;
  for (const p of PARAGRAPHS) {
    const start = cursor;
    const end = cursor + p.text.length + 1; // incluye el salto de línea
    requests.push({
      updateParagraphStyle: {
        range: { startIndex: start, endIndex: end },
        paragraphStyle: { namedStyleType: p.style },
        fields: "namedStyleType",
      },
    });
    cursor = end;
  }

  await drive.docsBatchUpdate(docId, requests);

  // 3. Registrar la plantilla (source of truth de metadata en D1; archivo en Drive).
  await templates.upsertSystem({
    id: OPINION_TEMPLATE_ID,
    name: "Opinión Legal",
    documentType: "OPINION",
    version: 1,
    engine: "GOOGLE_DOCS",
    sourceRef: docId,
    variables: VARIABLES,
  });

  return { template_id: OPINION_TEMPLATE_ID, source_ref: docId, created: true };
}

/** Reservado para futuras plantillas del catálogo. */
export const SEED_TEMPLATE_IDS = { opinion: OPINION_TEMPLATE_ID };
