import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ingestionLifecycle, isIngestionInFlight } from "@iusia/domain";
import { buildDocumentFilter, buildMetadataFilter } from "../integrations/ai-search.js";

const workerDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(workerDir, rel), "utf8");
const clientDir = join(workerDir, "..", "client");

/**
 * Comprobación exacta de recuperación.
 *
 * La versión anterior lanzaba `query: "documento del expediente"`, pedía los cinco
 * mejores del Matter y filtraba después por `document_id`. En un expediente de cincuenta
 * documentos eso no encuentra el suyo casi nunca: la confirmación dependía de la suerte.
 */
describe("el documento se pide por su identidad, no se busca a ciegas", () => {
  const filter = buildDocumentFilter({
    organizationId: "org1",
    matterId: "mtr1",
    documentId: "doc1",
  });

  it("el prefiltro incluye organización, matter y documento", () => {
    expect(filter.organization_id).toBe("org1");
    expect(filter.matter_id).toEqual({ $in: ["mtr1"] });
    expect(filter.document_id).toBe("doc1");
  });

  it("acotar a un documento RESTRINGE, nunca amplía", () => {
    // Las dos claves de aislamiento siguen presentes en ambos filtros.
    const broad = buildMetadataFilter({
      organization_id: "org1",
      authorized_matter_ids: ["mtr1"],
    });
    expect(Object.keys(filter)).toEqual(expect.arrayContaining(Object.keys(broad)));
    expect(Object.keys(filter).length).toBeGreaterThan(Object.keys(broad).length);
  });

  it("se revalida el documento DESPUÉS de buscar, no sólo antes", () => {
    // Nunca se confía sólo en el índice.
    expect(read("integrations/ai-search.ts")).toContain(
      "if (query.document_id && documentId !== query.document_id) continue;",
    );
  });
});

/**
 * Contrato de readiness. `AI_INDEXED` exige CINCO condiciones, no una.
 */
describe("qué hace falta para decir que un documento está indexado", () => {
  const confirm = read("services/index-confirm.ts");

  it("no basta con que la subida saliera bien", () => {
    // El estado tras subir es INDEXING, nunca AI_INDEXED.
    expect(read("services/ingestion.ts")).toContain("markIndexing");
  });

  it("no basta con que el proveedor diga completado", () => {
    // Un filtro mal puesto dejó la recuperación en cero mientras todo decía «indexado».
    expect(confirm).toContain('info?.status === "completed"');
    expect(confirm).toContain("chunks.length > 0");
  });

  it("un fragmento de OTRO documento no puede satisfacer la comprobación", () => {
    // El prefiltro lo impide en el índice y la revalidación lo impide al volver.
    expect(confirm).toContain("document_id: input.documentId");
  });

  it("el índice caído no degrada el documento", () => {
    const info = confirm.slice(confirm.indexOf("async function itemInfo"));
    expect(info).toContain("return null;");
    expect(info).not.toContain("markIngestionFailed");
  });
});

/**
 * Idempotencia bajo at-least-once. Dos entregas del mismo trabajo no pueden producir dos
 * items en el índice.
 */
describe("una reentrega no vuelve a subir el mismo documento", () => {
  it("si ya hay identidad de item, se reutiliza en vez de subir otra vez", () => {
    const src = read("services/ingestion.ts");
    expect(src).toContain("if (doc.aiSearchItemId)");
    // Y la subida vive en la rama contraria.
    const branch = src.slice(src.indexOf("if (doc.aiSearchItemId)"));
    expect(branch.slice(0, 900)).toContain("} else {");
  });

  it("no se rehace la inteligencia si el espejo y el índice ya están", () => {
    expect(read("services/ingestion.ts")).toContain("alreadyIndexed");
  });
});

/** La pantalla sigue viva mientras el índice trabaja. */
describe("la pantalla no se queda quieta durante la indexación", () => {
  it("INDEXANDO cuenta como trabajo en curso", () => {
    const state = ingestionLifecycle({
      status: "INDEXING",
      attempts: 1,
      heartbeatAt: new Date().toISOString(),
    });
    expect(state).toBe("PROCESSING");
    expect(isIngestionInFlight(state)).toBe(true);
  });

  it("deja de consultar en cuanto el documento es utilizable", () => {
    expect(isIngestionInFlight(ingestionLifecycle({ status: "AI_INDEXED", attempts: 1 }))).toBe(false);
    expect(isIngestionInFlight(ingestionLifecycle({ status: "ERROR", attempts: 1 }))).toBe(false);
    expect(isIngestionInFlight(ingestionLifecycle({ status: "NOT_INDEXABLE", attempts: 1 }))).toBe(false);
  });

  it("la carpeta se refresca sola y al volver a la pestaña", () => {
    const page = readFileSync(join(clientDir, "pages", "MatterWorkspace.tsx"), "utf8");
    const query = page.slice(page.indexOf('queryKey: ["workspace", matterId]'));
    expect(query).toContain("refetchInterval");
    expect(query).toContain("refetchOnWindowFocus: true");
    // `staleTime: 0` es lo que hace que volver a la pestaña traiga datos frescos: con
    // los 10 s por defecto devolvía la caché, que era la sensación de «no se actualiza».
    expect(query.slice(0, 1600)).toContain("staleTime: 0");
  });

  it("el sondeo se detiene cuando ya nada puede cambiar", () => {
    const page = readFileSync(join(clientDir, "pages", "MatterWorkspace.tsx"), "utf8");
    expect(page).toContain("moving ? 3000 : false");
  });
});

/** El abogado nunca ve la maquinaria del índice. */
describe("nada de jerga técnica en pantalla", () => {
  it("ningún término de producto menciona AI Search ni el item", () => {
    const domain = readFileSync(
      join(workerDir, "..", "..", "..", "..", "packages", "domain", "src", "ingestion-lifecycle.ts"),
      "utf8",
    );
    const terms = domain.slice(domain.indexOf("INGESTION_LIFECYCLE_TERMS"));
    for (const jerga of ["AI Search", "item", "chunk", "índice", "upload"]) {
      expect(terms).not.toContain(jerga);
    }
  });
});
