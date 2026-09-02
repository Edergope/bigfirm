import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { INDEX_CONFIRM_FIRST_DELAY_S, indexConfirmDelaySeconds } from "../services/ingestion.js";
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
  it("el consumidor NO espera al índice: sube y entrega el turno", () => {
    const src = read("services/ingestion.ts");
    // `items.upload()` encola y retorna, según la referencia oficial.
    expect(src).toContain("items.upload");
    expect(src).not.toContain("uploadAndPoll(key, text");
    // Y la confirmación se encola con retraso, no se espera aquí.
    expect(src).toContain("enqueueIndexConfirm");
    expect(INDEX_CONFIRM_FIRST_DELAY_S).toBeGreaterThan(0);
  });

  it("la primera pregunta llega después de que tenga sentido preguntar", () => {
    // El índice tardó 77-112 s en los cinco documentos reales: preguntar a los 5 s sería
    // preguntar en vano, y la escalera cubre el peor caso observado con holgura.
    expect(INDEX_CONFIRM_FIRST_DELAY_S).toBeGreaterThanOrEqual(30);
    expect(indexConfirmDelaySeconds(1)).toBe(30);
    expect(indexConfirmDelaySeconds(5)).toBe(120);
    // Techo: no crece indefinidamente.
    expect(indexConfirmDelaySeconds(99)).toBe(120);
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
  const confirm = read("services/index-confirm.ts");

  it("pregunta por el item EXACTO que subimos", () => {
    expect(confirm).toContain("doc.aiSearchItemId");
    expect(confirm).toContain("items?.get?.");
  });

  it("exige que el proveedor haya terminado Y que haya fragmentos", () => {
    expect(confirm).toContain('info?.status === "completed"');
    expect(confirm).toContain("chunks_count ?? 0) > 0");
  });

  it("filtra por el documento ANTES de buscar, no después", () => {
    // La versión anterior pedía el top-5 del expediente y esperaba que apareciera: en un
    // expediente de cincuenta documentos eso no lo encuentra casi nunca.
    expect(confirm).toContain("document_id: input.documentId");
    expect(read("integrations/ai-search.ts")).toContain("buildDocumentFilter");
  });

  it("D1 manda sobre el índice: retirado o de otro matter no se confirma", () => {
    expect(confirm).toContain("doc.retiredAt");
    expect(confirm).toContain("doc.matterId !== input.matterId");
  });

  it("«todavía no» NO es «ha fallado»", () => {
    // Es la distinción que produjo un falso error en un documento sano.
    expect(confirm).toContain("markIndexConfirmDelayed");
    expect(confirm).toContain('status: "DELAYED"');
  });

  it("la confirmación no usa modelos generativos", () => {
    expect(confirm).not.toContain("ModelGateway");
    expect(confirm).not.toContain("chatCompletions");
  });

  it("el cron sólo recoge lo vencido: no es el camino normal", () => {
    const sweep = read("scheduled.ts");
    expect(sweep).toContain("RED DE SEGURIDAD");
    expect(sweep).toContain("listAwaitingIndexConfirmation");
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
