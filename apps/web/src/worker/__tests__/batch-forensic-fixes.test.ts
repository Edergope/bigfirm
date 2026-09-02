import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AI_SEARCH_POLL_MS } from "../services/ingestion.js";
import { ingestionLifecycle, isIngestionInFlight } from "@iusia/domain";

const workerDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(workerDir, rel), "utf8");

/**
 * Correcciones derivadas de la autopsia del lote de cinco de IUS-2026-016.
 *
 * MEDIDO, no supuesto:
 *   documento              normalize   ai_search   %AI     total
 *   CC JFRR.pdf                107 ms    80.201 ms  98,8%   81,2 s
 *   Pasaporte Vigente          230 ms    77.434 ms  99,0%   78,2 s
 *   Carta firmada              111 ms   108.401 ms  99,0%  109,5 s
 *   registro civil             261 ms   110.779 ms  99,3%  111,6 s
 *   Cedula extrangeria          94 ms   112.073 ms  99,4%  112,8 s
 *
 * El índice es el 99 % del tiempo. La normalización es ruido. Y el sondeo estaba fijado
 * en 120 s: 7,9 s por encima del peor caso observado.
 */
describe("el cuello es el índice, no la conversión", () => {
  it("no se bloquea el consumidor esperando a que el índice confirme", () => {
    // Esperar 110 s por documento dentro del consumidor era el 99 % del lote.
    expect(AI_SEARCH_POLL_MS).toBeLessThan(60_000);
  });

  it("un sondeo que vence deja el documento INDEXANDO, no en error", () => {
    const src = read("services/ingestion.ts");
    expect(src).toContain("markIndexing");
    // Sólo el rechazo explícito del proveedor es un fallo.
    expect(src).toContain("AI Search rechazó el item");
  });

  it("INDEXANDO sigue siendo trabajo en curso para la pantalla", () => {
    const state = ingestionLifecycle({ status: "INDEXING", attempts: 1, heartbeatAt: new Date().toISOString() });
    expect(state).toBe("PROCESSING");
    // Y el sondeo de la pantalla continúa hasta que se confirme.
    expect(isIngestionInFlight(state)).toBe(true);
  });

  it("no se toca el camino de conversión, que no era el problema", () => {
    // 94-261 ms: introducir OCR o particionado aquí habría sido optimizar ruido.
    const src = read("services/ingestion.ts");
    expect(src).toContain("normalizeToText");
    expect(src).not.toContain("ocr");
  });
});

/**
 * `AI_INDEXED` pasa a significar RECUPERABLE.
 *
 * Hasta ahora significaba «el proveedor dijo completado», y ya sabemos que eso no
 * garantiza nada: un filtro de metadata mal puesto dejó la recuperación en cero durante
 * días sin que ningún estado lo delatara.
 */
describe("indexado significa que se recupera de verdad", () => {
  const sweep = read("scheduled.ts");

  it("la confirmación consulta el índice con el alcance real", () => {
    expect(sweep).toContain("confirmIndexReadiness");
    expect(sweep).toContain("authorized_matter_ids");
  });

  it("exige recuperar ESE documento, no cualquiera del expediente", () => {
    expect(sweep).toContain("chunks.filter((c) => c.document_id === doc.id)");
  });

  it("si el índice no responde, el documento NO se degrada", () => {
    const confirm = sweep.slice(sweep.indexOf("export async function confirmIndexReadiness"));
    // El catch incrementa pendientes; nunca marca error.
    expect(confirm.slice(0, 2000)).not.toContain("markIngestionFailed");
  });

  it("la confirmación no usa modelos generativos", () => {
    expect(sweep).not.toContain("ModelGateway");
    expect(sweep).not.toContain("chatCompletions");
  });
});

/**
 * Deuda invisible de procedencia. Los cinco documentos quedaron indexados con
 * `provider_sync_state` NULO y `drive_file_id` nulo: la barrida sólo mira `DEFERRED`,
 * así que nunca los habría visto y su original jamás habría salido del ingreso.
 */
describe("la sincronización imposible deja rastro", () => {
  it("sin credenciales del proveedor se aplaza explícitamente", () => {
    const src = read("services/ingestion.ts");
    const block = src.slice(src.indexOf('stage = "PROVIDER_SYNC"'));
    expect(block.slice(0, 1500)).toContain("DRIVE_NOT_AVAILABLE");
    expect(block.slice(0, 1500)).toContain("deferProviderSync");
  });

  it("aplazar no toca el estado de ingestión del documento", () => {
    // El documento ya es analizable; la procedencia va por detrás.
    const repo = readFileSync(
      join(workerDir, "..", "..", "..", "..", "packages", "db", "src", "repositories", "documents.ts"),
      "utf8",
    );
    const defer = repo.slice(repo.indexOf("async deferProviderSync"));
    expect(defer.slice(0, 800)).not.toContain("ingestionStatus");
  });
});
