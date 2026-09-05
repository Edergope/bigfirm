import { describe, expect, it } from "vitest";
import {
  MAX_FILES_PER_UPLOAD,
  accountUploads,
  batchProgress,
  convocationReadiness,
  planFileSelection,
  uploadAccountingStatement,
} from "../upload-batch.js";
import { FORMAT_CAPABILITY_MATRIX, formatCoverage, isReadableMimeType } from "../document-formats.js";
import { evidenceSetSize, freezeEvidenceSet } from "../evidence-set.js";

const nombres = (n: number) => Array.from({ length: n }, (_, i) => `doc-${i}.pdf`);

/** PARTE E/Z — política de cantidad, una sola, compartida y nunca silenciosa. */
describe("política de carga masiva", () => {
  it("cubre el objetivo real del sprint: 15 archivos simultáneos", () => {
    expect(MAX_FILES_PER_UPLOAD).toBeGreaterThanOrEqual(15);
    const plan = planFileSelection(nombres(15));
    expect(plan.accepted).toBe(15);
    expect(plan.notice).toBeNull();
  });

  it("una selección de 17 con el techo viejo de 10 avisa en vez de recortar", () => {
    const plan = planFileSelection(nombres(17), 10);
    expect(plan.accepted + plan.rejected).toBe(17);
    expect(plan.notice).toContain("17");
  });

  it("pasarse del límite se dice antes de subir, con ambos números", () => {
    const plan = planFileSelection(nombres(27), 25);
    expect(plan.notice).toContain("27");
    expect(plan.notice).toContain("25");
  });

  it("nada se descarta sin quedar contado", () => {
    for (const n of [1, 15, 25, 40]) {
      const plan = planFileSelection(nombres(n));
      expect(plan.accepted + plan.rejected).toBe(n);
    }
  });
});

/** PARTE H/I — todo archivo pedido termina en exactamente una casilla. */
describe("contabilidad por archivo", () => {
  const lote = [
    { name: "a.pdf", status: "PROCESSING" },
    { name: "b.pdf", status: "PROCESSING" },
    { name: "c.doc", status: "NOT_INDEXABLE" },
    { name: "d.pptx", status: "UNSUPPORTED" },
    { name: "e.pdf", status: "AI_INDEXED", deduplicated: true },
    { name: "f.pdf", status: "UPLOAD_FAILED" },
  ];

  it("las cinco casillas suman lo pedido", () => {
    const acc = accountUploads(lote);
    expect(acc.accepted + acc.duplicate + acc.unsupported + acc.failed).toBe(acc.requested);
    expect(acc.requested).toBe(6);
  });

  it("NOT_INDEXABLE cuenta como aceptado: entró al expediente", () => {
    // No es lo mismo «no puedo leerlo» que «no lo tengo». El .doc está a salvo.
    expect(accountUploads(lote).accepted).toBe(3);
  });

  it("duplicado y formato no admitido no son fallos, y aun así se nombran", () => {
    const acc = accountUploads(lote);
    expect(acc.duplicate).toBe(1);
    expect(acc.unsupported).toBe(1);
    expect(acc.failed).toBe(1);
    expect(acc.duplicateNames).toEqual(["e.pdf"]);
    expect(acc.unsupportedNames).toEqual(["d.pptx"]);
  });

  it("reproduce el informe falso del lote de 17", () => {
    // El servidor dijo `count: 10, failed: 0` y se crearon nueve filas. Con estas
    // casillas ese informe es imposible: si falta uno, se ve cuál y por qué.
    const acc = accountUploads([
      ...Array.from({ length: 9 }, (_, i) => ({ name: `ok-${i}.pdf`, status: "PROCESSING" })),
      { name: "rechazado.pptx", status: "UNSUPPORTED" },
    ]);
    expect(acc.requested).toBe(10);
    expect(acc.accepted).toBe(9);
    expect(acc.failed).toBe(0);
    expect(uploadAccountingStatement(acc)).toContain("rechazado.pptx");
  });

  it("no dice «subida completada» cuando falta algo", () => {
    const parcial = uploadAccountingStatement(accountUploads(lote));
    expect(parcial).toContain("De 6 archivos");
    const completo = uploadAccountingStatement(
      accountUploads([{ name: "a.pdf", status: "PROCESSING" }]),
    );
    expect(completo).toBe("El documento se guardó en el expediente.");
  });
});

