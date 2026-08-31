import { describe, expect, it } from "vitest";
import {
  ABANDONED_ROOT_AFTER_MINUTES,
  isAbandonedRoot,
  matterLoadFailure,
} from "@iusia/domain";
import { createTestDb, seedFirm, type TestDb } from "./harness.js";

/**
 * INCIDENTE REAL DEL 31-ago-2026 EN STAGING.
 *
 * Durante la ejecución text-only del matter `mtr_3fhcmeh9kd4ztyzx` —que completó
 * correctamente— la interfaz mostró dos cosas que no eran ciertas:
 *
 *  1. «IUSIA · 2 en curso», cuando sólo había un análisis vivo. El segundo era la
 *     raíz `exe_7z674k96750at0w0`, RUNNING en el ledger desde el 27-ago porque su
 *     Workflow murió sin cerrarla (la API de Cloudflare responde `instance.not_found`).
 *  2. «Expediente no disponible» ante un 503 transitorio, indistinguible de un
 *     expediente inexistente o de una falta de autorización.
 */

async function seedMatter(t: TestDb, reference: string) {
  const { organizationId, directorUserId } = await seedFirm(t, {
    orgName: `Firma ${reference}`,
    directorEmail: `dir-${reference}@test.test`,
  });
  const matterId = await t.matters.create(
    organizationId,
    directorUserId,
    {
      title: `Expediente ${reference}`,
      client_name: "Cliente",
      materiality: "HIGH_STAKES",
      practice_areas: ["COMERCIAL"],
      jurisdiction: "Colombia",
      parties: [],
    } as never,
    reference,
  );
  return { organizationId, directorUserId, matterId };
}

/** Inserta una raíz con un `created_at` arbitrario, para simular antigüedad real. */
function seedRootAt(
  t: TestDb,
  args: {
    id: string;
    organizationId: string;
    matterId: string;
    userId: string;
    status: string;
    createdAt: string;
  },
) {
  t.raw
    .prepare(
      `INSERT INTO executions
         (id, organization_id, matter_id, agent_id, parent_execution_id, root_execution_id,
          status, retries, started_by, created_at)
       VALUES (?,?,?,?,NULL,?,?,0,?,?)`,
    )
    .run(
      args.id,
      args.organizationId,
      args.matterId,
      "pisoso-orquestador-juridico",
      args.id,
      args.status,
      args.userId,
      args.createdAt,
    );
}

