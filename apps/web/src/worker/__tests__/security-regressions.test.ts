import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { isIusiaError } from "@iusia/domain";
import { mattersRoutes } from "../routes/matters.js";
import { documentsRoutes } from "../routes/documents.js";
import { assertCanAssignFirmRole } from "../routes/admin.js";
import type { AppBindings } from "../context.js";
import { addUser, createTestDb, seedFirm, type TestDb } from "./harness.js";

/**
 * REGRESIONES DE SEGURIDAD de la auditoría del Core.
 *
 * Se ejercitan los HANDLERS REALES sobre SQLite real: el ACL, la resolución de tenant
 * y la respuesta son las de producción. Lo único inyectado es la sesión, que en el
 * Worker la fija Better Auth y aquí sería ruido.
 */

/** Monta rutas reales con un contexto y una sesión ya resueltos. */
function appFor(
  t: TestDb,
  session: { userId: string; organizationId: string },
  env: Record<string, unknown> = {},
) {
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
  app.route("/", documentsRoutes);
  return { app, env: env as never };
}

async function newMatter(t: TestDb, organizationId: string, userId: string, reference: string) {
  return t.matters.create(
    organizationId,
    userId,
    {
      title: `Expediente ${reference}`,
      client_name: "Cliente",
      materiality: "STANDARD",
      practice_areas: ["COMERCIAL"],
      jurisdiction: "Colombia",
      parties: [],
    } as never,
    reference,
  );
}

describe("DOCUMENT_ISOLATION — un identificador de proveedor no es autorización", () => {
  it("[CROSS_MATTER_DOCUMENT_ATTACK] adjuntar un archivo de otro expediente por su id de Drive = DENIED", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId } = await seedFirm(t, {
      orgName: "Pisoso",
      directorEmail: "dir@pisoso.test",
    });
    const matterA = await newMatter(t, organizationId, directorUserId, "IUS-2026-001");
    const matterB = await newMatter(t, organizationId, directorUserId, "IUS-2026-002");

    // Documento real del expediente A, con su identificador de almacenamiento.
    const secretDriveId = "drive_file_del_expediente_A";
    await t.documents.link({
      organizationId,
      matterId: matterA,
      driveFileId: secretDriveId,
      name: "Contrato confidencial A.pdf",
      mimeType: "application/pdf",
      linkedBy: directorUserId,
    });

    const { app, env } = appFor(t, { userId: directorUserId, organizationId });
    const res = await app.request(
      `/matters/${matterB}/documents`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          drive_file_id: secretDriveId,
          name: "Contrato confidencial A.pdf",
          mime_type: "application/pdf",
        }),
      },
      env,
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/identificador de almacenamiento/i);

    // Y el expediente B sigue sin el documento de A.
    const docsB = await t.documents.listForMatter(organizationId, matterB);
    expect(docsB).toHaveLength(0);
  });

  it("[CROSS_ORG_DOCUMENT_ATTACK] el mismo vector entre firmas tampoco existe", async () => {
    const t = createTestDb();
    const firmA = await seedFirm(t, { orgName: "Firma A", directorEmail: "a@a.test" });
    const firmB = await seedFirm(t, { orgName: "Firma B", directorEmail: "b@b.test" });
    const matterA = await newMatter(t, firmA.organizationId, firmA.directorUserId, "A-001");
    const matterB = await newMatter(t, firmB.organizationId, firmB.directorUserId, "B-001");

    await t.documents.link({
      organizationId: firmA.organizationId,
      matterId: matterA,
      driveFileId: "drive_file_firma_A",
      name: "Secreto de la firma A.pdf",
      mimeType: "application/pdf",
      linkedBy: firmA.directorUserId,
    });

    // El director de B, con su propia sesión, intenta adjuntar el archivo de A.
    // Aunque ambas firmas compartieran físicamente la misma cuenta de almacenamiento,
    // la ruta ya no acepta identificadores de proveedor del cliente.
    const { app, env } = appFor(t, {
      userId: firmB.directorUserId,
      organizationId: firmB.organizationId,
    });
    const res = await app.request(
      `/matters/${matterB}/documents`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          drive_file_id: "drive_file_firma_A",
          name: "Secreto de la firma A.pdf",
          mime_type: "application/pdf",
        }),
      },
      env,
    );
    expect(res.status).toBe(422);
    expect(await t.documents.listForMatter(firmB.organizationId, matterB)).toHaveLength(0);

    // Y el expediente de la otra firma sigue siendo inaccesible por id directo.
    const cross = appFor(t, {
      userId: firmB.directorUserId,
      organizationId: firmB.organizationId,
    });
    const leak = await cross.app.request(
      `/matters/${matterA}/documents`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          drive_file_id: "x",
          name: "x",
          mime_type: "application/pdf",
        }),
      },
      cross.env,
    );
    expect(leak.status).toBe(404);
  });

  it("[NO_PROVIDER_ID_LEAK] el workspace ya no expone identificadores de proveedor", async () => {
    // El id de Drive no le sirve al cliente —toda lectura se resuelve por document_id
    // tras comprobar el ACL— y exponerlo era la materia prima del ataque anterior.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("apps/web/src/worker/routes/document-workspace.ts", "utf8"),
    );
    const workspaceShape = source.slice(
      source.indexOf("const shape = (d: (typeof docs)[number])"),
      source.indexOf("return c.json({\n    uploaded:"),
    );
    expect(workspaceShape).not.toMatch(/drive_file_id/);
  });
});

