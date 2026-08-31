import { describe, expect, it } from "vitest";
import { createTestDb, seedFirm, type TestDb } from "./harness.js";

/**
 * CONCURRENCIA DEL LEDGER — las dos escrituras que asumían una atomicidad que D1 no da.
 *
 * La auditoría encontró dos read-then-write: la secuencia de eventos de ejecución
 * (`max(sequence)+1` leído y luego insertado) y el saldo de créditos (leído, sumado en
 * JS y reescrito como valor absoluto). Ninguna fallaba en un test secuencial; ambas
 * fallaban con paralelismo real, que es justo el modo en que corre la orquestación
 * dinámica.
 *
 * Estos tests certifican las dos dimensiones:
 *  - COMPORTAMIENTO: el resultado agregado es correcto y wallet y ledger reconcilian.
 *  - ESTRUCTURA: la mutación se emite como SQL relativo / subconsulta escalar. Es la
 *    parte que un driver síncrono como better-sqlite3 no puede demostrar por sí solo,
 *    porque no interleava de verdad; sin ella el test pasaría también con el bug.
 */

/** Captura el SQL realmente emitido contra SQLite. */
function captureSql(t: TestDb): string[] {
  const seen: string[] = [];
  const original = t.raw.prepare.bind(t.raw);
  (t.raw as unknown as { prepare: (sql: string) => unknown }).prepare = (sql: string) => {
    seen.push(sql);
    return original(sql);
  };
  return seen;
}

async function seedMatter(t: TestDb) {
  const { organizationId, directorUserId } = await seedFirm(t, {
    orgName: "Concurrencia",
    directorEmail: "dir@concurrencia.test",
  });
  const matterId = await t.matters.create(
    organizationId,
    directorUserId,
    {
      title: "Expediente de concurrencia",
      client_name: "Cliente",
      materiality: "HIGH_STAKES",
      practice_areas: ["COMERCIAL"],
      jurisdiction: "Colombia",
      parties: [],
    } as never,
    "IUS-2026-900",
  );
  return { organizationId, directorUserId, matterId };
}

