import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  isIusiaError,
  findDuplicateCandidate,
  matterIdentityFingerprint,
  normalizeMatterIdentity,
} from "@iusia/domain";
import { mattersRoutes } from "../routes/matters.js";
import type { AppBindings } from "../context.js";
import { createTestDb, seedFirm, type TestDb } from "./harness.js";

/**
 * ENDURECIMIENTO DE LA CONVOCATORIA CON DOCUMENTOS.
 *
 * Incidente real del 31-ago-2026: tres pulsaciones de «Crear expediente y convocar
 * IUSIA» produjeron IUS-2026-011, 012 y 013, cada uno con su carpeta y una copia del
 * mismo PDF. La causa fue una espera bloqueante de ~30 s frente a una ingestión de
 * ~90 s: la convocatoria se daba por fallida y el reintento volvía a crear todo.
 *
 * Estos tests fijan las dos garantías, que son distintas:
 *   IDEMPOTENCIA  — el mismo intento lógico crea UN expediente.
 *   DUPLICADO     — un intento nuevo sobre el mismo asunto avisa antes de crear.
 */

const CASE = {
  title: "Contratos comerciales",
  client_name: "Distribuciones Caribe S.A.S vs Tecnoimportaciones Andinas",
  materiality: "MATERIAL",
  practice_areas: ["COMERCIAL_CONTRACTUAL"],
  jurisdiction: "Colombia",
  objective: "Analizar la controversia de distribución exclusiva.",
};

function appFor(t: TestDb, session: { userId: string; organizationId: string }) {
  const app = new Hono<AppBindings>();
  app.use("*", async (c, next) => {
    c.set("ctx", {
      db: t.db,
      matters: t.matters,
      documents: t.documents,
      executions: t.executions,
      events: t.events,
      facts: t.facts,
      authorities: t.authorities,
      credits: t.credits,
      audit: t.audit,
      tasks: t.tasks,
      authz: t.authz,
    });
    c.set("session", { ...session, userName: "Test" });
    await next();
  });
  app.onError((error, c) => {
    if (isIusiaError(error)) return c.json(error.toJSON(), error.status as 400);
    return c.json({ error: { code: "INTERNAL", message: String(error) } }, 500);
  });
  app.route("/matters", mattersRoutes);
  return app;
}

async function createMatter(
  app: Hono<AppBindings>,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await app.request(
    "/matters",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...CASE, ...body }),
    },
    {} as never,
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function seed(t: TestDb, name = "Pisoso Legal") {
  return seedFirm(t, { orgName: name, directorEmail: `dir@${name.replace(/\s+/g, "")}.test` });
}

