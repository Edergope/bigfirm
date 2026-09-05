import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ingestionLifecycle, canRetryIngestion, isIngestionInFlight } from "@iusia/domain";
import { retryDelaySeconds } from "../queue-consumer.js";
import { ABANDONED_MAX_ATTEMPTS, ABANDONED_STALE_MINUTES } from "../scheduled.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const ingestion = read("services/ingestion.ts");
const consumer = read("queue-consumer.ts");
const confirm = read("services/index-confirm.ts");
const sweeps = read("scheduled.ts");

/**
 * Lote de 19 PDF (IUS-2026-019, mtr_2xea1mj6w7xwcqvh, 2026-09-04 16:22 UTC).
 *
 * Diecinueve archivos, todos PDF, todos contabilizados. Ocho se indexaron, cuatro se
 * quedaron en la cadena de confirmación y SIETE murieron. El libro de intentos es
 * inequívoco: veintiocho entregas abiertas, ninguna cerrada. Ni un `completed_at`, ni
 * una etapa final, ni un código de fallo. El `try/catch` por mensaje siempre deja
 * rastro, así que lo que murió no fue el trabajo: fue el aislamiento entero, con todos
 * sus mensajes dentro.
 *
 * Y las cuatro entregas de cada documento ocurrieron entre las 16:23:36 y las 16:23:43.
 * Cuatro segundos para consumir una entrega inicial y tres reintentos.
 */
describe("el aislamiento no puede morirse por exceso de bytes abiertos", () => {
  it("el trabajo pesado pasa por un presupuesto de bytes", () => {
    expect(ingestion).toContain("withInflightBudget");
    expect(ingestion).toContain("INFLIGHT_BUDGET_BYTES");
  });

  it("se cuentan bytes, no documentos", () => {
    // Cuatro PDF de 100 KB y cuatro de 13 MB son el mismo número y no el mismo problema.
    expect(ingestion).toContain("withInflightBudget(doc.sizeBytes ?? 0");
  });

  it("el presupuesto se pide ANTES de leer los bytes", () => {
    const i = ingestion.indexOf("withInflightBudget(doc.sizeBytes");
    const j = ingestion.indexOf("ingress.arrayBuffer()");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(j);
  });

  it("se libera pase lo que pase", () => {
    const fn = ingestion.slice(ingestion.indexOf("async function withInflightBudget"));
    expect(fn.slice(0, 700)).toContain("finally");
  });

  it("un documento mayor que el presupuesto entero no espera para siempre", () => {
    const fn = ingestion.slice(ingestion.indexOf("async function withInflightBudget"));
    // Se acota el coste al presupuesto: pasa solo, que es lo máximo que se puede hacer.
    expect(fn.slice(0, 700)).toContain("Math.min(size, INFLIGHT_BUDGET_BYTES)");
    expect(fn.slice(0, 700)).toContain("inflightBytes > 0");
  });
});

describe("un reintento sólo sirve si el mundo pudo cambiar", () => {
  it("los reintentos esperan, y la espera crece", () => {
    expect(retryDelaySeconds(1)).toBe(10);
    expect(retryDelaySeconds(2)).toBe(30);
    expect(retryDelaySeconds(3)).toBe(90);
  });

  it("las cuatro entregas ya no caben en cuatro segundos", () => {
    // Fue exactamente lo que ocurrió: 16:23:36 → 16:23:43, dentro de la misma
    // congestión que las había matado, sin que nada hubiera cambiado.
    const total = [1, 2, 3].reduce((s, n) => s + retryDelaySeconds(n), 0);
    expect(total).toBeGreaterThan(120);
  });

  it("y tienen techo: una espera no puede crecer sin fin", () => {
    expect(retryDelaySeconds(20)).toBe(300);
  });

  it("ninguna ruta del consumidor reintenta sin espera", () => {
    // Se mira el código, no la prosa: el porqué está documentado ahí arriba.
    const codigo = consumer.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codigo).not.toMatch(/message\.retry\(\s*\)/);
    expect(consumer).toContain("retryLater(message)");
  });
});

