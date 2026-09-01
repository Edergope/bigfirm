import { describe, expect, it } from "vitest";
import {
  renderWorkPackage,
  type IntegrationState,
  type RetrievalProvider,
  type RetrievalQuery,
  type RetrievalResult,
  type WorkPackage,
} from "@iusia/domain";
import { collectMatterEvidence } from "../workflows/rag-evidence.js";

/**
 * Fix del Bloque 7: los agentes del DAG deben recibir evidencia RAG real y scopeada.
 * Estos tests fijan el contrato del recolector de evidencia sin instanciar el
 * Workflow durable: usan un RetrievalProvider falso (puerto de dominio) que registra
 * el alcance recibido, para probar aislamiento, mapeo y provenance.
 */

const ORG = "org_authorized";
const MATTER = "mtr_authorized";
const OBJECTIVE = "Determina qué sostiene Atlas sobre el plazo de notificación previa.";

class FakeRetrievalProvider implements RetrievalProvider {
  readonly id = "fake";
  lastQuery: RetrievalQuery | null = null;
  constructor(
    private readonly results: RetrievalResult[],
    private readonly state: IntegrationState = "CONNECTED",
  ) {}
  status(): IntegrationState {
    return this.state;
  }
  async search(query: RetrievalQuery): Promise<RetrievalResult[]> {
    this.lastQuery = query;
    return this.results;
  }
}

const chunk = (over: Partial<RetrievalResult> = {}): RetrievalResult => ({
  document_id: "doc_atlas",
  matter_id: MATTER,
  score: 0.521,
  excerpt: "Atlas sostiene que la terminación debía notificarse con NOVENTA DÍAS de anticipación.",
  source_folder: `org/${ORG}/matter/${MATTER}/doc/`,
  ...over,
});

describe("collectMatterEvidence (grounding RAG del DAG)", () => {
  it("[B/F] deriva el scope del servidor (organización + este matter), no de otra fuente", async () => {
    const provider = new FakeRetrievalProvider([chunk()]);
    await collectMatterEvidence({
      retrieval: provider,
      organizationId: ORG,
      matterId: MATTER,
      objective: OBJECTIVE,
      documentNames: new Map(),
    });
    expect(provider.lastQuery?.scope.organization_id).toBe(ORG);
    expect(provider.lastQuery?.scope.authorized_matter_ids).toEqual([MATTER]);
    // La query es el objetivo real de la ejecución, no un texto hardcodeado.
    expect(provider.lastQuery?.query).toBe(OBJECTIVE);
  });

  it("[C/E] convierte un chunk autorizado en document_excerpt conservando el document_id", async () => {
    const provider = new FakeRetrievalProvider([chunk()]);
    const excerpts = await collectMatterEvidence({
      retrieval: provider,
      organizationId: ORG,
      matterId: MATTER,
      objective: OBJECTIVE,
      documentNames: new Map([["doc_atlas", "Atlas Cartagena - carta terminacion"]]),
    });
    expect(excerpts).toHaveLength(1);
    expect(excerpts[0]!.content).toContain("NOVENTA DÍAS");
    // Provenance: el document_id queda embebido en el ref_id.
    expect(excerpts[0]!.ref_id).toContain("doc_atlas");
    expect(excerpts[0]!.document_name).toBe("Atlas Cartagena - carta terminacion");
    expect(excerpts[0]!.page_hint).toContain("0.521");
  });

  it("[G] con 0 resultados no inventa evidencia", async () => {
    const provider = new FakeRetrievalProvider([]);
    const excerpts = await collectMatterEvidence({
      retrieval: provider,
      organizationId: ORG,
      matterId: MATTER,
      objective: OBJECTIVE,
      documentNames: new Map(),
    });
    expect(excerpts).toEqual([]);
  });

  it("con el proveedor NOT_CONFIGURED devuelve [] y no consulta el índice", async () => {
    const provider = new FakeRetrievalProvider([chunk()], "NOT_CONFIGURED");
    const excerpts = await collectMatterEvidence({
      retrieval: provider,
      organizationId: ORG,
      matterId: MATTER,
      objective: OBJECTIVE,
      documentNames: new Map(),
    });
    expect(excerpts).toEqual([]);
    expect(provider.lastQuery).toBeNull();
  });

  it("[A/D] el WorkPackage renderizado ya NO va vacío: transporta el contenido y el document_id", async () => {
    const provider = new FakeRetrievalProvider([chunk()]);
    const excerpts = await collectMatterEvidence({
      retrieval: provider,
      organizationId: ORG,
      matterId: MATTER,
      objective: OBJECTIVE,
      documentNames: new Map([["doc_atlas", "Atlas Cartagena"]]),
    });
    const wp: WorkPackage = {
      work_package_id: "wpk_test",
      matter_id: MATTER,
      execution_id: "exe_test",
      parent_execution_id: null,
      agent_id: "03-investigador-normativo-jurisprudencial",
      objective: OBJECTIVE,
      questions: [],
      facts: [],
      authorities: [],
      fact_refs: [],
      source_refs: [],
      document_excerpts: excerpts,
      upstream_outputs: [],
      constraints: [],
      expected_output_schema: "iusia.research.v1",
      allowed_tools: [],
      jurisdiction: "Colombia",
      language: "es-CO",
      created_at: new Date().toISOString(),
    };
    const rendered = renderWorkPackage(wp);
    expect(rendered).toContain("<external_document");
    expect(rendered).toContain("NOVENTA DÍAS");
    expect(rendered).toContain("doc_atlas");
  });
});

/**
 * El control de retiro NO vive en el filtro del índice, vive en D1.
 *
 * Al quitar `is_active` del pre-filtro (que dejaba la recuperación en cero) hay que
 * demostrar que el retiro sigue siendo efectivo. Lo es, y de forma más fuerte: el
 * índice sólo cambia cuando aterriza el reenvío del item, mientras que `documentNames`
 * sale de `listForMatter`, que filtra `retired_at IS NULL` en el momento de consultar.
 */
describe("retiro de documentos aplicado contra D1, no contra el índice", () => {
  it("descarta un chunk de un documento retirado aunque el índice lo devuelva", async () => {
    const provider = new FakeRetrievalProvider([
      chunk({ document_id: "doc_vigente" }),
      chunk({ document_id: "doc_retirado" }),
    ]);
    const excerpts = await collectMatterEvidence({
      retrieval: provider,
      organizationId: ORG,
      matterId: MATTER,
      objective: OBJECTIVE,
      // `listForMatter` ya excluyó el retirado: no aparece en el mapa.
      documentNames: new Map([["doc_vigente", "Contrato vigente.pdf"]]),
    });
    expect(excerpts).toHaveLength(1);
    expect(excerpts[0]?.ref_id.startsWith("doc_vigente")).toBe(true);
  });

  it("entrega el chunk de un documento activo indexado sin el campo is_active", async () => {
    const provider = new FakeRetrievalProvider([chunk({ document_id: "doc_antiguo" })]);
    const excerpts = await collectMatterEvidence({
      retrieval: provider,
      organizationId: ORG,
      matterId: MATTER,
      objective: OBJECTIVE,
      documentNames: new Map([["doc_antiguo", "Demanda 2025.pdf"]]),
    });
    expect(excerpts).toHaveLength(1);
    expect(excerpts[0]?.document_name).toBe("Demanda 2025.pdf");
  });
});
