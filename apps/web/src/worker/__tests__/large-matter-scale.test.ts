import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { partitionKey, partitionText } from "@iusia/domain";
import { PARTITION_ENQUEUE_BATCH, enqueuePartitions, ingestPartition } from "../services/partition-ingest.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/**
 * ARCHITECTURE SCALE TEST — no es un benchmark de indexación.
 *
 * No se procesan diez mil páginas reales ni se paga por ello. Lo que se comprueba es
 * que el trabajo que las diez mil páginas GENERAN esté acotado: cuántos mensajes se
 * mandan de golpe, cuántas promesas viven a la vez, y si el recuento sigue cuadrando.
 */
describe("escala: el trabajo que genera un documento enorme está acotado", () => {
  const enviosDe = async (ordinales: number) => {
    const tandas: number[] = [];
    const env = {
      DOCUMENT_INGESTION: {
        sendBatch: async (msgs: unknown[]) => {
          tandas.push(msgs.length);
        },
      },
    } as never;
    await enqueuePartitions(
      env,
      { organization_id: "org_1", matter_id: "mtr_1", document_id: "doc_1" },
      1,
      Array.from({ length: ordinales }, (_, i) => i + 1),
    );
    return tandas;
  };

  it("100 partes: ninguna tanda excede el techo", async () => {
    const tandas = await enviosDe(100);
    for (const n of tandas) expect(n).toBeLessThanOrEqual(PARTITION_ENQUEUE_BATCH);
    expect(tandas.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("1.000 partes: el recuento sigue cuadrando", async () => {
    const tandas = await enviosDe(1_000);
    expect(tandas.reduce((a, b) => a + b, 0)).toBe(1_000);
    for (const n of tandas) expect(n).toBeLessThanOrEqual(PARTITION_ENQUEUE_BATCH);
  });

  it("10.000 partes: sigue acotado, no explota", async () => {
    const tandas = await enviosDe(10_000);
    expect(tandas.reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(Math.max(...tandas)).toBeLessThanOrEqual(PARTITION_ENQUEUE_BATCH);
    // Y el techo respeta el máximo de la plataforma para sendBatch.
    expect(PARTITION_ENQUEUE_BATCH).toBeLessThanOrEqual(100);
  });

  it("el encolado NO usa Promise.all sobre el arreglo entero", () => {
    /*
      Diez mil promesas simultáneas son diez mil promesas simultáneas, y el aislamiento
      se muere igual que se murió con los PDF del lote de 19. Se recorre en tandas.
    */
    const src = read("services/partition-ingest.ts");
    const fn = src.slice(src.indexOf("export async function enqueuePartitions"));
    expect(fn.slice(0, 900)).not.toContain("Promise.all");
    expect(fn.slice(0, 900)).toContain("for (let i = 0");
  });

  it("no se cargan todas las partes en memoria a la vez", () => {
    // Cada trabajo lee SU parte de R2 cuando le toca; nadie sostiene el documento
    // entero más las particiones más los resultados al mismo tiempo.
    const src = read("services/partition-ingest.ts");
    const fn = src.slice(src.indexOf("export async function ingestPartition"));
    expect(fn).toContain("ARTIFACTS.get(row.sourceKey)");
  });
});

describe("cada parte es un trabajo independiente", () => {
  const base = {
    organization_id: "org_1",
    matter_id: "mtr_1",
    document_id: "doc_1",
    document_version: 1,
    reason: "PARTITION" as const,
    enqueued_at: new Date().toISOString(),
  };
  /** Entorno mínimo: estos casos se resuelven ANTES de tocar D1 o el índice. */
  const env = { DB: {}, ARTIFACTS: {}, AI_SEARCH: null } as never;

  it("un mensaje sin ordinal no hace nada", async () => {
    const r = await ingestPartition(env, { ...base, partition_ordinal: undefined });
    expect(r.status).toBe("SKIPPED");
  });

  it("un mensaje sin versión no hace nada", async () => {
    const r = await ingestPartition(env, {
      ...base, partition_ordinal: 1, document_version: undefined,
    });
    expect(r.status).toBe("SKIPPED");
  });
});

/**
 * SEGURIDAD. Lo que el mensaje afirma no autoriza nada: la fila se busca en D1 por las
 * CUATRO claves de aislamiento más el ordinal.
 */
describe("aislamiento de los trabajos de partición", () => {
  const repo = readFileSync(
    join(root, "..", "..", "..", "..", "packages", "db", "src", "repositories", "partitions.ts"),
    "utf8",
  );

  it("la búsqueda exige organización, expediente, documento y versión", () => {
    const fn = repo.slice(repo.indexOf("async findForJob"));
    for (const clave of [
      "documentPartitions.organizationId",
      "documentPartitions.matterId",
      "documentPartitions.documentId",
      "documentPartitions.documentVersion",
      "documentPartitions.ordinal",
    ]) {
      expect(fn.slice(0, 1400)).toContain(clave);
    }
  });

  it("un mensaje forjado desde otra organización no encuentra fila", () => {
    // No hay una comprobación aparte que alguien pueda olvidarse de llamar: la
    // pertenencia ES la consulta.
    const fn = repo.slice(repo.indexOf("async findForJob"));
    expect(fn.slice(0, 1400)).toContain("eq(documentPartitions.organizationId, input.organizationId)");
  });

  it("una versión distinta es otra partición, no la misma", () => {
    const migration = readFileSync(
      join(root, "..", "..", "migrations", "0018_document_partitions.sql"),
      "utf8",
    );
    expect(migration).toContain("(document_id, document_version, ordinal)");
    expect(migration).toContain("CREATE UNIQUE INDEX");
  });

  it("el mensaje NO lleva credenciales ni claves de almacenamiento", () => {
    const consumer = read("queue-consumer.ts");
    const fn = consumer.slice(consumer.indexOf("function partitionMessage"));
    expect(fn.slice(0, 600)).not.toMatch(/token|secret|credential|r2_key|source_key/i);
  });
});

describe("idempotencia bajo entrega «al menos una vez»", () => {
  const repo = readFileSync(
    join(root, "..", "..", "..", "..", "packages", "db", "src", "repositories", "partitions.ts"),
    "utf8",
  );

  it("el plan repetido no duplica filas", () => {
    const fn = repo.slice(repo.indexOf("async createPlan"));
    expect(fn.slice(0, 1800)).toContain("onConflictDoNothing");
  });

  it("una parte que ya tiene item NO se vuelve a subir", () => {
    // Dos items de la misma parte cuentan doble en la recuperación.
    const src = read("services/partition-ingest.ts");
    const fn = src.slice(src.indexOf("export async function ingestPartition"));
    expect(fn).toContain("if (row.aiSearchItemId)");
  });

  it("el recuento se CUENTA, no se incrementa", () => {
    /*
      Sumar uno por confirmación parece más barato y es exactamente donde una entrega
      repetida produce «8 de 7 partes listas».
    */
    const fn = repo.slice(repo.indexOf("private async refreshCounts"));
    expect(fn.slice(0, 1600)).toContain('r.state === "READY"');
    expect(fn.slice(0, 1600)).not.toMatch(/sql`.*\+ 1/);
  });

  it("las claves en R2 son deterministas: se sobrescribe, no se acumula", () => {
    expect(partitionKey("o", "m", "d", 7)).toBe(partitionKey("o", "m", "d", 7));
  });

  it("y el troceo también, así que los ordinales no se desplazan", () => {
    const texto = "párrafo uno\n\npárrafo dos\n\npárrafo tres";
    expect(partitionText(texto, 20)).toEqual(partitionText(texto, 20));
  });
});

describe("un fallo aislado no bloquea el resto", () => {
  const repo = readFileSync(
    join(root, "..", "..", "..", "..", "packages", "db", "src", "repositories", "partitions.ts"),
    "utf8",
  );

  it("una parte fallida se marca sola y las demás siguen", () => {
    expect(repo).toContain("async markFailed");
    const fn = repo.slice(repo.indexOf("async markFailed"));
    expect(fn.slice(0, 900)).toContain("eq(documentPartitions.id, id)");
  });

  it("se puede reencolar SÓLO lo que falta", () => {
    // Reprocesar las 99 partes buenas para arreglar una es trabajo que nadie pidió.
    const fn = repo.slice(repo.indexOf("async listUnfinished"));
    expect(fn.slice(0, 900)).toContain('["PENDING", "INDEXING", "FAILED"]');
  });

  it("el documento no se declara completo mientras falte una parte", () => {
    const src = read("services/partition-ingest.ts");
    const fn = src.slice(src.indexOf("async function promoteDocumentIfComplete"));
    expect(fn).toContain("ready.length < doc.partitionCount");
  });

  it("congelar la evidencia de N documentos no cuesta N consultas", () => {
    // El bucle obvio sobre `readyOrdinals` es exactamente la consulta N+1.
    expect(repo).toContain("async readyOrdinalsFor");
    const fn = repo.slice(repo.indexOf("async readyOrdinalsFor"));
    expect(fn.slice(0, 1200)).toContain("inArray(documentPartitions.documentId");
  });
});

describe("no se abrió otra cola ni otro orquestador", () => {
  it("las partes viajan por la cola que ya existía", () => {
    const wrangler = readFileSync(join(root, "..", "..", "wrangler.jsonc"), "utf8");
    const colas = [...wrangler.matchAll(/"queue":\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(colas)).toEqual(
      new Set(["iusia-document-ingestion", "iusia-document-ingestion-production"]),
    );
  });

  it("el consumidor discrimina por razón, no por otro punto de entrada", () => {
    const consumer = read("queue-consumer.ts");
    expect(consumer).toContain('parsed.data.reason === "PARTITION"');
    expect(consumer).toContain('parsed.data.reason === "PARTITION_CONFIRM"');
  });

  it("la contrapresión sigue siendo la misma, no una tercera", () => {
    // El presupuesto de bytes por aislamiento y el techo de invocaciones concurrentes
    // ya gobiernan esta cola; un semáforo más sólo añade otra cosa que puede
    // desincronizarse.
    const src = read("services/partition-ingest.ts");
    expect(src).not.toMatch(/semaphore|new Semaphore|inflightBytes/i);
  });
});

/**
 * Dos defectos MÍOS, encontrados en la auditoría previa al commit. No los escribo aquí
 * como nota: los escribo como pruebas, que es lo único que impide que vuelvan.
 */
describe("ninguna parte se queda sin quien vuelva, y ninguna gira sin fin", () => {
  const src = read("services/partition-ingest.ts");
  const sweeps = read("scheduled.ts");
  const repo = readFileSync(
    join(root, "..", "..", "..", "..", "packages", "db", "src", "repositories", "partitions.ts"),
    "utf8",
  );

  it("la vigilancia de una parte tiene techo", () => {
    /*
      Lo escribí sin límite: una parte cuyo proveedor nunca termina se habría
      reconfirmado cada dos minutos indefinidamente, gastando cola e invocaciones que
      otros expedientes necesitan. Es el defecto simétrico del que ya corregí en
      documentos enteros — allí nadie volvía; aquí nadie paraba.
    */
    expect(src).toContain("INDEX_CONFIRM_MAX_ATTEMPTS + INDEX_CONFIRM_SLOW_MAX_ATTEMPTS");
    expect(src).toContain("PARTITION_CONFIRM_ABANDONED");
  });

  it("y usa las MISMAS constantes que un documento entero", () => {
    // Dos políticas de reintento que dicen lo mismo divergen a la primera ocasión.
    for (const k of [
      "INDEX_CONFIRM_MAX_ATTEMPTS",
      "INDEX_CONFIRM_SLOW_DELAY_S",
      "INDEX_CONFIRM_SLOW_MAX_ATTEMPTS",
    ]) {
      expect(src).toContain(k);
    }
  });

  it("baja el ritmo antes de rendirse, no de golpe", () => {
    expect(src).toContain("attempt > INDEX_CONFIRM_MAX_ATTEMPTS\n    ? INDEX_CONFIRM_SLOW_DELAY_S");
  });

  it("una parte que se quedó sin subir se rescata sola", () => {
    /*
      `PENDING` sin item y callada: su trabajo murió y nadie iba a volver. Aquí sería
      peor que en un documento entero — el documento seguiría mostrándose disponible en
      un 80 % para siempre, que es la peor forma de fallar porque parece que funciona.
    */
    expect(repo).toContain("async listStalledUploads");
    const fn = repo.slice(repo.indexOf("async listStalledUploads"));
    expect(fn.slice(0, 900)).toContain('eq(documentPartitions.state, "PENDING")');
    expect(fn.slice(0, 900)).toContain("aiSearchItemId} IS NULL");
    expect(sweeps).toContain("listStalledUploads");
  });

  it("la barrida recoge lo vencido, lo varado y lo que nunca subió", () => {
    const fn = sweeps.slice(sweeps.indexOf("export async function confirmPartitionReadiness"));
    expect(fn).toContain("listAwaitingConfirmation");
    expect(fn).toContain("listStalledUploads");
    // Cada uno se reencola con la razón que le corresponde, no todos igual.
    expect(fn).toContain('"PARTITION_CONFIRM"');
    expect(fn).toContain('"PARTITION"');
  });

  it("la barrida de particiones está enganchada al cron que ya existía", () => {
    expect(read("index.ts")).toContain("confirmPartitionReadiness(env)");
  });
});
