import { describe, expect, it } from "vitest";
import {
  allowedFolderPrefixes,
  documentMirrorKey,
  folderIsInScope,
  matterFolderPrefix,
  type RetrievalScope,
} from "@iusia/domain";
import { AiSearchRetrievalProvider, type AiSearchBinding } from "../integrations/ai-search.js";

/**
 * AISLAMIENTO DE RECUPERACIÓN (RAG).
 *
 * Requisito CRÍTICO del prompt maestro: un documento de la Organización A NUNCA
 * puede aparecer en una consulta de la Organización B, aunque el índice físico los
 * comparta. El filtro es técnico (prefijo de carpeta), no una instrucción al modelo.
 */

const ORG_A = "org_aaaaaaaaaaaaaaaaaaaa";
const ORG_B = "org_bbbbbbbbbbbbbbbbbbbb";
const MATTER_A = "mtr_aaaaaaaaaaaaaaaaaaaa";
const MATTER_B = "mtr_bbbbbbbbbbbbbbbbbbbb";

/**
 * Índice falso que IGNORA los filtros a propósito: devuelve todo lo que tiene.
 * Así probamos que el aislamiento no depende de que el índice "se porte bien",
 * sino de la defensa en profundidad del provider (folderIsInScope).
 */
class LeakyFakeIndex implements AiSearchBinding {
  constructor(private readonly docs: Array<{ filename: string; content: string }>) {}
  async search() {
    return { data: this.docs.map((d) => ({ ...d, score: 0.9 })) };
  }
}

const DOCS = [
  {
    filename: `${documentMirrorKey(ORG_A, MATTER_A, "doc_secretoA")}`,
    content: "Contrato confidencial de la Firma A",
  },
  {
    filename: `${documentMirrorKey(ORG_B, MATTER_B, "doc_secretoB")}`,
    content: "Contrato confidencial de la Firma B",
  },
];

describe("scope de recuperación", () => {
  it("sin matters autorizados no se busca nada", () => {
    const scope: RetrievalScope = { organization_id: ORG_A, authorized_matter_ids: [] };
    expect(allowedFolderPrefixes(scope)).toEqual([]);
  });

  it("los prefijos permitidos se anclan a la organización y matter", () => {
    const scope: RetrievalScope = { organization_id: ORG_A, authorized_matter_ids: [MATTER_A] };
    expect(allowedFolderPrefixes(scope)).toEqual([matterFolderPrefix(ORG_A, MATTER_A)]);
  });

  it("una carpeta de otra firma nunca está en alcance", () => {
    const scope: RetrievalScope = { organization_id: ORG_A, authorized_matter_ids: [MATTER_A] };
    expect(folderIsInScope(matterFolderPrefix(ORG_B, MATTER_B) + "doc/", scope)).toBe(false);
    expect(folderIsInScope(matterFolderPrefix(ORG_A, MATTER_A) + "doc/", scope)).toBe(true);
  });
});

describe("el provider filtra aunque el índice fugue", () => {
  it("la Firma A no recibe el documento de la Firma B", async () => {
    const provider = new AiSearchRetrievalProvider(new LeakyFakeIndex(DOCS));
    const results = await provider.search({
      scope: { organization_id: ORG_A, authorized_matter_ids: [MATTER_A] },
      query: "contrato confidencial",
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.document_id).toBe("doc_secretoA");
    expect(results.every((r) => r.matter_id === MATTER_A)).toBe(true);
    // El documento de B nunca aparece.
    expect(results.some((r) => r.excerpt.includes("Firma B"))).toBe(false);
  });

  it("la Firma B sólo ve lo suyo", async () => {
    const provider = new AiSearchRetrievalProvider(new LeakyFakeIndex(DOCS));
    const results = await provider.search({
      scope: { organization_id: ORG_B, authorized_matter_ids: [MATTER_B] },
      query: "contrato",
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.document_id).toBe("doc_secretoB");
  });

  it("un scope sin matters devuelve vacío sin tocar el índice", async () => {
    const provider = new AiSearchRetrievalProvider(new LeakyFakeIndex(DOCS));
    const results = await provider.search({
      scope: { organization_id: ORG_A, authorized_matter_ids: [] },
      query: "lo que sea",
    });
    expect(results).toEqual([]);
  });
});