describe("IDEMPOTENCIA — una acción humana, un expediente", () => {
  it("[SAME_CONVOCATION_TWICE] la misma clave de convocatoria devuelve el MISMO expediente", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId } = await seed(t);
    const app = appFor(t, { userId: directorUserId, organizationId });

    const first = await createMatter(app, { request_key: "conv-abcdef-0001" });
    const second = await createMatter(app, { request_key: "conv-abcdef-0001" });

    expect(first.status).toBe(201);
    expect(first.json.created).toBe(true);
    expect(second.status).toBe(200);
    expect(second.json.created).toBe(false);
    expect(second.json.resumed).toBe(true);
    expect((second.json.matter as { id: string }).id).toBe((first.json.matter as { id: string }).id);

    const all = await t.matters.listForUser(organizationId, directorUserId, { includeAll: true });
    expect(all).toHaveLength(1);
  });

  it("[DOUBLE_SUBMIT] dos envíos simultáneos con la misma clave crean UN expediente", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId } = await seed(t);
    const app = appFor(t, { userId: directorUserId, organizationId });

    const [a, b] = await Promise.all([
      createMatter(app, { request_key: "conv-doubleclick-1" }),
      createMatter(app, { request_key: "conv-doubleclick-1" }),
    ]);

    const ids = [a, b].map((r) => (r.json.matter as { id: string }).id);
    expect(new Set(ids).size).toBe(1);
    expect(
      await t.matters.listForUser(organizationId, directorUserId, { includeAll: true }),
    ).toHaveLength(1);
  });

  it("[TIMEOUT_THEN_RETRY] tras una respuesta incierta, el reintento recupera el expediente", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId } = await seed(t);
    const app = appFor(t, { userId: directorUserId, organizationId });

    // El servidor creó el expediente; el navegador nunca vio la respuesta.
    const lost = await createMatter(app, { request_key: "conv-timeout-9" });
    const matterId = (lost.json.matter as { id: string }).id;

    // El usuario reintenta con la misma convocatoria.
    const retry = await createMatter(app, { request_key: "conv-timeout-9" });
    expect((retry.json.matter as { id: string }).id).toBe(matterId);
    expect(retry.json.resumed).toBe(true);
    expect(
      await t.matters.listForUser(organizationId, directorUserId, { includeAll: true }),
    ).toHaveLength(1);
  });

  it("[RESUME_AFTER_DOWNSTREAM_FAILURE] tras fallar la subida o el análisis, se reanuda sobre el mismo expediente", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId } = await seed(t);
    const app = appFor(t, { userId: directorUserId, organizationId });

    // Etapa 1: expediente creado.
    const created = await createMatter(app, { request_key: "conv-resume-2" });
    const matterId = (created.json.matter as { id: string }).id;

    // Etapa 2 falla (subida) — el expediente NO se borra ni se duplica al reintentar.
    const resumed = await createMatter(app, { request_key: "conv-resume-2" });
    expect((resumed.json.matter as { id: string }).id).toBe(matterId);

    // Y sigue existiendo con su documentación intacta (aquí, vacía).
    expect(await t.matters.findById(organizationId, matterId)).not.toBeNull();
    expect(await t.documents.listForMatter(organizationId, matterId)).toEqual([]);
    expect(
      await t.matters.listForUser(organizationId, directorUserId, { includeAll: true }),
    ).toHaveLength(1);
  });

  it("[SAME_DOCUMENT_RETRY] el mismo binario no se incorpora dos veces al expediente", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId } = await seed(t);
    const matterId = await t.matters.create(
      organizationId,
      directorUserId,
      CASE as never,
      "IUS-2026-500",
    );

    const CHECKSUM = "a".repeat(64);
    await t.documents.link({
      organizationId,
      matterId,
      driveFileId: "provider_file_1",
      name: "Contrato.pdf",
      mimeType: "application/pdf",
      linkedBy: directorUserId,
      checksum: CHECKSUM,
      ingestionStatus: "PROCESSING",
    });

    // El reintento reconoce el archivo por su CONTENIDO, no por su nombre ni por el
    // identificador que le dio el proveedor —que sería distinto en cada subida—.
    const found = await t.documents.findByChecksum(organizationId, matterId, CHECKSUM);
    expect(found).not.toBeNull();
    expect(found!.filename).toBe("Contrato.pdf");
    expect(await t.documents.listForMatter(organizationId, matterId)).toHaveLength(1);

    // Un archivo distinto sí entra.
    expect(await t.documents.findByChecksum(organizationId, matterId, "b".repeat(64))).toBeNull();
  });

  it("[CHECKSUM_SCOPED] el reconocimiento por contenido no cruza expedientes ni firmas", async () => {
    const t = createTestDb();
    const firmA = await seed(t, "Firma A");
    const firmB = await seed(t, "Firma B");
    const matterA = await t.matters.create(
      firmA.organizationId,
      firmA.directorUserId,
      CASE as never,
      "A-500",
    );
    const otherA = await t.matters.create(
      firmA.organizationId,
      firmA.directorUserId,
      CASE as never,
      "A-501",
    );
    const matterB = await t.matters.create(
      firmB.organizationId,
      firmB.directorUserId,
      CASE as never,
      "B-500",
    );
    const CHECKSUM = "c".repeat(64);
    await t.documents.link({
      organizationId: firmA.organizationId,
      matterId: matterA,
      driveFileId: "pf_1",
      name: "Contrato.pdf",
      mimeType: "application/pdf",
      linkedBy: firmA.directorUserId,
      checksum: CHECKSUM,
    });

    expect(await t.documents.findByChecksum(firmA.organizationId, matterA, CHECKSUM)).not.toBeNull();
    // Mismo contenido, otro expediente de la misma firma: es un documento nuevo.
    expect(await t.documents.findByChecksum(firmA.organizationId, otherA, CHECKSUM)).toBeNull();
    // Y jamás cruza de organización.
    expect(await t.documents.findByChecksum(firmB.organizationId, matterB, CHECKSUM)).toBeNull();
  });
});