describe("CREDITS — mutación atómica del saldo", () => {
  it("[PARALLEL_CREDITS] 1000 − 300 − 400 = 300, y wallet reconcilia con el ledger", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId, matterId } = await seedMatter(t);

    await t.credits.ensureWallet(organizationId, 0);
    await t.credits.post({
      organizationId,
      kind: "GRANT",
      amount: 1000,
      idempotencyKey: `grant:${organizationId}`,
    });

    await Promise.all([
      t.credits.post({
        organizationId,
        kind: "CONSUMPTION",
        amount: -300,
        idempotencyKey: "execution:exe_a",
        matterId,
        userId: directorUserId,
      }),
      t.credits.post({
        organizationId,
        kind: "CONSUMPTION",
        amount: -400,
        idempotencyKey: "execution:exe_b",
        matterId,
        userId: directorUserId,
      }),
    ]);

    expect(await t.credits.balance(organizationId)).toBe(300);

    const reconciliation = await t.credits.reconcile(organizationId);
    expect(reconciliation).toEqual({ walletBalance: 300, ledgerBalance: 300, reconciled: true });
  });

  it("[NO_LOST_UPDATE] el saldo se muta en SQL como balance + amount, no como valor absoluto", async () => {
    const t = createTestDb();
    const { organizationId } = await seedMatter(t);
    await t.credits.ensureWallet(organizationId, 0);

    const sql = captureSql(t);
    await t.credits.post({
      organizationId,
      kind: "GRANT",
      amount: 500,
      idempotencyKey: `grant-structural:${organizationId}`,
    });

    const walletUpdate = sql.find((s) => /update .*credit_wallets/i.test(s) && /set/i.test(s));
    expect(walletUpdate, "debe existir un UPDATE del wallet").toBeDefined();
    // La forma relativa es lo que impide perder un débito concurrente.
    expect(walletUpdate).toMatch(/"balance"\s*=\s*"credit_wallets"\."balance"\s*\+/i);
    expect(walletUpdate).not.toMatch(/"balance"\s*=\s*\?\s*,/);
  });

  it("[NO_DOUBLE_CHARGE] dos reintentos simultáneos con la misma clave cobran una vez", async () => {
    const t = createTestDb();
    const { organizationId, matterId } = await seedMatter(t);
    await t.credits.ensureWallet(organizationId, 0);
    await t.credits.post({
      organizationId,
      kind: "GRANT",
      amount: 1000,
      idempotencyKey: `grant:${organizationId}`,
    });

    const results = await Promise.all([
      t.credits.post({
        organizationId,
        kind: "CONSUMPTION",
        amount: -250,
        idempotencyKey: "execution:exe_retry",
        matterId,
      }),
      t.credits.post({
        organizationId,
        kind: "CONSUMPTION",
        amount: -250,
        idempotencyKey: "execution:exe_retry",
        matterId,
      }),
    ]);

    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect(await t.credits.balance(organizationId)).toBe(750);
    expect((await t.credits.reconcile(organizationId)).reconciled).toBe(true);
  });

  it("[NO_ACCIDENTAL_NEGATIVE] sin allowNegative el débito se rechaza y no deja asiento", async () => {
    const t = createTestDb();
    const { organizationId } = await seedMatter(t);
    await t.credits.ensureWallet(organizationId, 0);
    await t.credits.post({
      organizationId,
      kind: "GRANT",
      amount: 100,
      idempotencyKey: `grant:${organizationId}`,
    });

    await expect(
      t.credits.post({
        organizationId,
        kind: "CONSUMPTION",
        amount: -500,
        idempotencyKey: "execution:exe_too_big",
      }),
    ).rejects.toThrow(/insuficiente/i);

    expect(await t.credits.balance(organizationId)).toBe(100);
    // La reclamación se revierte: un reintento posterior con la misma clave debe poder
    // volver a intentarlo cuando la firma recargue saldo.
    expect((await t.credits.reconcile(organizationId)).reconciled).toBe(true);
  });
});

describe("EXECUTION EVENTS — secuencia sin carrera", () => {
  it("[EVENT_SEQUENCE] la secuencia se asigna dentro del INSERT, no con un SELECT previo", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId, matterId } = await seedMatter(t);
    const rootId = await t.executions.create({
      organizationId,
      matterId,
      agentId: "pisoso-orquestador-juridico",
      parentExecutionId: null,
      rootExecutionId: null,
      startedBy: directorUserId,
    });

    const sql = captureSql(t);
    await t.events.append({
      organizationId,
      matterId,
      rootExecutionId: rootId,
      executionId: rootId,
      type: "execution.created",
      status: "RUNNING",
      detail: { mode: "dynamic" },
    });

    const insert = sql.find((s) => /insert into .*execution_events/i.test(s));
    expect(insert, "debe existir un INSERT de evento").toBeDefined();
    // Subconsulta escalar dentro del propio INSERT: atómico en SQLite/D1.
    expect(insert).toMatch(/select\s+coalesce\(max\(/i);
    expect(sql.filter((s) => /^select .*max\(/i.test(s.trim()))).toHaveLength(0);
  });

  it("[PARALLEL_EVENTS] doce eventos concurrentes producen secuencias únicas y contiguas", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId, matterId } = await seedMatter(t);
    const rootId = await t.executions.create({
      organizationId,
      matterId,
      agentId: "pisoso-orquestador-juridico",
      parentExecutionId: null,
      rootExecutionId: null,
      startedBy: directorUserId,
    });

    const sequences = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        t.events.append({
          organizationId,
          matterId,
          rootExecutionId: rootId,
          executionId: rootId,
          type: "agent.dispatched",
          status: "PENDING",
          detail: { batch: i },
        }),
      ),
    );

    expect(new Set(sequences).size).toBe(12);
    expect([...sequences].sort((a, b) => a - b)).toEqual([...Array(12).keys()]);

    const stored = await t.events.listByRoot(rootId);
    expect(stored).toHaveLength(12);
  });
});

