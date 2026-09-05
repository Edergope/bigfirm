import { describe, expect, it } from "vitest";
import {
  PARTITION_MAX_BYTES,
  ordinalFromKey,
  partitionKey,
  partitionProgressLabel,
  partitionText,
} from "../partition.js";
import { evidenceAdmits, freezeEvidenceSet } from "../evidence-set.js";

/** Una página jurídica ronda los 3 KB de texto. 100 páginas ≈ 300 KB. */
const pagina = (n: number) =>
  `PÁGINA ${n}\n\n${`Cláusula ${n}. `.repeat(60)}\n\nSe deja constancia de lo actuado en la página ${n}.`;
const documento = (paginas: number) =>
  Array.from({ length: paginas }, (_, i) => pagina(i + 1)).join("\n\n");

describe("un documento que cabe NO se parte", () => {
  it("un contrato corriente sigue siendo un solo item", () => {
    const p = partitionText(documento(5));
    expect(p).toHaveLength(1);
    expect(p[0]!.ordinal).toBe(1);
  });

  it("partir lo que no hace falta multiplica items, confirmaciones y fallos", () => {
    expect(partitionText("Texto breve.")).toHaveLength(1);
  });
});

describe("un documento de 100 páginas se reparte", () => {
  // Con un límite pequeño se fuerza el reparto sin construir 3 MB de texto en memoria.
  const LIMITE = 8 * 1024;
  const texto = documento(100);
  const partes = partitionText(texto, LIMITE);

  it("produce varias partes y ninguna excede el límite", () => {
    expect(partes.length).toBeGreaterThan(1);
    for (const p of partes) expect(p.bytes).toBeLessThanOrEqual(LIMITE);
  });

  it("no pierde ni inventa contenido", () => {
    // La suma de las partes contiene todo el documento: nada se cae por el camino.
    const recompuesto = partes.map((p) => p.text).join("\n\n");
    for (const n of [1, 37, 73, 100]) {
      expect(recompuesto).toContain(`PÁGINA ${n}`);
    }
    expect(recompuesto.length).toBeGreaterThanOrEqual(texto.trim().length - partes.length * 2);
  });

  it("los ordinales son consecutivos desde 1", () => {
    expect(partes.map((p) => p.ordinal)).toEqual(partes.map((_, i) => i + 1));
  });

  it("es determinista: reprocesar da exactamente las mismas partes", () => {
    // De esto depende que un reproceso no cree items nuevos.
    expect(partitionText(texto, LIMITE)).toEqual(partes);
  });

  it("corta por párrafos, no a mitad de frase", () => {
    // «…por lo cual se declara la» no es una cita, es una ruina.
    for (const p of partes) {
      expect(p.text.trim().length).toBeGreaterThan(0);
      expect(p.text.startsWith(" ")).toBe(false);
    }
  });
});

describe("casos que rompen un troceador ingenuo", () => {
  it("un párrafo único mayor que el límite se parte igual", () => {
    const tabla = "col|".repeat(20_000);
    const partes = partitionText(tabla, 4096);
    expect(partes.length).toBeGreaterThan(1);
    for (const p of partes) expect(p.bytes).toBeLessThanOrEqual(4096);
  });

  it("no parte un carácter multibyte por la mitad", () => {
    // Medio carácter no es un carácter: es basura que rompe la codificación del item.
    const texto = "ñ".repeat(5000);
    const partes = partitionText(texto, 1024);
    for (const p of partes) {
      expect(new TextEncoder().encode(p.text).byteLength).toBeLessThanOrEqual(1024);
      expect(p.text).not.toContain("�");
    }
    expect(partes.map((p) => p.text).join("")).toBe(texto);
  });

  it("el límite real deja margen bajo el techo del proveedor", () => {
    // El texto se mide en bytes UTF-8 y una tilde ocupa dos: apurar el límite exacto
    // convierte cualquier error de cálculo en un item rechazado.
    expect(PARTITION_MAX_BYTES).toBeLessThan(4 * 1024 * 1024);
  });
});

