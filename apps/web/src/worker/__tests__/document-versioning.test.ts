import { describe, expect, it } from "vitest";
import { TemplateRepository } from "@iusia/db";
import { createTestDb, seedFirm } from "./harness.js";

const matterInput = {
  title: "Versiones Atlas",
  client_name: "Atlas",
  materiality: "MATERIAL" as const,
  practice_areas: ["COMERCIAL_CONTRACTUAL" as const],
  jurisdiction: "Colombia",
};

describe("versionamiento documental", () => {
  it("preserva v1, crea v2 server-side y resuelve únicamente v2 como vigente", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId } = await seedFirm(t, {
      orgName: "Firma Versiones",
      directorEmail: "versiones@iusia.test",
    });
    const matterId = await t.matters.create(
      organizationId,
      directorUserId,
      matterInput,
      "VER-001",
    );
    const documentId = await t.documents.link({
      organizationId,
      matterId,
      driveFileId: "drive-v1",
      name: "Contrato.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      linkedBy: directorUserId,
      checksum: "sha-v1",
      ingestionStatus: "AI_INDEXED",
    });

    const created = await t.documents.addVersion({
      organizationId,
      matterId,
      documentId,
      driveFileId: "drive-v2",
      filename: "Contrato revisado.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      checksum: "sha-v2",
      createdBy: directorUserId,
      changeType: "Revisión jurídica",
      changeSummary: "Ajuste de cláusula penal",
      ingestionStatus: "PROCESSING",
    });

    expect(created?.versionNumber).toBe(2);
    const versions = await t.documents.listVersions(organizationId, documentId);
    expect(versions.map((version) => [version.versionNumber, version.isCurrent])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(versions[1]?.driveFileId).toBe("drive-v1");
    expect((await t.documents.findVersion(organizationId, documentId))?.driveFileId).toBe("drive-v2");
    expect((await t.documents.findVersion(organizationId, documentId, 1))?.driveFileId).toBe("drive-v1");

    await t.documents.markIndexed(
      organizationId,
      documentId,
      `${organizationId}/${matterId}/${documentId}.md`,
      "sha-markdown-v2",
    );
    expect((await t.documents.findVersion(organizationId, documentId))?.checksum).toBe("sha-v2");
    expect((await t.documents.findVersion(organizationId, documentId))?.ingestionStatus).toBe("AI_INDEXED");
    expect((await t.documents.findById(organizationId, documentId))?.contentHash).toBe("sha-markdown-v2");
  });

  it("no expone documento ni versión con un organization_id distinto", async () => {
    const t = createTestDb();
    const a = await seedFirm(t, { orgName: "Firma A", directorEmail: "a-version@iusia.test" });
    const b = await seedFirm(t, { orgName: "Firma B", directorEmail: "b-version@iusia.test" });
    const matterId = await t.matters.create(a.organizationId, a.directorUserId, matterInput, "VER-A");
    const documentId = await t.documents.link({
      organizationId: a.organizationId,
      matterId,
      driveFileId: "drive-secret-a",
      name: "Secreto.pdf",
      mimeType: "application/pdf",
      linkedBy: a.directorUserId,
    });
    expect(await t.documents.findById(b.organizationId, documentId)).toBeNull();
    expect(await t.documents.findVersion(b.organizationId, documentId)).toBeNull();
  });

  it("marca documento y versión vigente como ERROR cuando falla la ingesta", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId } = await seedFirm(t, {
      orgName: "Firma Error Ingesta",
      directorEmail: "ingestion-error@iusia.test",
    });
    const matterId = await t.matters.create(
      organizationId,
      directorUserId,
      matterInput,
      "VER-ERR",
    );
    const documentId = await t.documents.link({
      organizationId,
      matterId,
      driveFileId: "drive-error",
      name: "Fuente con error.txt",
      mimeType: "text/plain",
      linkedBy: directorUserId,
      ingestionStatus: "PROCESSING",
    });

    await t.documents.markIngestionFailed(organizationId, documentId);

    expect((await t.documents.findById(organizationId, documentId))?.ingestionStatus).toBe("ERROR");
    expect((await t.documents.findVersion(organizationId, documentId))?.ingestionStatus).toBe("ERROR");
  });

  it("retira de la lista vigente sin borrar versiones ni permitir una nueva versión", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId } = await seedFirm(t, {
      orgName: "Firma Retiro", directorEmail: "retiro@iusia.test",
    });
    const matterId = await t.matters.create(organizationId, directorUserId, matterInput, "RET-001");
    const documentId = await t.documents.link({
      organizationId, matterId, driveFileId: "drive-retired", name: "Archivo.pdf",
      mimeType: "application/pdf", linkedBy: directorUserId,
    });
    expect(await t.documents.retire({ organizationId, documentId, retiredBy: directorUserId, reason: "Duplicado" })).not.toBeNull();
    expect(await t.documents.listForMatter(organizationId, matterId)).toHaveLength(0);
    expect(await t.documents.listVersions(organizationId, documentId)).toHaveLength(1);
    await expect(t.documents.addVersion({
      organizationId, matterId, documentId, driveFileId: "drive-new", filename: "Nueva.pdf",
      mimeType: "application/pdf", createdBy: directorUserId, changeType: "Otro", changeSummary: "No debe crear",
    })).resolves.toBeNull();
  });
});