describe("EXECUTION IDENTITY — un reintento técnico no es una ejecución jurídica nueva", () => {
  it("[RETRY_IDENTITY] el mismo dispatch_key devuelve la MISMA ejecución y cuenta el reintento", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId, matterId } = await seedMatter(t);
    const rootId = await t.executions.create({
      organizationId,
      matterId,
      agentId: "pisoso-orquestador-juridico",
      parentExecutionId: null,
      rootExecutionId: null,
      startedBy: directorUserId,
    });

    const dispatchKey = `${rootId}:task:t1`;
    const first = await t.executions.create({
      organizationId,
      matterId,
      agentId: "03-investigador-normativo-jurisprudencial",
      parentExecutionId: rootId,
      rootExecutionId: rootId,
      startedBy: directorUserId,
      dispatchKey,
    });
    // Reintento del step: mismo despacho lógico.
    const second = await t.executions.create({
      organizationId,
      matterId,
      agentId: "03-investigador-normativo-jurisprudencial",
      parentExecutionId: rootId,
      rootExecutionId: rootId,
      startedBy: directorUserId,
      dispatchKey,
    });

    expect(second).toBe(first);
    const rows = (await t.executions.listByRoot(rootId)).filter((r) => r.id !== rootId);
    expect(rows, "un reintento no puede crear una segunda fila").toHaveLength(1);
    expect(rows[0]!.retries).toBe(1);
  });

  it("[NO_DUPLICATE_CHARGE_ON_RETRY] al conservar la ejecución, la clave de crédito no cambia", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId, matterId } = await seedMatter(t);
    await t.credits.ensureWallet(organizationId, 0);
    await t.credits.post({
      organizationId,
      kind: "GRANT",
      amount: 1000,
      idempotencyKey: `grant:${organizationId}`,
    });
    const rootId = await t.executions.create({
      organizationId,
      matterId,
      agentId: "pisoso-orquestador-juridico",
      parentExecutionId: null,
      rootExecutionId: null,
      startedBy: directorUserId,
    });
    const dispatchKey = `${rootId}:task:t1`;

    // Dos pasadas del mismo despacho (la segunda es el reintento del Workflow).
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const executionId = await t.executions.create({
        organizationId,
        matterId,
        agentId: "04-analista-probatorio-y-pericial",
        parentExecutionId: rootId,
        rootExecutionId: rootId,
        startedBy: directorUserId,
        dispatchKey,
      });
      await t.credits.post({
        organizationId,
        kind: "CONSUMPTION",
        amount: -120,
        idempotencyKey: `execution:${executionId}`,
        matterId,
        executionId,
      });
    }

    expect(await t.credits.balance(organizationId)).toBe(880);
    expect((await t.credits.reconcile(organizationId)).reconciled).toBe(true);
  });

  it("[UI_RETRY_DUPLICATE_ROWS] el árbol del grafo no muestra filas fantasma", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId, matterId } = await seedMatter(t);
    const rootId = await t.executions.create({
      organizationId,
      matterId,
      agentId: "pisoso-orquestador-juridico",
      parentExecutionId: null,
      rootExecutionId: null,
      startedBy: directorUserId,
    });

    // Tres especialistas, cada uno con un reintento.
    for (const agentId of [
      "01-intake-y-clasificador",
      "03-investigador-normativo-jurisprudencial",
      "05-analista-procesal-y-procedibilidad",
    ]) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await t.executions.create({
          organizationId,
          matterId,
          agentId,
          parentExecutionId: rootId,
          rootExecutionId: rootId,
          startedBy: directorUserId,
          dispatchKey: `${rootId}:task:${agentId}`,
        });
      }
    }

    const rows = (await t.executions.listByRoot(rootId)).filter((r) => r.id !== rootId);
    expect(rows).toHaveLength(3);
  });
});
