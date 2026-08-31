import { describe, expect, it } from "vitest";
import { setMirrorIndexActive } from "../services/ingestion.js";
import { addUser, createTestDb, seedFirm, type TestDb } from "./harness.js";

/**
 * CONTROL DE EJECUCIONES Y PROPAGACIÓN AL ÍNDICE.
 *
 * Dos invariantes que la auditoría encontró incompletas:
 *  - cancelar debe cerrar TODO el grafo, no sólo la raíz (un especialista quedaba
 *    RUNNING para siempre, y un resultado tardío encontraba un nodo abierto);
 *  - retirar o versionar un documento debe llegar hasta el índice, no sólo a D1.
 */

async function seedExecutionTree(t: TestDb) {
  const { organizationId, directorUserId } = await seedFirm(t, {
    orgName: "Control",
    directorEmail: "dir@control.test",
  });
  const matterId = await t.matters.create(
    organizationId,
    directorUserId,
    {
      title: "Expediente en curso",
      client_name: "Cliente",
      materiality: "HIGH_STAKES",
      practice_areas: ["COMERCIAL"],
      jurisdiction: "Colombia",
      parties: [],
    } as never,
    "IUS-2026-700",
  );
  const rootId = await t.executions.create({
    organizationId,
    matterId,
    agentId: "pisoso-orquestador-juridico",
    parentExecutionId: null,
    rootExecutionId: null,
    startedBy: directorUserId,
  });
  await t.executions.transition(rootId, "RUNNING");

  const children: string[] = [];
  for (const agentId of [
    "01-intake-y-clasificador",
    "03-investigador-normativo-jurisprudencial",
    "04-analista-probatorio-y-pericial",
  ]) {
    const id = await t.executions.create({
      organizationId,
      matterId,
      agentId,
      parentExecutionId: rootId,
      rootExecutionId: rootId,
      startedBy: directorUserId,
      dispatchKey: `${rootId}:task:${agentId}`,
    });
    await t.executions.transition(id, "RUNNING");
    children.push(id);
  }
  // Uno ya terminó antes de la cancelación: su historia no debe reescribirse.
  await t.executions.transition(children[0]!, "COMPLETED");

  return { organizationId, directorUserId, matterId, rootId, children };
}