describe("ACTIVE ROOTS — el indicador no puede afirmar trabajo que no ocurre", () => {
  it("[ORPHAN_NOT_COUNTED] una raíz abandonada deja de contarse como análisis en curso", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId, matterId } = await seedMatter(t, "IUS-2026-900");
    const now = new Date("2026-08-31T22:20:00.000Z");

    // Reproduce el caso real: una raíz viva y otra RUNNING desde hace cuatro días.
    seedRootAt(t, {
      id: "exe_viva",
      organizationId,
      matterId,
      userId: directorUserId,
      status: "RUNNING",
      createdAt: "2026-08-31T22:15:25.895Z",
    });
    seedRootAt(t, {
      id: "exe_huerfana",
      organizationId,
      matterId,
      userId: directorUserId,
      status: "RUNNING",
      createdAt: "2026-08-27T15:49:27.477Z",
    });

    const active = await t.executions.listActiveRoots(organizationId, 20, now);
    expect(active.map((r) => r.id)).toEqual(["exe_viva"]);

    // Y la huérfana no desaparece: sigue siendo evidencia, sólo deja de mentir.
    const abandoned = await t.executions.listAbandonedRoots(organizationId, 20, now);
    expect(abandoned.map((r) => r.id)).toEqual(["exe_huerfana"]);
    expect((await t.executions.findById("exe_huerfana"))!.status).toBe("RUNNING");
  });

  it("[SLOW_RUN_STILL_ACTIVE] un análisis lento pero vivo sigue contándose", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId, matterId } = await seedMatter(t, "IUS-2026-901");
    const now = new Date("2026-08-31T22:30:00.000Z");
    // La ejecución real del incidente duró 11 minutos: el margen no puede ocultarla.
    seedRootAt(t, {
      id: "exe_lenta",
      organizationId,
      matterId,
      userId: directorUserId,
      status: "RUNNING",
      createdAt: "2026-08-31T22:15:25.895Z",
    });
    const active = await t.executions.listActiveRoots(organizationId, 20, now);
    expect(active.map((r) => r.id)).toEqual(["exe_lenta"]);
  });

  it("[TERMINAL_NEVER_ACTIVE] COMPLETED, FAILED y CANCELLED nunca cuentan como activas", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId, matterId } = await seedMatter(t, "IUS-2026-902");
    const now = new Date("2026-08-31T22:20:00.000Z");
    for (const [id, status] of [
      ["exe_c", "COMPLETED"],
      ["exe_f", "FAILED"],
      ["exe_x", "CANCELLED"],
    ] as const) {
      seedRootAt(t, {
        id,
        organizationId,
        matterId,
        userId: directorUserId,
        status,
        createdAt: "2026-08-31T22:15:00.000Z",
      });
    }
    expect(await t.executions.listActiveRoots(organizationId, 20, now)).toEqual([]);
    expect(await t.executions.listAbandonedRoots(organizationId, 20, now)).toEqual([]);
  });

  it("[NO_DUPLICATE_ROOTS] la idempotencia de despacho no crea raíces duplicadas", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId, matterId } = await seedMatter(t, "IUS-2026-903");
    // Las raíces se crean sin dispatch_key; varias raíces conviven sin colisionar,
    // y cada despacho lógico dentro de una raíz sigue teniendo una sola ejecución.
    const a = await t.executions.create({
      organizationId,
      matterId,
      agentId: "pisoso-orquestador-juridico",
      parentExecutionId: null,
      rootExecutionId: null,
      startedBy: directorUserId,
    });
    const b = await t.executions.create({
      organizationId,
      matterId,
      agentId: "pisoso-orquestador-juridico",
      parentExecutionId: null,
      rootExecutionId: null,
      startedBy: directorUserId,
    });
    expect(a).not.toBe(b);
    const roots = await t.executions.listActiveRoots(organizationId, 20);
    expect(roots).toHaveLength(2);
    expect(roots.every((r) => r.dispatchKey === null)).toBe(true);
  });

  it("[MARGIN] el margen de abandono es holgado frente al límite del motor", () => {
    expect(ABANDONED_ROOT_AFTER_MINUTES).toBeGreaterThanOrEqual(30);
    const created = "2026-08-31T22:15:00.000Z";
    expect(isAbandonedRoot(created, new Date("2026-08-31T22:40:00.000Z"))).toBe(false);
    expect(isAbandonedRoot(created, new Date("2026-08-31T22:50:00.000Z"))).toBe(true);
    // Una fecha ilegible nunca declara abandono: ante la duda, no se oculta nada.
    expect(isAbandonedRoot("no-es-una-fecha")).toBe(false);
  });
});

describe("RESILIENCIA DE LA VISTA — un 503 no es un expediente inexistente", () => {
  it("[TRANSIENT_5XX] un fallo del servicio se declara temporal y se puede reintentar", () => {
    const failure = matterLoadFailure(503);
    expect(failure.title).toBe("No fue posible cargar el expediente");
    expect(failure.title).not.toMatch(/no disponible|no encontrado/i);
    expect(failure.hint).toMatch(/temporal/i);
    // Y se dice lo único que tranquiliza: el análisis sigue trabajando.
    expect(failure.hint).toMatch(/sigue trabajando/i);
    expect(failure.retryable).toBe(true);
    expect(matterLoadFailure(500).retryable).toBe(true);
    expect(matterLoadFailure(502).retryable).toBe(true);
    // Fallo de red (sin status) también es reintentable.
    expect(matterLoadFailure(0).retryable).toBe(true);
  });

  it("[NOT_FOUND] un expediente inexistente o sin asignar se dice como tal, sin reintento", () => {
    const failure = matterLoadFailure(404);
    expect(failure.title).toBe("Expediente no encontrado");
    expect(failure.retryable).toBe(false);
  });

  it("[FORBIDDEN] la falta de acceso explica qué hacer, y no se reintenta", () => {
    const failure = matterLoadFailure(403);
    expect(failure.title).toMatch(/sin acceso/i);
    expect(failure.hint).toMatch(/dirección de la firma/i);
    expect(failure.retryable).toBe(false);
  });

  it("[UNAUTHENTICATED] una sesión expirada no se confunde con un problema del expediente", () => {
    expect(matterLoadFailure(401).title).toMatch(/sesión expirada/i);
    expect(matterLoadFailure(401).retryable).toBe(false);
  });

  it("[DISTINCT] los cuatro desenlaces son textos distintos entre sí", () => {
    const titles = [401, 403, 404, 503].map((s) => matterLoadFailure(s).title);
    expect(new Set(titles).size).toBe(4);
  });
});