describe("ROLE_ESCALATION — la dirección no se autoconcede", () => {
  const PARTNER = { actorRole: "PARTNER", actorUserId: "usr_partner" };

  it("[PARTNER_SELF_PROMOTION] un socio no puede promoverse a dirección", () => {
    expect(() =>
      assertCanAssignFirmRole({
        ...PARTNER,
        targetUserId: "usr_partner",
        targetCurrentRole: "PARTNER",
        nextRole: "FIRM_DIRECTOR",
      }),
    ).toThrow(/su propio rol/i);
  });

  it("[PARTNER_CANNOT_NAME_DIRECTOR] tampoco puede nombrar dirección a un tercero", () => {
    expect(() =>
      assertCanAssignFirmRole({
        ...PARTNER,
        targetUserId: "usr_otro",
        targetCurrentRole: "LAWYER",
        nextRole: "FIRM_DIRECTOR",
      }),
    ).toThrow(/sólo la dirección puede nombrar dirección/i);
  });

  it("[PARTNER_CANNOT_DEMOTE_DIRECTOR] ni degradar o retirar a la dirección", () => {
    expect(() =>
      assertCanAssignFirmRole({
        ...PARTNER,
        targetUserId: "usr_director",
        targetCurrentRole: "FIRM_DIRECTOR",
        nextRole: "LAWYER",
      }),
    ).toThrow(/cambiar o retirar a otra persona de dirección/i);
    expect(() =>
      assertCanAssignFirmRole({
        ...PARTNER,
        targetUserId: "usr_director",
        targetCurrentRole: "FIRM_DIRECTOR",
        nextRole: "READ_ONLY",
      }),
    ).toThrow(/dirección/i);
  });

  it("[PARTNER_KEEPS_LEGITIMATE_ADMIN] el socio sigue administrando lo que le corresponde", () => {
    expect(() =>
      assertCanAssignFirmRole({
        ...PARTNER,
        targetUserId: "usr_abogado",
        targetCurrentRole: "PARALEGAL",
        nextRole: "LAWYER",
      }),
    ).not.toThrow();
  });

  it("[DIRECTOR_ADMINISTERS_DIRECTION] la dirección sí administra la dirección de SU firma", () => {
    expect(() =>
      assertCanAssignFirmRole({
        actorRole: "FIRM_DIRECTOR",
        actorUserId: "usr_dir",
        targetUserId: "usr_socio",
        targetCurrentRole: "PARTNER",
        nextRole: "FIRM_DIRECTOR",
      }),
    ).not.toThrow();
  });

  it("[NO_SELF_ASSIGNMENT] tampoco la dirección se cambia el rol a sí misma", () => {
    expect(() =>
      assertCanAssignFirmRole({
        actorRole: "FIRM_DIRECTOR",
        actorUserId: "usr_dir",
        targetUserId: "usr_dir",
        targetCurrentRole: "FIRM_DIRECTOR",
        nextRole: "LAWYER",
      }),
    ).toThrow(/su propio rol/i);
  });

  it("[NON_ADMIN_DENIED] un abogado ordinario no administra roles", () => {
    expect(() =>
      assertCanAssignFirmRole({
        actorRole: "LAWYER",
        actorUserId: "usr_l",
        targetUserId: "usr_x",
        targetCurrentRole: "PARALEGAL",
        nextRole: "LAWYER",
      }),
    ).toThrow(/dirección o socio/i);
  });
});