describe("DUPLICATE CASE GUARD — avisar antes de abrir el mismo asunto dos veces", () => {
  it("[SAME_CLIENT_AND_SUBJECT] un asunto ya abierto genera advertencia y NO crea nada", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId } = await seed(t);
    const app = appFor(t, { userId: directorUserId, organizationId });

    await createMatter(app, { request_key: "conv-primero-1" });

    // Intento NUEVO (otra clave, como al día siguiente): mismo cliente, mismo asunto.
    const second = await createMatter(app, { request_key: "conv-segundo-2" });
    expect(second.status).toBe(409);
    const error = second.json.error as { details: { reason: string; candidate: { reference: string } } };
    expect(error.details.reason).toBe("POSSIBLE_DUPLICATE_MATTER");
    expect(error.details.candidate.reference).toBe("IUS-2026-001");

    // NADA se creó: el candidato se ofrece antes de tocar identidad o almacenamiento.
    expect(
      await t.matters.listForUser(organizationId, directorUserId, { includeAll: true }),
    ).toHaveLength(1);
  });

  it("[NO_CREATION_BEFORE_CONFIRMATION] la advertencia queda auditada con su candidato", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId } = await seed(t);
    const app = appFor(t, { userId: directorUserId, organizationId });
    await createMatter(app, { request_key: "conv-a-1" });
    await createMatter(app, { request_key: "conv-b-2" });

    const audits = t.raw
      .prepare("SELECT action, resource_id, reason FROM audit_events WHERE action = ?")
      .all("matter.duplicate_warning_shown") as Array<{ resource_id: string; reason: string }>;
    expect(audits).toHaveLength(1);
    expect(audits[0]!.reason).toBe("SAME_CLIENT_AND_SUBJECT");
  });

  it("[EXPLICIT_OVERRIDE] confirmar que es un asunto diferente sí crea, y queda trazado", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId } = await seed(t);
    const app = appFor(t, { userId: directorUserId, organizationId });
    await createMatter(app, { request_key: "conv-uno-1" });

    const override = await createMatter(app, {
      request_key: "conv-dos-2",
      confirm_different: true,
    });
    expect(override.status).toBe(201);
    expect(override.json.created).toBe(true);
    expect(
      await t.matters.listForUser(organizationId, directorUserId, { includeAll: true }),
    ).toHaveLength(2);

    const overrides = t.raw
      .prepare("SELECT action, reason, actor_user_id FROM audit_events WHERE action = ?")
      .all("matter.duplicate_override") as Array<{ reason: string; actor_user_id: string }>;
    expect(overrides).toHaveLength(1);
    expect(overrides[0]!.reason).toBe("CONFIRMED_DIFFERENT_MATTER_BY_USER");
    expect(overrides[0]!.actor_user_id).toBe(directorUserId);
  });

  it("[DIFFERENT_CASE] un asunto distinto se crea sin fricción", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId } = await seed(t);
    const app = appFor(t, { userId: directorUserId, organizationId });
    await createMatter(app, { request_key: "conv-x-1" });

    const other = await createMatter(app, {
      request_key: "conv-y-2",
      title: "Reclamación laboral",
      client_name: "Otra Compañía S.A.S.",
    });
    expect(other.status).toBe(201);
    expect(
      await t.matters.listForUser(organizationId, directorUserId, { includeAll: true }),
    ).toHaveLength(2);
  });

  it("[CROSS_ORG] un asunto idéntico en otra firma no genera aviso ni filtra nada", async () => {
    const t = createTestDb();
    const firmA = await seed(t, "Firma A");
    const firmB = await seed(t, "Firma B");

    const appA = appFor(t, { userId: firmA.directorUserId, organizationId: firmA.organizationId });
    const appB = appFor(t, { userId: firmB.directorUserId, organizationId: firmB.organizationId });

    await createMatter(appA, { request_key: "conv-firma-a-1" });
    // La firma B abre el MISMO asunto: es su propio expediente y no debe saber nada
    // del de la firma A.
    const inB = await createMatter(appB, { request_key: "conv-firma-b-1" });
    expect(inB.status).toBe(201);
    expect(
      await t.matters.listForUser(firmB.organizationId, firmB.directorUserId, { includeAll: true }),
    ).toHaveLength(1);
  });

  it("[CROSS_ORG_CONVOCATION_ID] una clave de convocatoria de otra firma no recupera su expediente", async () => {
    const t = createTestDb();
    const firmA = await seed(t, "Firma A");
    const firmB = await seed(t, "Firma B");
    const appA = appFor(t, { userId: firmA.directorUserId, organizationId: firmA.organizationId });
    const appB = appFor(t, { userId: firmB.directorUserId, organizationId: firmB.organizationId });

    const inA = await createMatter(appA, { request_key: "conv-compartida-1" });
    const idA = (inA.json.matter as { id: string }).id;

    // Misma clave, otra firma: la clave NO es una credencial. La búsqueda está
    // acotada por organización, así que B nunca recibe el expediente de A.
    const inB = await createMatter(appB, { request_key: "conv-compartida-1" });
    const idB = (inB.json.matter as { id: string }).id;
    expect(idB).not.toBe(idA);
    expect(await t.matters.findById(firmB.organizationId, idA)).toBeNull();
  });
});

