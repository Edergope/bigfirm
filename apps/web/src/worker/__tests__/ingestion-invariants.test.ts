import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROVIDER_DOCUMENT_PROPERTY,
  PROVIDER_SYNC_MAX_ATTEMPTS,
  providerSyncBackoffMs,
} from "../services/ingestion.js";
import { SWEEP_BATCH_LIMIT } from "../scheduled.js";

const workerDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(workerDir, rel), "utf8");
const ingestion = read("services/ingestion.ts");

/**
 * INVARIANTE 1 — UNA ENTREGA = UN INTENTO.
 *
 * Había DOS llamadas a `markIngestionStarted` en el mismo `ingest()`, y cada una
 * incrementa `ingestion_attempts`. Por eso `attempts = 2` en `CC JFRR.pdf` no probaba
 * dos entregas de Cloudflare: probaba UNA. Un contador que significa dos cosas no
 * significa ninguna, y sobre él construí una conclusión forense equivocada.
 */
describe("una entrega incrementa el contador exactamente una vez", () => {
  it("sólo hay un sello por ejecución", () => {
    const seals = ingestion.split("markIngestionStarted(").length - 1;
    expect(seals).toBe(1);
  });

  it("las etapas posteriores actualizan latido, nunca el contador", () => {
    // Normalización, índice y sincronización llaman a `markIngestionProgress`.
    const afterSeal = ingestion.slice(ingestion.indexOf("markIngestionStarted("));
    expect(afterSeal).toContain("markIngestionProgress");
    // Y ninguna de ellas vuelve a sellar.
    expect(afterSeal.split("markIngestionStarted(").length - 1).toBe(1);
  });

  it("el sello persiste la identidad que da Cloudflare al mensaje", () => {
    // Sin esto, la única evidencia era un contador que había que interpretar leyendo
    // el código. Ahora se guarda lo que la plataforma misma afirma.
    expect(ingestion).toContain("delivery");
    expect(read("queue-consumer.ts")).toContain("messageId");
    expect(read("queue-consumer.ts")).toContain("attempts");
  });
});

/**
 * INVARIANTE 2 — LO APLAZADO SE RECUPERA SOLO.
 *
 * `provider_sync_state = DEFERRED` no lo leía nadie: sin cron, sin mensaje, sin
 * reconciliación. Un documento con el proveedor aplazado se quedaba así para siempre y
 * sus bytes originales nunca salían del ingreso. El comentario del código afirmaba que
 * «se reintenta sola»; era falso.
 */
describe("la sincronización aplazada tiene recuperación real", () => {
  it("aplazar encola un trabajo propio, no sólo escribe un estado", () => {
    const defer = ingestion.slice(ingestion.indexOf("private async deferProviderSync"));
    expect(defer.slice(0, 2000)).toContain("DOCUMENT_INGESTION.send");
    expect(defer.slice(0, 2000)).toContain('reason: "PROVIDER_SYNC"');
  });

  it("la espera crece y tiene techo", () => {
    expect(providerSyncBackoffMs(1)).toBe(60_000);
    expect(providerSyncBackoffMs(2)).toBe(120_000);
    expect(providerSyncBackoffMs(3)).toBe(240_000);
    // Nunca más de una hora: reintentar cada seis horas no es recuperación, es olvido.
    expect(providerSyncBackoffMs(99)).toBe(3_600_000);
    // Y siempre crece.
    for (let n = 1; n < 8; n += 1) {
      expect(providerSyncBackoffMs(n + 1)).toBeGreaterThanOrEqual(providerSyncBackoffMs(n));
    }
  });

  it("no reintenta para siempre: hay estado terminal", () => {
    expect(PROVIDER_SYNC_MAX_ATTEMPTS).toBeGreaterThan(1);
    expect(ingestion).toContain("markProviderSyncTerminal");
  });

  it("existe una barrida de reconciliación acotada", () => {
    // Red de seguridad para lo que el reintento no cubre: mensaje perdido, despliegue
    // a mitad, DLQ que nadie toca.
    const sweep = read("scheduled.ts");
    expect(sweep).toContain("listProviderSyncDue");
    expect(sweep).toContain("SWEEP_BATCH_LIMIT");
    expect(SWEEP_BATCH_LIMIT).toBeGreaterThan(0);
    expect(SWEEP_BATCH_LIMIT).toBeLessThanOrEqual(100);
  });

  it("el Worker declara el disparador programado", () => {
    expect(read("index.ts")).toContain("scheduled:");
    expect(read("index.ts")).toContain("handleProviderSyncSweep");
  });

  it("un fallo del proveedor NO toca el estado de ingestión", () => {
    // El documento ya es analizable; decir lo contrario sería mentir al abogado.
    const repo = readFileSync(
      join(workerDir, "..", "..", "..", "..", "packages", "db", "src", "repositories", "documents.ts"),
      "utf8",
    );
    const defer = repo.slice(repo.indexOf("async deferProviderSync"));
    expect(defer.slice(0, 800)).not.toContain("ingestionStatus");
  });
});

/**
 * VENTANA DE CRASH. Subida al proveedor correcta + Worker muerto antes de persistir el
 * id en D1: el reintento veía `drive_file_id` nulo y habría subido un segundo archivo.
 */
describe("un reintento no puede duplicar el archivo en el proveedor", () => {
  it("consulta por identidad propia antes de crear", () => {
    const sync = ingestion.slice(ingestion.indexOf("private async syncToProvider"));
    const lookupAt = sync.indexOf("findFileByAppProperty");
    const uploadAt = sync.indexOf("uploadFile({");
    expect(lookupAt).toBeGreaterThan(-1);
    // La consulta va ANTES de la creación: ése es todo el mecanismo.
    expect(lookupAt).toBeLessThan(uploadAt);
  });

  it("marca el archivo con esa identidad al crearlo", () => {
    expect(ingestion).toContain("appProperties");
    expect(PROVIDER_DOCUMENT_PROPERTY).toBe("iusia_document_id");
  });

  it("adopta el archivo existente en vez de subir otro", () => {
    const sync = ingestion.slice(ingestion.indexOf("private async syncToProvider"));
    expect(sync).toContain("if (existing) return existing;");
  });
});
