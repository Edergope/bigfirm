import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { providerSyncBackoffMs, PROVIDER_SYNC_MAX_ATTEMPTS } from "../services/ingestion.js";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "services", "ingestion.ts"),
  "utf8",
);

/**
 * Bucle de sincronización con el proveedor — lote de 17 (IUS-2026-018).
 *
 * El historial de intentos lo dejó a la vista: `ENSAYO ESPECIALIZACION xxx.docx` acumuló
 * un `UPLOADED` y SIETE `PROVIDER_SYNC` entre las 20:10:08 y las 20:10:39. Cuarenta y
 * siete segundos para consumir los ocho intentos de una escalera que va de un minuto a
 * una hora.
 *
 * Dos causas encadenadas, y las dos son mías.
 */
describe("el reintento de proveedor respeta su propia espera", () => {
  it("el mensaje se envía CON el retraso calculado", () => {
    const defer = src.slice(src.indexOf("private async deferProviderSync"));
    const send = defer.slice(defer.indexOf("DOCUMENT_INGESTION.send"));
    // Se escribía `provider_sync_next_at` en D1 y se enviaba sin `delaySeconds`. Una
    // fecha en la base no retrasa un mensaje.
    expect(send.slice(0, 600)).toContain("delaySeconds");
    expect(send.slice(0, 600)).toContain("providerSyncBackoffMs(attempt)");
  });

  it("la espera crece de verdad entre intentos", () => {
    expect(providerSyncBackoffMs(1)).toBe(60_000);
    expect(providerSyncBackoffMs(4)).toBe(480_000);
    // Ocho intentos ya no caben en 47 segundos: suman más de una hora.
    let total = 0;
    for (let n = 1; n <= PROVIDER_SYNC_MAX_ATTEMPTS; n += 1) total += providerSyncBackoffMs(n);
    expect(total).toBeGreaterThan(3_600_000);
  });
});

/**
 * Un documento ya subido al índice no puede volver a subirse.
 *
 * `alreadyIndexed` exigía `indexedAt !== null`, que sólo es cierto DESPUÉS de confirmar.
 * Mientras un documento estaba INDEXING, cada reintento de proveedor lo re-normalizaba y
 * lo re-subía, reiniciaba su contador de confirmación y encolaba otra cadena. `ENSAYO`
 * llegó a 19 confirmaciones sin converger: cada vuelta invalidaba la anterior.
 */
describe("la inteligencia no se rehace en cada reintento de proveedor", () => {
  it("tener identidad de item basta para considerarla hecha", () => {
    expect(src).toContain("doc.aiSearchItemId !== null");
    const guard = src.slice(src.indexOf("const alreadyIndexed"));
    expect(guard.slice(0, 300)).toContain("doc.indexedAt !== null || doc.aiSearchItemId !== null");
  });

  it("INDEXING significa subido, no pendiente de subir", () => {
    // Es la distinción que faltaba: confirmar es otra cosa que subir.
    const guard = src.slice(src.indexOf("const mirrorReady"));
    expect(guard.slice(0, 400)).toContain("doc.r2MirrorKey === key");
  });

  it("el reintento de proveedor no toca el contador de confirmación", () => {
    // `markIndexing` lo reinicia a 0, así que sólo debe llamarse cuando SÍ se sube.
    const upload = src.slice(src.indexOf("if (!alreadyIndexed && isIndexableMimeType"));
    expect(upload.slice(0, 3000)).toContain("markIndexing");
  });
});