describe("CANCELLATION — control de ejecución sin acceso al contenido", () => {
  it("[FIRM_DIRECTOR] la dirección detiene una ejecución de su firma sin recibir ACL del expediente", async () => {
    const t = createTestDb();
    const { organizationId, matterId, rootId } = await seedExecutionTree(t);
    // Un director SIN membresía en el matter (el matter lo creó otra persona).
    const otherDirector = addUser(t, organizationId, "dir2@control.test", "FIRM_DIRECTOR");

    const root = (await t.executions.findById(rootId))!;
    const control = await t.authz.authorizeExecutionCancel(otherDirector, root);
    expect(control).toEqual({
      actorControlRole: "FIRM_DIRECTOR",
      reason: "CANCELLED_BY_FIRM_DIRECTOR",
    });

    // CONTENT_BYPASS: controlar no es leer. Sigue sin poder escribir en el expediente.
    await expect(
      t.authz.authorizeMatter(organizationId, otherDirector, matterId, "document:link"),
    ).rejects.toThrow();
    expect(await t.matters.roleFor(matterId, otherDirector)).toBeNull();
  });

  it("[MATTER_MEMBER] un miembro con execution:cancel detiene lo suyo; uno sin ACL no", async () => {
    const t = createTestDb();
    const { organizationId, matterId, rootId, directorUserId } = await seedExecutionTree(t);
    const colaborador = addUser(t, organizationId, "colab@control.test", "LAWYER");
    const ajeno = addUser(t, organizationId, "ajeno@control.test", "LAWYER");
    await t.matters.addMember(
      organizationId,
      matterId,
      colaborador,
      "COLLABORATOR",
      directorUserId,
    );

    const root = (await t.executions.findById(rootId))!;
    expect(await t.authz.authorizeExecutionCancel(colaborador, root)).toEqual({
      actorControlRole: "MATTER_MEMBER",
      reason: "CANCELLED_BY_MATTER_MEMBER",
    });
    await expect(t.authz.authorizeExecutionCancel(ajeno, root)).rejects.toThrow();
  });

  it("[CANCEL_CLOSES_GRAPH] cancelar cierra las hijas vivas y respeta las ya terminadas", async () => {
    const t = createTestDb();
    const { rootId, children } = await seedExecutionTree(t);

    await t.executions.transition(rootId, "CANCELLED", {
      errorCode: "CANCELLED_BY_FIRM_DIRECTOR",
    });
    const closed = await t.executions.cancelDescendants(rootId, "CANCELLED_BY_FIRM_DIRECTOR");

    expect(closed).toBe(2); // las dos que seguían RUNNING
    const rows = await t.executions.listByRoot(rootId);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(children[0]!)!.status).toBe("COMPLETED"); // historia intacta
    expect(byId.get(children[1]!)!.status).toBe("CANCELLED");
    expect(byId.get(children[2]!)!.status).toBe("CANCELLED");
    expect(rows.every((r) => r.status !== "RUNNING")).toBe(true);
  });

  it("[NO_LATE_RESURRECTION] un resultado tardío no puede reabrir una raíz cancelada", async () => {
    const t = createTestDb();
    const { rootId } = await seedExecutionTree(t);
    await t.executions.transition(rootId, "CANCELLED");

    // La máquina de estados del dominio es la barrera: CANCELLED es terminal.
    await expect(t.executions.transition(rootId, "COMPLETED")).rejects.toThrow(
      /Transición de ejecución inválida/i,
    );
    expect((await t.executions.findById(rootId))!.status).toBe("CANCELLED");
  });

  it("[IDEMPOTENT] cancelar dos veces no cambia nada ni lanza", async () => {
    const t = createTestDb();
    const { rootId } = await seedExecutionTree(t);
    await t.executions.transition(rootId, "CANCELLED");
    const first = (await t.executions.findById(rootId))!.completedAt;

    expect(await t.executions.cancelDescendants(rootId, "CANCELLED_BY_SYSTEM_ADMIN")).toBe(2);

    // Segunda cancelación: el repositorio corta antes de escribir y ya no queda nada
    // vivo que cerrar. Repetir la operación no altera el ledger.
    await t.executions.transition(rootId, "CANCELLED");
    expect((await t.executions.findById(rootId))!.completedAt).toBe(first);
    expect(await t.executions.cancelDescendants(rootId, "CANCELLED_BY_SYSTEM_ADMIN")).toBe(0);
  });

  it("[COMPLETED_AT] una transición no terminal ya no borra la fecha de cierre", async () => {
    const t = createTestDb();
    const { organizationId, matterId, directorUserId } = await seedExecutionTree(t);
    const id = await t.executions.create({
      organizationId,
      matterId,
      agentId: "06-estratega-juridico-convencional",
      parentExecutionId: null,
      rootExecutionId: null,
      startedBy: directorUserId,
    });
    await t.executions.transition(id, "RUNNING");
    await t.executions.transition(id, "WAITING");
    expect((await t.executions.findById(id))!.completedAt).toBeNull();
    await t.executions.transition(id, "RUNNING");
    await t.executions.transition(id, "COMPLETED");
    expect((await t.executions.findById(id))!.completedAt).not.toBeNull();
  });
});