/** PARTE AA — la aritmética de la disponibilidad. */
describe("invariantes de disponibilidad", () => {
  const muchos = (spec: Record<string, number>): string[] =>
    Object.entries(spec).flatMap(([s, n]) => Array.from({ length: n }, () => s));

  const caso = muchos({ AI_INDEXED: 6, PROCESSING: 1, NOT_INDEXABLE: 2 });

  it("6 preparados + 1 procesando + 2 sólo consultables = 9", () => {
    const r = convocationReadiness(caso);
    expect(r.total).toBe(9);
    expect(r.usableCount).toBe(6);
    expect(r.pendingCount).toBe(1);
    expect(r.viewOnlyCount).toBe(2);
    expect(r.excludedNow).toBe(3);
    expect(r.usableCount + r.excludedNow).toBe(r.total);
  });

  it("«1 quedará fuera» ya no puede decirse cuando son 3", () => {
    const r = convocationReadiness(caso);
    expect(r.statement).toContain("6 de 9");
    expect(r.statement).toContain("2 no son analizables por su formato");
  });

  it("la invariante se sostiene en cualquier combinación", () => {
    const combinaciones: Record<string, number>[] = [
      { AI_INDEXED: 15 },
      { AI_INDEXED: 4, PROCESSING: 2, ERROR: 1, NOT_INDEXABLE: 1 },
      { NOT_INDEXABLE: 3 },
      { UPLOADING: 2, AI_INDEXED: 1 },
      { ERROR: 5 },
    ];
    for (const spec of combinaciones) {
      const r = convocationReadiness(muchos(spec));
      expect(r.usableCount + r.excludedNow).toBe(r.total);
      const p = batchProgress(muchos(spec));
      expect(r.usableCount).toBe(p.indexed);
    }
  });

  it("el botón cuenta lo mismo que congela el servidor", () => {
    const docs = [
      { id: "d1", ingestionStatus: "AI_INDEXED", currentVersion: 1 },
      { id: "d2", ingestionStatus: "AI_INDEXED", currentVersion: 3 },
      { id: "d3", ingestionStatus: "PROCESSING", currentVersion: 1 },
      { id: "d4", ingestionStatus: "NOT_INDEXABLE", currentVersion: 1 },
    ];
    const r = convocationReadiness(docs.map((d) => d.ingestionStatus));
    expect(evidenceSetSize(docs)).toBe(r.usableCount);
  });
});

/** PARTE Q — el conjunto de evidencia se fija al arrancar y no cambia. */
describe("conjunto de evidencia congelado", () => {
  const docs = [
    { id: "d2", ingestionStatus: "AI_INDEXED", currentVersion: 2 },
    { id: "d1", ingestionStatus: "AI_INDEXED", currentVersion: 1 },
    { id: "d3", ingestionStatus: "PROCESSING", currentVersion: 1 },
    { id: "d4", ingestionStatus: "NOT_INDEXABLE", currentVersion: 1 },
    { id: "d5", ingestionStatus: "AI_INDEXED", currentVersion: 1, retiredAt: "2026-09-01T00:00:00Z" },
  ];

  it("sólo entra lo indexado y vigente", () => {
    expect(freezeEvidenceSet(docs).map((m) => m.document_id)).toEqual(["d1", "d2"]);
  });

  it("un documento retirado nunca entra, aunque esté indexado", () => {
    expect(freezeEvidenceSet(docs).some((m) => m.document_id === "d5")).toBe(false);
  });

  it("la versión forma parte de la identidad citada", () => {
    // Sin la versión, aportar una nueva a mitad de ejecución cambiaría el texto citado
    // dejando intacto el document_id.
    expect(freezeEvidenceSet(docs)).toContainEqual({ document_id: "d2", version: 2 });
  });

  it("un documento que se indexa DESPUÉS no entra retroactivamente", () => {
    const alArrancar = freezeEvidenceSet(docs);
    const treintaSegundosDespues = docs.map((d) =>
      d.id === "d3" ? { ...d, ingestionStatus: "AI_INDEXED" } : d,
    );
    // El conjunto congelado no se recalcula: es el mismo objeto de la ejecución.
    expect(alArrancar.map((m) => m.document_id)).toEqual(["d1", "d2"]);
    // Y sí entraría en el SIGUIENTE análisis, que es donde el abogado lo espera.
    expect(freezeEvidenceSet(treintaSegundosDespues).map((m) => m.document_id))
      .toEqual(["d1", "d2", "d3"]);
  });

  it("es determinista: el mismo expediente da el mismo conjunto", () => {
    expect(freezeEvidenceSet(docs)).toEqual(freezeEvidenceSet([...docs].reverse()));
  });
});