describe("nada queda sin quien vuelva por ello", () => {
  it("lo que la cola abandonó tiene barrida propia", () => {
    // La de confirmación sólo mira documentos en INDEXING; éstos ni llegaron a subirse,
    // así que cayeron a la cola de descarte, que no tiene consumidor.
    expect(sweeps).toContain("recoverAbandonedIngestion");
    expect(read("index.ts")).toContain("recoverAbandonedIngestion(env)");
  });

  it("se reconoce por lo que NO tiene, no por adivinar", () => {
    const q = readFileSync(
      join(root, "..", "..", "..", "..", "packages", "db", "src", "repositories", "documents.ts"),
      "utf8",
    );
    const fn = q.slice(q.indexOf("async listAbandonedIngestion"));
    expect(fn.slice(0, 900)).toContain("isNull(documents.aiSearchItemId)");
    expect(fn.slice(0, 900)).toContain("gte(documents.ingestionAttempts, 1)");
    expect(fn.slice(0, 900)).toContain("ingestionHeartbeatAt");
  });

  it("el rescate automático tiene techo: no reencola sin fin", () => {
    expect(ABANDONED_MAX_ATTEMPTS).toBeGreaterThan(4);
    expect(sweeps).toContain("INGESTION_ABANDONED");
  });

  it("se rescata DESPUÉS de habérselo dicho al abogado, no antes", () => {
    // Primero la verdad —esto no avanza—, y poco después el intento automático.
    expect(ABANDONED_STALE_MINUTES).toBeGreaterThan(10);
  });
});

describe("una indexación lenta no es una avería del abogado", () => {
  const base = { status: "INDEXING", attempts: 5 };
  const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

  it("agotar la cadena rápida ya no es un limbo", () => {
    expect(confirm).toContain("INDEX_CONFIRM_SLOW_DELAY_S");
    const tramo = confirm.slice(confirm.indexOf("attempt >= INDEX_CONFIRM_MAX_ATTEMPTS"));
    expect(tramo.slice(0, 2000)).toContain("scheduleIndexConfirm");
  });

  it("«Indexación demorada» es su propio estado, no «detenido»", () => {
    const s = ingestionLifecycle({ ...base, stage: "INDEXING_DELAYED", heartbeatAt: hace(90) });
    expect(s).toBe("INDEXING_DELAYED");
  });

  it("y NO ofrece reintentar: el abogado no repara la lentitud de un proveedor", () => {
    expect(canRetryIngestion("INDEXING_DELAYED")).toBe(false);
  });

  it("pero la pantalla sigue consultando: no es un estado final", () => {
    expect(isIngestionInFlight("INDEXING_DELAYED")).toBe(true);
  });

  it("lo que SÍ está detenido se sigue llamando detenido", () => {
    // Los siete PDF muertos: sin item, sin trabajo futuro. Ahí el botón corresponde.
    expect(ingestionLifecycle({ status: "PROCESSING", attempts: 4, heartbeatAt: hace(40) }))
      .toBe("PROCESSING_STALLED");
    expect(canRetryIngestion("PROCESSING_STALLED")).toBe(true);
  });

  it("un documento con trabajo vivo no se declara detenido", () => {
    expect(ingestionLifecycle({ ...base, heartbeatAt: hace(1) })).toBe("PROCESSING");
  });
});

describe("reintentar reanuda, no empieza de cero", () => {
  const route = read("routes/document-workspace.ts");

  it("con item válido y sin confirmar, se reanuda desde la confirmación", () => {
    expect(route).toContain('doc.aiSearchItemId !== null && doc.indexedAt === null');
    const tramo = route.slice(route.indexOf("doc.aiSearchItemId !== null && doc.indexedAt === null"));
    expect(tramo.slice(0, 600)).toContain('reason: "AI_SEARCH_CONFIRM"');
  });

  it("y se decide ANTES de comprobar los bytes: no hace falta leerlos", () => {
    expect(route.indexOf("resumed_from: \"AI_SEARCH_CONFIRM\""))
      .toBeLessThan(route.indexOf("const hasBytes"));
  });

  it("el ciclo de vida que autoriza el reintento ve la etapa", () => {
    // Sin la etapa, `INDEXING_DELAYED` se leía como detenido y el botón aparecía.
    const tramo = route.slice(route.indexOf("const state = ingestionLifecycle({"));
    expect(tramo.slice(0, 400)).toContain("stage: doc.ingestionStage");
  });

  it("la ingestión sigue sin re-subir un documento que ya tiene item", () => {
    expect(ingestion).toContain("doc.indexedAt !== null || doc.aiSearchItemId !== null");
  });

  it("y reutiliza la identidad en vez de crear otro item", () => {
    const tramo = ingestion.slice(ingestion.indexOf("if (doc.aiSearchItemId) {"));
    expect(tramo.slice(0, 300)).toContain("id: doc.aiSearchItemId");
  });
});

