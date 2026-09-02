import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ORDEN DEL PIPELINE. Es la corrección arquitectónica que cierra el Sprint 01, y esta
 * prueba impide que se deshaga.
 *
 * `CC JFRR.pdf` —dos páginas— se detuvo en `ingestion_stage = FINAL_STORAGE` con el
 * último latido 387 ms después de empezar y `drive_file_id` nulo: la sincronización con
 * el proveedor era prerrequisito SERIAL de la normalización y del índice, y
 * `ensureMatterFolders` encadena ocho llamadas a Drive sin cota.
 *
 * El original está a salvo en el ingreso durable, así que el proveedor no aporta nada a
 * la comprensión del documento. La inteligencia va PRIMERO.
 */

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "services", "ingestion.ts"),
  "utf8",
);

const positionOf = (needle: string): number => {
  const at = src.indexOf(needle);
  expect(at, `no se encontró en el pipeline: ${needle}`).toBeGreaterThan(-1);
  return at;
};

describe("la inteligencia no espera al proveedor de almacenamiento", () => {
  it("normaliza e indexa ANTES de sincronizar con el proveedor", () => {
    const normalize = positionOf('stage = "NORMALIZE"');
    const index = positionOf('stage = "AI_SEARCH_UPLOAD"');
    const providerSync = positionOf('stage = "PROVIDER_SYNC"');
    expect(normalize).toBeLessThan(providerSync);
    expect(index).toBeLessThan(providerSync);
  });

  it("un fallo del proveedor NO deja el documento sin analizar", () => {
    // La sincronización va en su propio try/catch y sólo marca procedencia pendiente.
    expect(src).toContain("markProviderSyncPending");
    expect(src).toContain("provider_sync_deferred");
  });

  it("cada dependencia externa tiene cota explícita", () => {
    for (const deadline of [
      "DOWNLOAD_DEADLINE_MS",
      "NORMALIZE_DEADLINE_MS",
      "PROVIDER_SYNC_DEADLINE_MS",
      "AI_SEARCH_DEADLINE_MS",
    ]) {
      expect(src).toContain(deadline);
    }
  });

  it("la sincronización con el proveedor está acotada", () => {
    // Era el único tramo sin techo, y es donde se detuvo el documento.
    const call = src.slice(positionOf('stage = "PROVIDER_SYNC"'));
    expect(call.slice(0, 900)).toContain("PROVIDER_SYNC_DEADLINE_MS");
  });

  it("el reintento reanuda: no rehace lo que ya está durable", () => {
    expect(src).toContain("alreadyIndexed");
    // Y no vuelve a subir al proveedor si el archivo ya existe allí.
    expect(src).toContain("if (!doc.driveFileId) {");
  });

  it("los bytes originales se conservan hasta que el proveedor confirma", () => {
    const del = src.indexOf("ARTIFACTS.delete(ingressKey)");
    expect(del).toBeGreaterThan(-1);
    // El borrado vive dentro de la rama que ya obtuvo el id del proveedor.
    expect(src.slice(del - 600, del)).toContain("attachProviderFile");
  });

  it("un formato no indexable se salta la inteligencia pero NO la procedencia", () => {
    // Antes ni siquiera se encolaba: sus bytes se quedaban en el ingreso para siempre.
    expect(src).toContain("isIndexableMimeType(doc.mimeType)");
    const providerSync = positionOf('stage = "PROVIDER_SYNC"');
    const indexableGuard = positionOf("isIndexableMimeType(doc.mimeType)");
    expect(indexableGuard).toBeLessThan(providerSync);
  });
});