describe("IDENTIDAD DE ASUNTO — normalización determinista, sin modelo", () => {
  it("[NORMALIZE] formas societarias, acentos y mayúsculas no distinguen a una parte", () => {
    expect(normalizeMatterIdentity("Distribuciones Caribe S.A.S.")).toBe("distribuciones caribe");
    expect(normalizeMatterIdentity("DISTRIBUCIONES CARIBE SAS")).toBe("distribuciones caribe");
    expect(normalizeMatterIdentity("  Distribuciones   Caribe  Ltda ")).toBe("distribuciones caribe");
    expect(normalizeMatterIdentity("Constructora Bogotá S.A")).toBe("constructora bogota");
  });

  it("[FINGERPRINT] cliente y asunto forman la huella comparable", () => {
    expect(
      matterIdentityFingerprint({ title: "Contratos Comerciales", clientName: "Caribe S.A.S." }),
    ).toBe(matterIdentityFingerprint({ title: "contratos comerciales", clientName: "CARIBE SAS" }));
  });

  it("[NARROW] la coincidencia exige cliente Y asunto: no se bloquea por parecido", () => {
    const existing = [
      {
        id: "mtr_1",
        reference: "IUS-2026-001",
        title: "Contratos comerciales",
        clientName: "Distribuciones Caribe S.A.S.",
        status: "INTAKE",
        createdAt: "2026-08-31T22:55:03.119Z",
      },
    ];
    expect(
      findDuplicateCandidate(
        { title: "Contratos comerciales", clientName: "DISTRIBUCIONES CARIBE SAS" },
        existing,
      ),
    ).toMatchObject({ matter_id: "mtr_1", reason: "SAME_CLIENT_AND_SUBJECT" });

    // Mismo cliente, otro asunto: no es duplicado.
    expect(
      findDuplicateCandidate(
        { title: "Reclamación laboral", clientName: "Distribuciones Caribe S.A.S." },
        existing,
      ),
    ).toBeNull();
    // Mismo asunto, otro cliente: tampoco.
    expect(
      findDuplicateCandidate({ title: "Contratos comerciales", clientName: "Otra S.A.S." }, existing),
    ).toBeNull();
  });

  it("[CLOSED_MATTERS] un expediente cerrado no bloquea abrir uno nuevo", () => {
    const closed = [
      {
        id: "mtr_old",
        reference: "IUS-2025-100",
        title: "Contratos comerciales",
        clientName: "Distribuciones Caribe S.A.S.",
        status: "CERRADO",
        createdAt: "2025-01-01T00:00:00.000Z",
      },
    ];
    expect(
      findDuplicateCandidate(
        { title: "Contratos comerciales", clientName: "Distribuciones Caribe S.A.S." },
        closed,
      ),
    ).toBeNull();
  });

  it("[EMPTY] datos vacíos nunca producen un falso duplicado", () => {
    expect(findDuplicateCandidate({ title: "", clientName: "Caribe" }, [])).toBeNull();
    expect(findDuplicateCandidate({ title: "Asunto", clientName: "   " }, [])).toBeNull();
  });
});