describe("RETRIEVAL INDEX — el retiro y la versión llegan al índice", () => {
  /** R2 en memoria con el contrato mínimo que usa `setMirrorIndexActive`. */
  function fakeR2() {
    const store = new Map<string, { text: string; customMetadata: Record<string, string> }>();
    return {
      store,
      binding: {
        get: async (key: string) => {
          const entry = store.get(key);
          if (!entry) return null;
          return {
            text: async () => entry.text,
            customMetadata: entry.customMetadata,
          };
        },
        put: async (
          key: string,
          text: string,
          options?: { customMetadata?: Record<string, string> },
        ) => {
          store.set(key, { text, customMetadata: options?.customMetadata ?? {} });
        },
      },
    };
  }

  it("[DEACTIVATE_MIRROR] el espejo pasa a is_active=false sin perder el contenido", async () => {
    const r2 = fakeR2();
    const key = "org/org_1/matter/mtr_1/doc/doc_1.txt";
    r2.store.set(key, {
      text: "CLÁUSULA DÉCIMA. Terminación con preaviso de noventa (90) días.",
      customMetadata: {
        organization_id: "org_1",
        matter_id: "mtr_1",
        document_id: "doc_1",
        document_version: "1",
        is_current: "true",
        is_active: "true",
      },
    });

    const env = { ARTIFACTS: r2.binding, AI_SEARCH: null } as never;
    await setMirrorIndexActive(env, key, false);

    const after = r2.store.get(key)!;
    expect(after.customMetadata.is_active).toBe("false");
    // El retiro es lógico: el contenido y el resto de la metadata se conservan.
    expect(after.text).toContain("noventa (90) días");
    expect(after.customMetadata.document_id).toBe("doc_1");

    // Y es reversible.
    await setMirrorIndexActive(env, key, true);
    expect(r2.store.get(key)!.customMetadata.is_active).toBe("true");
  });

  it("[NO_MIRROR] sin espejo indexado no hay nada que desactivar y no se rompe nada", async () => {
    const r2 = fakeR2();
    const env = { ARTIFACTS: r2.binding, AI_SEARCH: null } as never;
    expect(await setMirrorIndexActive(env, null, false)).toBe(false);
    expect(await setMirrorIndexActive(env, "clave/inexistente.txt", false)).toBe(false);
  });
});

describe("PROVENANCE — el entregable declara su origen en su propia fila", () => {
  it("[DOCUMENT_PROVENANCE] plantilla, versión, ejecución, agente y prompt quedan en el documento", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId } = await seedFirm(t, {
      orgName: "Provenance",
      directorEmail: "dir@provenance.test",
    });
    const matterId = await t.matters.create(
      organizationId,
      directorUserId,
      {
        title: "Expediente con entregable",
        client_name: "Cliente",
        materiality: "STANDARD",
        practice_areas: ["COMERCIAL"],
        jurisdiction: "Colombia",
        parties: [],
      } as never,
      "IUS-2026-800",
    );

    const documentId = await t.documents.link({
      organizationId,
      matterId,
      driveFileId: "drive_entregable_docx",
      name: "IUS-2026-800 - Concepto jurídico - 2026-08-31 - v1.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      classification: "ENTREGABLE",
      linkedBy: directorUserId,
      provenance: {
        contentSource: "AGENT",
        templateId: "tpl_concepto_v2",
        templateVersion: 2,
        executionId: "exe_integracion",
        agentId: "08-redactor-senior-juridico",
        promptSha256: "964233092e74",
        model: "gpt-5",
      },
    });

    const stored = (await t.documents.findById(organizationId, documentId))!;
    // Reconstrucción completa SIN recorrer audit_events.
    expect(stored.contentSource).toBe("AGENT");
    expect(stored.generatedFromTemplateId).toBe("tpl_concepto_v2");
    expect(stored.generatedFromTemplateVersion).toBe(2);
    expect(stored.generatedByExecutionId).toBe("exe_integracion");
    expect(stored.generatedByAgentId).toBe("08-redactor-senior-juridico");
    expect(stored.generatedPromptSha256).toBe("964233092e74");
    expect(stored.generatedModel).toBe("gpt-5");
  });

  it("[NO_FALSE_PROVENANCE] un documento aportado por el despacho no finge origen de IA", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId } = await seedFirm(t, {
      orgName: "Aportado",
      directorEmail: "dir@aportado.test",
    });
    const matterId = await t.matters.create(
      organizationId,
      directorUserId,
      {
        title: "Expediente con documento aportado",
        client_name: "Cliente",
        materiality: "STANDARD",
        practice_areas: ["COMERCIAL"],
        jurisdiction: "Colombia",
        parties: [],
      } as never,
      "IUS-2026-801",
    );
    const documentId = await t.documents.link({
      organizationId,
      matterId,
      driveFileId: "drive_aportado",
      name: "Contrato del cliente.pdf",
      mimeType: "application/pdf",
      linkedBy: directorUserId,
    });

    const stored = (await t.documents.findById(organizationId, documentId))!;
    expect(stored.contentSource).toBeNull();
    expect(stored.generatedByAgentId).toBeNull();
    expect(stored.generatedFromTemplateId).toBeNull();
  });
});