describe("MATTER_ACL — la tenencia es previa al acceso", () => {
  it("[NO_CROSS_ORG_ACL_ROW] no se concede acceso a una persona de otra firma", async () => {
    const t = createTestDb();
    const firmA = await seedFirm(t, { orgName: "Firma A", directorEmail: "a@a.test" });
    const firmB = await seedFirm(t, { orgName: "Firma B", directorEmail: "b@b.test" });
    const outsider = addUser(t, firmB.organizationId, "extraño@b.test", "LAWYER");
    const matterA = await newMatter(t, firmA.organizationId, firmA.directorUserId, "A-010");

    const { app, env } = appFor(t, {
      userId: firmA.directorUserId,
      organizationId: firmA.organizationId,
    });
    const res = await app.request(
      `/matters/${matterA}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: outsider, role: "COLLABORATOR" }),
      },
      env,
    );

    expect(res.status).toBe(404);
    expect(await t.matters.roleFor(matterA, outsider)).toBeNull();
  });
});

describe("RETRIEVAL — autorizado + activo + vigente", () => {
  /** Índice falso que devuelve todo lo que se le sembró, como haría un índice rezagado. */
  function fakeIndex(chunks: Array<{ document_id: string; matter_id: string }>, org: string) {
    return {
      search: async () => ({
        chunks: chunks.map((c, i) => ({
          score: 0.9 - i / 100,
          text: `fragmento de ${c.document_id}`,
          item: {
            key: `org/${org}/matter/${c.matter_id}/doc/${c.document_id}.txt`,
            metadata: { organization_id: org, matter_id: c.matter_id, document_id: c.document_id },
          },
        })),
      }),
    };
  }

  it("[RETIRED_NOT_RETRIEVABLE] un documento retirado no se devuelve aunque siga en el índice", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId } = await seedFirm(t, {
      orgName: "Retiro",
      directorEmail: "dir@retiro.test",
    });
    const matterId = await newMatter(t, organizationId, directorUserId, "IUS-2026-050");

    const vigente = await t.documents.link({
      organizationId,
      matterId,
      driveFileId: "drive_vigente",
      name: "Contrato vigente.pdf",
      mimeType: "application/pdf",
      linkedBy: directorUserId,
    });
    const retirado = await t.documents.link({
      organizationId,
      matterId,
      driveFileId: "drive_retirado",
      name: "Borrador superado.pdf",
      mimeType: "application/pdf",
      linkedBy: directorUserId,
    });
    await t.documents.retire({
      organizationId,
      documentId: retirado,
      retiredBy: directorUserId,
      reason: "Sustituido",
    });

    // El índice todavía devuelve ambos: es la situación real durante la ventana de
    // propagación. D1 es la autoridad y la ruta debe filtrar.
    const { app, env } = appFor(
      t,
      { userId: directorUserId, organizationId },
      {
        AI_SEARCH: fakeIndex(
          [
            { document_id: vigente, matter_id: matterId },
            { document_id: retirado, matter_id: matterId },
          ],
          organizationId,
        ),
      },
    );
    const res = await app.request(
      `/matters/${matterId}/retrieval`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "cláusula de terminación unilateral" }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ document_id: string }> };
    expect(body.results.map((r) => r.document_id)).toEqual([vigente]);
  });

  it("[CURRENT_ACTIVE_RETRIEVABLE] la versión vigente de un documento activo sí se recupera", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId } = await seedFirm(t, {
      orgName: "Vigente",
      directorEmail: "dir@vigente.test",
    });
    const matterId = await newMatter(t, organizationId, directorUserId, "IUS-2026-051");
    const documentId = await t.documents.link({
      organizationId,
      matterId,
      driveFileId: "drive_v1",
      name: "Contrato v1.pdf",
      mimeType: "application/pdf",
      linkedBy: directorUserId,
    });
    await t.documents.addVersion({
      organizationId,
      matterId,
      documentId,
      driveFileId: "drive_v2",
      filename: "Contrato v2.pdf",
      mimeType: "application/pdf",
      createdBy: directorUserId,
      changeType: "Revisión jurídica",
      changeSummary: "Cláusula de exclusividad corregida",
    });

    // El espejo RAG es único por documento lógico, así que la recuperación siempre
    // apunta a la versión vigente; la anterior conserva su binario, no su índice.
    const current = await t.documents.findVersion(organizationId, documentId);
    expect(current?.versionNumber).toBe(2);
    expect(current?.driveFileId).toBe("drive_v2");
    const versions = await t.documents.listVersions(organizationId, documentId);
    expect(versions.filter((v) => v.isCurrent)).toHaveLength(1);

    const { app, env } = appFor(
      t,
      { userId: directorUserId, organizationId },
      { AI_SEARCH: fakeIndex([{ document_id: documentId, matter_id: matterId }], organizationId) },
    );
    const res = await app.request(
      `/matters/${matterId}/retrieval`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "exclusividad" }),
      },
      env,
    );
    const body = (await res.json()) as { results: Array<{ document_id: string }> };
    expect(body.results.map((r) => r.document_id)).toEqual([documentId]);
  });

  it("[FOREIGN_MATTER_NOT_RETRIEVABLE] un chunk de otro expediente se descarta aunque el índice lo devuelva", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId } = await seedFirm(t, {
      orgName: "Aislado",
      directorEmail: "dir@aislado.test",
    });
    const matterId = await newMatter(t, organizationId, directorUserId, "IUS-2026-052");
    const otherMatterId = await newMatter(t, organizationId, directorUserId, "IUS-2026-053");
    const foreignDoc = await t.documents.link({
      organizationId,
      matterId: otherMatterId,
      driveFileId: "drive_otro",
      name: "Ajeno.pdf",
      mimeType: "application/pdf",
      linkedBy: directorUserId,
    });

    const { app, env } = appFor(
      t,
      { userId: directorUserId, organizationId },
      {
        AI_SEARCH: fakeIndex(
          [{ document_id: foreignDoc, matter_id: otherMatterId }],
          organizationId,
        ),
      },
    );
    const res = await app.request(
      `/matters/${matterId}/retrieval`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "lo que sea" }),
      },
      env,
    );
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toEqual([]);
  });
});

describe("SYSTEM_SUPERADMIN — kill switch global sin contenido jurídico", () => {
  it("[PLATFORM_SCOPE] la consola de sistema ve las ejecuciones de todas las firmas", async () => {
    const t = createTestDb();
    const firmA = await seedFirm(t, { orgName: "Firma A", directorEmail: "a@a.test" });
    const firmB = await seedFirm(t, { orgName: "Firma B", directorEmail: "b@b.test" });
    const matterA = await newMatter(t, firmA.organizationId, firmA.directorUserId, "A-100");
    const matterB = await newMatter(t, firmB.organizationId, firmB.directorUserId, "B-100");

    for (const [org, matter, user] of [
      [firmA.organizationId, matterA, firmA.directorUserId],
      [firmB.organizationId, matterB, firmB.directorUserId],
    ] as const) {
      await t.executions.create({
        organizationId: org,
        matterId: matter,
        agentId: "pisoso-orquestador-juridico",
        parentExecutionId: null,
        rootExecutionId: null,
        startedBy: user,
      });
    }

    const roots = await t.executions.listRecentRootsGlobal(50);
    const orgs = new Set(roots.map((r) => r.organizationId));
    expect(orgs).toEqual(new Set([firmA.organizationId, firmB.organizationId]));

    // Y lo que la consola expone es estado técnico: ni título ni objetivo del expediente.
    for (const root of roots) {
      expect(Object.keys(root)).not.toContain("title");
      expect(Object.keys(root)).not.toContain("objective");
    }
  });

  it("[NO_CONTENT_BYPASS] la autoridad de sistema sigue sin abrir un expediente ajeno", async () => {
    const t = createTestDb();
    const firmA = await seedFirm(t, { orgName: "Firma A", directorEmail: "a@a.test" });
    const firmB = await seedFirm(t, { orgName: "Firma B", directorEmail: "b@b.test" });
    const matterA = await newMatter(t, firmA.organizationId, firmA.directorUserId, "A-200");

    // El director de B es, además, superadmin de plataforma.
    t.raw
      .prepare("UPDATE user SET system_role = ? WHERE id = ?")
      .run("SYSTEM_SUPERADMIN", firmB.directorUserId);
    expect(await t.authz.isSystemSuperadmin(firmB.directorUserId)).toBe(true);

    await expect(
      t.authz.authorizeMatter(firmA.organizationId, firmB.directorUserId, matterA, "matter:read"),
    ).rejects.toThrow();
  });
});
