import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { convocationErrorCopy, documentsReadyForAnalysis } from "@iusia/domain";

/**
 * DRIVE ES INFRAESTRUCTURA INVISIBLE.
 *
 * La captura del incidente mostraba «Se guardarán en la carpeta del expediente en
 * Drive…». El abogado no contrata Google: contrata IUSIA. El proveedor de
 * almacenamiento no puede aparecer en la experiencia jurídica.
 */
const CLIENT_DIR = join(process.cwd(), "apps/web/src/client");

/** Ficheros de experiencia del abogado. Se excluye la consola de sistema. */
function lawyerFacingFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      lawyerFacingFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    // SystemControl es la consola de plataforma: ahí el proveedor SÍ se nombra.
    if (entry === "SystemControl.tsx") continue;
    // api.ts es transporte, no copy visible.
    if (entry === "api.ts") continue;
    out.push(full);
  }
  return out;
}

/** Texto visible: se ignoran comentarios, que no llegan a la pantalla. */
function visibleText(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("DRIVE_INVISIBLE — el proveedor de almacenamiento no existe para el abogado", () => {
  const files = lawyerFacingFiles(CLIENT_DIR);

  it("hay ficheros de experiencia que auditar", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("[NO_DRIVE_COPY] ninguna pantalla del abogado nombra Drive ni conceptos de proveedor", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = visibleText(readFileSync(file, "utf8"));
      for (const term of [/\bGoogle Drive\b/i, /\bDrive\b/, /webViewLink/i, /drive_file_id/]) {
        if (term.test(text)) offenders.push(`${file.replace(process.cwd() + "/", "")} :: ${term}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("CONVOCATORIA — la creación no espera a la indexación", () => {
  it("[NOT_READY] un documento en proceso no se considera listo para el análisis", () => {
    expect(documentsReadyForAnalysis([{ ingestion_status: "PROCESSING" }], 1)).toBe(false);
    expect(documentsReadyForAnalysis([{ ingestion_status: "FILE_STORED" }], 1)).toBe(false);
    // Faltan documentos por aparecer todavía.
    expect(documentsReadyForAnalysis([], 1)).toBe(false);
  });

  it("[READY] indexado o no indexable ya permite analizar", () => {
    expect(documentsReadyForAnalysis([{ ingestion_status: "AI_INDEXED" }], 1)).toBe(true);
    expect(documentsReadyForAnalysis([{ ingestion_status: "NOT_INDEXABLE" }], 1)).toBe(true);
    expect(
      documentsReadyForAnalysis(
        [{ ingestion_status: "AI_INDEXED" }, { ingestion_status: "PROCESSING" }],
        2,
      ),
    ).toBe(false);
  });

  it("[TEXT_ONLY] sin documentos esperados, nunca hay nada que esperar", () => {
    expect(documentsReadyForAnalysis([], 0)).toBe(true);
  });
});

describe("ERROR UX — cinco situaciones, cinco frases", () => {
  it("[STAGES] cada etapa dice qué pasó y si el expediente sobrevive", () => {
    expect(convocationErrorCopy("MATTER_CREATION_FAILED", false).keepsMatter).toBe(false);
    expect(convocationErrorCopy("DOCUMENT_UPLOAD_FAILED", true)).toMatchObject({ keepsMatter: true });
    expect(convocationErrorCopy("DOCUMENT_UPLOAD_FAILED", true).message).toMatch(/expediente fue creado/i);
    expect(convocationErrorCopy("ORCHESTRATION_START_FAILED", true).message).toMatch(/están seguros/i);
    expect(convocationErrorCopy("POSSIBLE_DUPLICATE_MATTER", false).message).toMatch(/ya existe un expediente/i);
  });

  it("[DISTINCT] las frases no se repiten entre etapas", () => {
    const messages = (
      [
        "MATTER_CREATION_FAILED",
        "DOCUMENT_UPLOAD_FAILED",
        "ORCHESTRATION_START_FAILED",
        "POSSIBLE_DUPLICATE_MATTER",
        "TEMPORARY_SERVICE_FAILURE",
      ] as const
    ).map((s) => convocationErrorCopy(s, true).message);
    expect(new Set(messages).size).toBe(5);
  });

  it("[NO_TECHNICAL_LEAK] ninguna frase expone jerga técnica", () => {
    const all = (
      [
        "MATTER_CREATION_FAILED",
        "DOCUMENT_UPLOAD_FAILED",
        "ORCHESTRATION_START_FAILED",
        "POSSIBLE_DUPLICATE_MATTER",
        "TEMPORARY_SERVICE_FAILURE",
      ] as const
    ).map((s) => convocationErrorCopy(s, false).message).join(" ");
    for (const jargon of [/drive/i, /http/i, /\b5\d\d\b/, /stack/i, /queue/i, /ingestion/i]) {
      expect(all).not.toMatch(jargon);
    }
  });
});