/** PARTE V — la matriz manda sobre lo que dice la pantalla. */
describe("matriz de capacidad por formato", () => {
  it("cubre los formatos que el brief exige nombrar", () => {
    const nombres = FORMAT_CAPABILITY_MATRIX.map((f) => f.format);
    for (const f of ["PDF con texto", "PDF escaneado", "DOCX", "DOC (Word 97-2003)", "XLSX", "XLS", "CSV", "JPG", "PNG", "WEBP", "TXT"]) {
      expect(nombres).toContain(f);
    }
  });

  it("todo lo admitido es durable y consultable, se pueda leer o no", () => {
    // Que IUSIA no sepa leer un archivo no puede costarle al abogado el archivo.
    for (const f of FORMAT_CAPABILITY_MATRIX) {
      expect(f.durable).toBe(true);
      expect(f.preview).toBe(true);
    }
  });

  it("consultable e indexable son cosas distintas", () => {
    const doc = FORMAT_CAPABILITY_MATRIX.find((f) => f.format === "DOC (Word 97-2003)")!;
    expect(doc.preview).toBe(true);
    expect(doc.index).toBe(false);
    expect(doc.reason).toContain(".docx");
  });

  it("ningún formato se declara indexable sin serlo de verdad", () => {
    for (const f of FORMAT_CAPABILITY_MATRIX) {
      if (f.index) expect(isReadableMimeType(f.mimeType)).toBe(true);
    }
  });

  it("cada entrada explica su motivo: nunca «no indexado» a secas", () => {
    for (const f of FORMAT_CAPABILITY_MATRIX) {
      expect(f.reason.length).toBeGreaterThan(20);
    }
  });

  it("la matriz y el veredicto de la pantalla no divergen", () => {
    for (const f of FORMAT_CAPABILITY_MATRIX) {
      if (f.mimeType === "application/msword") continue; // resuelto además por extensión
      // Las filas de contenido —«PDF escaneado»— no se pueden resolver por MIME: son
      // el mismo tipo que su hermana nativa y sólo se distinguen al convertirlas.
      if (f.determinedBy === "CONTENT") continue;
      const v = formatCoverage(f.mimeType).verdict;
      expect(f.index ? "READABLE" : "STORED_ONLY").toBe(v);
    }
  });

  it("lo que no se decide por el tipo de archivo lo dice", () => {
    const escaneado = FORMAT_CAPABILITY_MATRIX.find((f) => f.format === "PDF escaneado")!;
    expect(escaneado.determinedBy).toBe("CONTENT");
    // Y comparte MIME con su hermana nativa, que sí es citable: la diferencia no está
    // en el tipo, está en si hay texto dentro.
    const nativo = FORMAT_CAPABILITY_MATRIX.find((f) => f.format === "PDF con texto")!;
    expect(nativo.mimeType).toBe(escaneado.mimeType);
    expect(nativo.index).toBe(true);
  });
});
