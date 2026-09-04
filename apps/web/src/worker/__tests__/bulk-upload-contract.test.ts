import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/**
 * Un solo contrato de carga — lote de 17 (IUS-2026-018).
 *
 * Había cuatro entradas y cuatro respuestas distintas a la misma pregunta. «Nuevo
 * expediente» recortaba a diez en silencio; el modal de Convocar recortaba a diez en
 * silencio, dos veces —arrastrar y elegir—; el panel de Documentos no tenía techo; y el
 * workspace mandaba todo de golpe. Fue la primera la que se comió siete de los
 * diecisiete documentos de un abogado sin decírselo.
 */
const ENTRADAS = [
  "client/pages/Matters.tsx",
  "client/components/ConvocationModal.tsx",
  "client/pages/MatterWorkspace.tsx",
  "client/pages/Documents.tsx",
];

describe("las cuatro entradas de carga comparten política", () => {
  it("ninguna recorta la selección en silencio", () => {
    for (const entrada of ENTRADAS) {
      const src = read(entrada);
      // El recorte mudo tenía esta forma exacta, y se repetía tres veces.
      expect(src).not.toMatch(/Array\.from\(e\.(target|dataTransfer)\.files[^)]*\)\]\.slice\(/);
      expect(src).not.toMatch(/\.slice\(0, 10\)/);
    }
  });

  it("todas derivan el límite del dominio, no de un número escrito a mano", () => {
    for (const entrada of ENTRADAS) {
      const src = read(entrada);
      expect(src).toMatch(/planFileSelection|useFileSelection/);
    }
  });

  it("el servidor aplica el MISMO límite y lo dice con un código propio", () => {
    const route = read("worker/routes/document-workspace.ts");
    expect(route).toContain("MAX_FILES_PER_UPLOAD");
    expect(route).toContain("TOO_MANY_FILES");
  });

  it("cliente y servidor toman el límite de la misma constante", () => {
    const dominio = readFileSync(
      join(root, "..", "..", "..", "packages", "domain", "src", "upload-batch.ts"),
      "utf8",
    );
    expect(dominio).toMatch(/export const MAX_FILES_PER_UPLOAD = \d+;/);
  });

  it("todas pasan por api.uploadDocuments: una sola vía al servidor", () => {
    for (const entrada of ENTRADAS) {
      expect(read(entrada)).toContain("api.uploadDocuments");
    }
  });
});

describe("todo archivo pedido tiene un destino explícito", () => {
  const route = read("worker/routes/document-workspace.ts");

  it("la auditoría deja escritas las cinco casillas, no sólo los fallos", () => {
    /*
      El registro del lote de 17 decía `{count: 10, failed: 0}`. Las dos cifras eran
      ciertas y el informe era falso: se crearon nueve filas. `failed` sólo contaba
      `UPLOAD_FAILED`, y el décimo se fue por una rama que no es un fallo.
    */
    expect(route).toContain("requested:");
    expect(route).toContain("accepted:");
    expect(route).toContain("duplicate:");
    expect(route).toContain("unsupported:");
    expect(route).not.toMatch(/count: results\.length/);
  });

  it("y los nombres de lo que no entró, para poder reconstruirlo sin preguntar", () => {
    expect(route).toContain("unsupported_names");
    expect(route).toContain("duplicate_names");
  });

  it("el recuento viaja también en la respuesta", () => {
    expect(route).toContain("accounting");
  });

  it("las entradas que muestran resultado lo contrastan contra lo PEDIDO", () => {
    for (const entrada of ["client/pages/Matters.tsx", "client/pages/MatterWorkspace.tsx"]) {
      expect(read(entrada)).toMatch(/acc\.accepted < acc\.requested/);
    }
  });

  it("el modal no navega si el servidor aceptó menos de lo que se le mandó", () => {
    const modal = read("client/components/ConvocationModal.tsx");
    expect(modal).toContain("uploadAccounting.accepted < uploadAccounting.requested");
    expect(modal).toContain("setContinueTo");
  });

  it("la espera de ingestión se mide contra lo aceptado, no lo seleccionado", () => {
    // Contra lo seleccionado, un lote con un duplicado nunca alcanza la cuenta y el
    // expediente se queda esperando a un documento que nadie creó.
    const modal = read("client/components/ConvocationModal.tsx");
    expect(modal).toContain("accepted ?? files.length");
  });
});

describe("el conjunto de evidencia se congela al arrancar", () => {
  const wf = read("worker/workflows/matter-orchestration.ts");

  it("se fija dentro de un step, así que sobrevive a los reintentos", () => {
    expect(wf).toContain("freezeEvidenceSet(docs)");
    const i = wf.indexOf("freezeEvidenceSet(docs)");
    expect(wf.slice(Math.max(0, i - 900), i)).toContain("step.do(");
  });

  it("la recuperación filtra por el conjunto congelado, no por el expediente vivo", () => {
    expect(wf).toContain("frozen.has(d.id)");
    expect(wf).toMatch(/ingestionStatus === "AI_INDEXED" && !d\.retiredAt/);
  });

  it("queda escrito y ligado a la ejecución raíz, con documento y versión", () => {
    // Sin esto no se puede demostrar que un documento indexado más tarde NO participó.
    expect(wf).toContain("evidence_set_size");
    expect(wf).toMatch(/\$\{m\.document_id\}@v\$\{m\.version\}/);
  });

  it("sin evidencia citable no se llama al índice", () => {
    expect(wf).toContain("const evidenceCount = ctx.evidence_set.length");
    expect(wf).toMatch(/evidenceCount === 0\s*\n?\s*\?\s*\[\]/);
  });

  it("distingue «no hay documentos» de «ninguno es analizable»", () => {
    // Decirle a un especialista «no se recuperó soporte relevante» sobre tres imágenes
    // le hace suponer que buscó y no encontró.
    expect(wf).toContain("ninguno es analizable por su formato");
  });
});