describe("la ingestión no depende del proveedor de almacenamiento", () => {
  it("un fallo de sincronización no toca la disponibilidad para el análisis", () => {
    // Los ocho indexados del lote de 19 tienen provider_sync FAILED_TERMINAL y aun así
    // están disponibles. Esa separación no puede reintroducirse.
    const i = ingestion.indexOf('stage = "AI_SEARCH_UPLOAD"');
    const j = ingestion.indexOf('stage = "PROVIDER_SYNC"');
    expect(i).toBeLessThan(j);
  });

  it("la ingestión no invoca ningún modelo JURÍDICO generativo", () => {
    /*
      Antes esta prueba decía «ningún modelo», y dejó de ser cierta al añadir el OCR:
      transcribir una imagen invoca un modelo de visión. La distinción que importa no
      es si se llama a un modelo, sino QUÉ se le pide. Aquí sólo se le pide leer lo que
      ya está escrito; interpretar el expediente es trabajo de los agentes, después, y
      sobre texto ya extraído y marcado como tal.
    */
    expect(ingestion).not.toMatch(/chatCompletion|generateText|createLegal|AGENT_/);
    const llamadas = [...ingestion.matchAll(/ai\.run\(([^,]+)/g)].map((m) => m[1]!.trim());
    expect(llamadas).toEqual(["OCR_MODEL as never"]);
  });

  it("y al modelo de visión se le pide transcribir, no opinar", () => {
    const fn = ingestion.slice(ingestion.indexOf("export async function extractTextFromImage"));
    // Determinismo: no queremos que el modelo piense sobre el documento, que lo lea.
    expect(fn.slice(0, 900)).toContain("temperature: 0");
    expect(fn.slice(0, 900)).toContain("reasoning: false");
    expect(fn.slice(0, 900)).toContain("OCR_TRANSCRIPTION_PROMPT");
  });

  it("una imagen no puede retener un consumidor indefinidamente", () => {
    const fn = ingestion.slice(ingestion.indexOf("export async function extractTextFromImage"));
    expect(fn.slice(0, 1200)).toContain("OCR_DEADLINE_MS");
  });
});

/**
 * Dos fallos MÍOS, encontrados observando el lote de 19 después de desplegar la
 * corrección. Seis de los siete documentos muertos se recuperaron solos a las 19:53,
 * sin que nadie tocara nada — incluidos los de 12,9 MB y 11,1 MB que mataban el
 * aislamiento—. Los cuatro `Ejercicio-practico` no.
 */
describe("corregir el futuro no cura el pasado", () => {
  it("la barrida también recoge lo VARADO, no sólo lo vencido", () => {
    /*
      Los cuatro quedaron con `index_confirm_next_at` en nulo, escrito por la política
      anterior. La comparación `next_at <= ahora` NUNCA es cierta sobre un nulo, así que
      la barrida pasaba por su lado sin verlos: mi arreglo evitaba crear limbo nuevo y
      dejaba intacto el que ya existía.
    */
    const q = readFileSync(
      join(root, "..", "..", "..", "..", "packages", "db", "src", "repositories", "documents.ts"),
      "utf8",
    );
    const fn = q.slice(q.indexOf("async listAwaitingIndexConfirmation"));
    expect(fn.slice(0, 2200)).toContain("isNull(documents.indexConfirmNextAt)");
    expect(fn.slice(0, 2200)).toContain("or(");
  });

  it("y sólo cuando llevan un rato callados, para no pisar una confirmación en vuelo", () => {
    const fn = sweeps.slice(sweeps.indexOf("export async function confirmIndexReadiness"));
    expect(fn.slice(0, 900)).toContain("ABANDONED_STALE_MINUTES");
  });
});

describe("la señal de «demorado» no puede ser una que otros pisen", () => {
  const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

  it("se deriva del contador de comprobaciones, que sólo crece", () => {
    /*
      Primero usé `ingestion_stage`, y era frágil: cualquier latido posterior lo
      reescribe. Los cuatro documentos varados decían `FINAL_STORAGE` porque una
      sincronización con el proveedor había pasado por encima horas después de que su
      cadena de confirmación se agotara. Con la etapa como única señal, la pantalla los
      habría llamado «Procesamiento detenido» y ofrecido un botón que los re-subía.
    */
    expect(ingestionLifecycle({
      status: "INDEXING",
      attempts: 11,
      confirmAttempts: 12,
      stage: "FINAL_STORAGE",
      heartbeatAt: hace(240),
    })).toBe("INDEXING_DELAYED");
  });

  it("por debajo del techo, un documento callado sigue siendo un documento detenido", () => {
    expect(ingestionLifecycle({
      status: "INDEXING",
      attempts: 5,
      confirmAttempts: 3,
      heartbeatAt: hace(240),
    })).toBe("PROCESSING_STALLED");
  });

  it("el endpoint de reintento lee la misma señal que la pantalla", () => {
    const route = read("routes/document-workspace.ts");
    const tramo = route.slice(route.indexOf("const state = ingestionLifecycle({"));
    expect(tramo.slice(0, 400)).toContain("confirmAttempts: doc.indexConfirmAttempts");
  });

  it("el número vive en el dominio, no duplicado a cada lado", () => {
    const dominio = readFileSync(
      join(root, "..", "..", "..", "..", "packages", "domain", "src", "ingestion-lifecycle.ts"),
      "utf8",
    );
    expect(dominio).toContain("export const INDEX_CONFIRM_EXHAUSTED_AT = 12;");
  });
});

/**
 * Reintentar tiene que rehacer lo que hace falta rehacer.
 *
 * Los cinco documentos que el lote de 19 dejó en `INDEX_CONFIRM_ABANDONED` tienen item
 * y veintitrés comprobaciones sin respuesta. Su item se construyó sobre un texto que el
 * proveedor nunca supo fragmentar —muy probablemente vacío, porque la conversión de un
 * PDF escaneado devuelve vacío— así que volver a preguntar lo mismo da lo mismo.
 */
describe("reanudar no siempre es lo correcto", () => {
  const route = read("routes/document-workspace.ts");
  const repo = readFileSync(
    join(root, "..", "..", "..", "..", "packages", "db", "src", "repositories", "documents.ts"),
    "utf8",
  );

  it("una confirmación agotada NO se reanuda: se rehace", () => {
    expect(route).toContain('doc.ingestionFailureCode === "INDEX_CONFIRM_ABANDONED"');
    const guard = route.slice(route.indexOf("const confirmAgotado"));
    expect(guard.slice(0, 400)).toContain("&& !confirmAgotado");
  });

  it("y rehacer suelta la identidad del item", () => {
    /*
      Sin esto el reproceso no rehace nada: la ingestión ve que ya hay item, da el
      trabajo por hecho —`alreadyIndexed`— y se salta la normalización entera. El item
      vacío habría sobrevivido a su propio reintento.
    */
    const fn = repo.slice(repo.indexOf("async markIngestionRetrying"));
    expect(fn.slice(0, 2600)).toContain("aiSearchItemId: null");
    expect(fn.slice(0, 2600)).toContain("indexConfirmAttempts: 0");
    expect(fn.slice(0, 2600)).toContain("r2MirrorKey: null");
  });

  it("pero sólo cuando se pide: un reintento normal conserva lo ya durable", () => {
    const fn = repo.slice(repo.indexOf("async markIngestionRetrying"));
    expect(fn.slice(0, 2600)).toContain("rebuildContent");
    expect(fn.slice(0, 2600)).toMatch(/\.\.\.\(rebuildContent\s*\n?\s*\?/);
  });

  it("la ingestión da por hecho el trabajo justamente por esa identidad", () => {
    // Es la razón por la que soltarla es la única forma de rehacer el contenido.
    expect(ingestion).toContain("doc.indexedAt !== null || doc.aiSearchItemId !== null");
  });
});