describe("Template Bank versionado", () => {
  it("crea una nueva fila por versión y conserva la anterior inactiva", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId } = await seedFirm(t, {
      orgName: "Firma Plantillas",
      directorEmail: "templates@iusia.test",
    });
    const repo = new TemplateRepository(t.db);
    const first = await repo.createSystemVersion({
      name: "Concepto jurídico formal",
      documentType: "OPINION",
      category: "Conceptos",
      sourceRef: "google-doc-v1",
      originalSourceRef: "docx-v1",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      checksum: "sha-v1",
      originalFilename: "concepto-v1.docx",
      variables: [],
      createdBy: directorUserId,
    });
    const second = await repo.createSystemVersion({
      familyId: first.familyId,
      name: "Concepto jurídico formal",
      documentType: "OPINION",
      category: "Conceptos",
      sourceRef: "google-doc-v2",
      originalSourceRef: "docx-v2",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      checksum: "sha-v2",
      originalFilename: "concepto-v2.docx",
      variables: [],
      createdBy: directorUserId,
    });
    const history = await repo.listSystemHistory();
    expect(second.version).toBe(2);
    expect(history).toHaveLength(2);
    expect(history.find((row) => row.id === first.id)?.status).toBe("INACTIVE");
    expect(history.find((row) => row.id === second.id)?.status).toBe("ACTIVE");
    const selected = await repo.findByDocumentType(organizationId, "OPINION");
    expect(selected.ambiguous).toBe(false);
    expect(selected.template?.id).toBe(second.id);
  });

  it("no adivina la plantilla cuando dos familias comparten tipo documental", async () => {
    const t = createTestDb();
    const { organizationId, directorUserId } = await seedFirm(t, {
      orgName: "Ambigua",
      directorEmail: "dir@ambigua.test",
    });
    const repo = new TemplateRepository(t.db);
    const base = {
      documentType: "CONTRACT",
      category: "Contratos",
      sourceRef: "gdoc",
      originalSourceRef: "docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      originalFilename: "c.docx",
      variables: [{ key: "asunto", label: "Asunto", required: true }],
      createdBy: directorUserId,
    };
    await repo.createSystemVersion({ ...base, name: "Contrato marco", checksum: "aaa" });
    await repo.createSystemVersion({ ...base, name: "Contrato de suministro", checksum: "bbb" });

    // Dos familias editoriales ACTIVE del mismo tipo: elegir por número de versión
    // publicaría el documento equivocado. Se declara la ambigüedad.
    const ambiguous = await repo.findByDocumentType(organizationId, "CONTRACT");
    expect(ambiguous.ambiguous).toBe(true);
    expect(ambiguous.template).toBeNull();

    // Con la familia fijada por el caller la selección vuelve a ser determinista.
    const families = await repo.listSystemHistory();
    const target = families.find((row) => row.name === "Contrato de suministro")!;
    const resolved = await repo.findByDocumentType(organizationId, "CONTRACT", target.familyId);
    expect(resolved.ambiguous).toBe(false);
    expect(resolved.template?.id).toBe(target.id);
  });
});