describe("la procedencia viaja en la clave", () => {
  const key = partitionKey("org_1", "mtr_1", "doc_1", 73);

  it("la clave nombra la parte", () => {
    expect(key).toContain("/doc/doc_1/p73.txt");
    expect(ordinalFromKey(key)).toBe(73);
  });

  it("es determinista: reprocesar escribe encima, no al lado", () => {
    expect(partitionKey("org_1", "mtr_1", "doc_1", 73)).toBe(key);
  });

  it("respeta el prefijo de aislamiento del expediente", () => {
    expect(key.startsWith("org/org_1/matter/mtr_1/")).toBe(true);
  });

  it("una clave que no es de partición no inventa un ordinal", () => {
    expect(ordinalFromKey("org/o/matter/m/doc/doc_1.txt")).toBeNull();
    expect(ordinalFromKey("org/o/matter/m/ingress/doc_1")).toBeNull();
    expect(ordinalFromKey("")).toBeNull();
  });
});

describe("disponibilidad progresiva, dicha sin jerga", () => {
  it("no se habla de particiones ni de items", () => {
    const t = partitionProgressLabel(40, 100);
    expect(t).not.toMatch(/partici|item|chunk|shard/i);
    expect(t).toContain("40 %");
  });

  it("un documento sin partes no habla de porcentajes", () => {
    expect(partitionProgressLabel(1, 1)).toBe("Disponible para el análisis");
  });

  it("cero partes listas es «Procesando», no «0 % disponible»", () => {
    expect(partitionProgressLabel(0, 100)).toBe("Procesando");
  });

  it("completo es completo", () => {
    expect(partitionProgressLabel(100, 100)).toBe("Disponible para el análisis");
  });
});

/**
 * Decisión explícita (opción B): las partes listas pueden ser evidencia sin esperar a
 * la última. Hacer esperar un expediente entero por su documento más lento convierte la
 * herramienta en un estorbo. Sólo es defendible con procedencia exacta, y la hay.
 */
describe("evidencia parcial con procedencia exacta", () => {
  const docs = [
    { id: "grande", ingestionStatus: "INDEXING", currentVersion: 1, partitionCount: 100, readyPartitions: [1, 2, 3] },
    { id: "normal", ingestionStatus: "AI_INDEXED", currentVersion: 2 },
    { id: "vacio", ingestionStatus: "INDEXING", currentVersion: 1, partitionCount: 100, readyPartitions: [] },
  ];
  const frozen = freezeEvidenceSet(docs);

  it("un documento parcialmente listo entra con sus partes listas", () => {
    const m = frozen.find((x) => x.document_id === "grande")!;
    expect(m.partitions).toEqual([1, 2, 3]);
  });

  it("uno sin ninguna parte lista no entra", () => {
    expect(frozen.some((m) => m.document_id === "vacio")).toBe(false);
  });

  it("un documento normal entra entero, sin lista de partes", () => {
    expect(frozen.find((x) => x.document_id === "normal")!.partitions).toBeUndefined();
  });

  it("se admite un fragmento de una parte congelada", () => {
    expect(evidenceAdmits(frozen, { document_id: "grande", partition_ordinal: 2 })).toBe(true);
  });

  it("se RECHAZA un fragmento de una parte indexada después de arrancar", () => {
    // Citarlo sería apoyar el dictamen en una fuente que no existía cuando el abogado
    // pulsó el botón.
    expect(evidenceAdmits(frozen, { document_id: "grande", partition_ordinal: 73 })).toBe(false);
  });

  it("un fragmento sin procedencia de un documento partido no se admite", () => {
    // Sin ordinal no se puede saber de qué parte salió, y adivinar no es una opción.
    expect(evidenceAdmits(frozen, { document_id: "grande" })).toBe(false);
  });

  it("un documento fuera del conjunto no entra por tener ordinal", () => {
    expect(evidenceAdmits(frozen, { document_id: "vacio", partition_ordinal: 1 })).toBe(false);
    expect(evidenceAdmits(frozen, { document_id: "otro", partition_ordinal: 1 })).toBe(false);
  });
});
