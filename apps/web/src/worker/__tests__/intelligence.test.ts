import { beforeEach, describe, expect, it } from "vitest";
import { IntelligenceService } from "../services/intelligence.js";
import { buildCaseBrief } from "../services/case-brief.js";
import { addUser, createTestDb, seedFirm, type TestDb } from "./harness.js";
import type { RequestContext } from "../context.js";

/**
 * IUSIA Intelligence y Case Brief sobre datos reales, respetando alcance.
 */
describe("IUSIA Intelligence read-only", () => {
  let t: TestDb;
  let org: string, director: string, lawyer: string, matterOfLawyer: string;

  function ctx(): RequestContext {
    return t as unknown as RequestContext;
  }

  beforeEach(async () => {
    t = createTestDb();
    const seed = await seedFirm(t, { orgName: "Firma I", directorEmail: "i@i.test" });
    org = seed.organizationId;
    director = seed.directorUserId;
    lawyer = addUser(t, org, "l@i.test", "LAWYER");
    matterOfLawyer = await t.matters.create(
      org,
      lawyer,
      { title: "Caso del abogado", client_name: "C", materiality: "MATERIAL", practice_areas: ["CIVIL"], jurisdiction: "Colombia" },
      "IUS-I-001",
    );
    // Un matter del director, ajeno al abogado.
    await t.matters.create(
      org,
      director,
      { title: "Caso de dirección", client_name: "D", materiality: "SIMPLE", practice_areas: ["LABORAL"], jurisdiction: "Colombia" },
      "IUS-I-002",
    );
  });

  it("case-health del abogado sólo cuenta sus matters", async () => {
    const svc = new IntelligenceService(ctx(), org);
    const health = await svc.caseHealth(lawyer, false);
    expect(health.total).toBe(1);
  });

  it("case-health de dirección abarca toda la firma", async () => {
    const svc = new IntelligenceService(ctx(), org);
    const health = await svc.caseHealth(director, true);
    expect(health.total).toBe(2);
  });

  it("las tareas vencidas respetan el alcance del usuario", async () => {
    await t.tasks.create({
      organizationId: org,
      matterId: matterOfLawyer,
      title: "Vencida",
      dueAt: "2020-01-01T00:00:00.000Z",
      createdBy: lawyer,
    });
    const svc = new IntelligenceService(ctx(), org);
    const overdueLawyer = await svc.overdueTasks(lawyer, false);
    expect(overdueLawyer).toHaveLength(1);
    // Un usuario sin acceso a ese matter no ve la tarea.
    const stranger = addUser(t, org, "s@i.test", "LAWYER");
    expect(await svc.overdueTasks(stranger, false)).toHaveLength(0);
  });

  it("Case Brief se compone de datos estructurados y es regenerable", async () => {
    await t.facts.upsertMany(
      org,
      matterOfLawyer,
      [
        { fact_id: "F1", statement: "hecho verificado", certainty: "[F]", source_class: "Class A", primary_source: "doc", numbers: [] },
        { fact_id: "F2", statement: "hecho dudoso", certainty: "[U]", source_class: "Class C", primary_source: "relato", numbers: [] },
      ],
      null,
    );
    const brief = await buildCaseBrief(ctx(), org, matterOfLawyer);
    expect(brief.matter_id).toBe(matterOfLawyer);
    expect(brief.facts).toHaveLength(2);
    // El hecho no verificado se convierte en pregunta abierta.
    expect(brief.open_questions.some((q) => q.includes("hecho dudoso"))).toBe(true);
    // Regenerable: dos llamadas producen la misma estructura de hechos.
    const brief2 = await buildCaseBrief(ctx(), org, matterOfLawyer);
    expect(brief2.facts.map((f) => f.fact_id).sort()).toEqual(["F1", "F2"]);
  });
});
