import { describe, expect, it, vi } from "vitest";
import {
  allowedFolderPrefixes,
  documentMirrorKey,
  folderIsInScope,
  matterFolderPrefix,
  type RetrievalScope,
} from "@iusia/domain";
import {
  AiSearchRetrievalProvider,
  buildMetadataFilter,
  type AiSearchBinding,
} from "../integrations/ai-search.js";

/**
 * AISLAMIENTO DE RECUPERACIÓN (RAG) — API vigente de AI Search.
 *
 * Requisito CRÍTICO: un documento de la Organización A NUNCA puede aparecer en una
 * consulta de la Organización B, aunque el índice físico los comparta. El aislamiento
 * es técnico: filtro de metadata PRE-retrieval (organization_id + matter_id) y REVALIDA
 * `chunk.item.metadata` DESPUÉS (defensa en profundidad). Nunca depende de `folder`.
 */

const ORG_A = "org_aaaaaaaaaaaaaaaaaaaa";
const ORG_B = "org_bbbbbbbbbbbbbbbbbbbb";
const MATTER_A = "mtr_aaaaaaaaaaaaaaaaaaaa";
const MATTER_B = "mtr_bbbbbbbbbbbbbbbbbbbb";

/** Construye un chunk con la forma de respuesta ACTUAL de AI Search. */
function chunk(org: string, matter: string, doc: string, text: string) {
  return {
    score: 0.9,
    text,
    item: {
      key: documentMirrorKey(org, matter, doc),
      metadata: { organization_id: org, matter_id: matter, document_id: doc },
    },
  };
}

/**
 * Índice falso que IGNORA los filtros a propósito: devuelve TODO. Así probamos que
 * el aislamiento no depende de que el índice "se porte bien", sino del refiltro por
 * metadata del provider. Registra los filtros recibidos para verificar el pre-filtro.
 */
class LeakyFakeIndex implements AiSearchBinding {
  lastFilters: unknown = undefined;
  constructor(private readonly chunks: ReturnType<typeof chunk>[]) {}
  async search(params: {
    query: string;
    ai_search_options?: { retrieval?: { filters?: unknown; max_num_results?: number } };
  }) {
    this.lastFilters = params.ai_search_options?.retrieval?.filters;
    return { chunks: this.chunks };
  }
}

const CHUNKS = [
  chunk(ORG_A, MATTER_A, "doc_secretoA", "Contrato confidencial de la Firma A"),
  chunk(ORG_B, MATTER_B, "doc_secretoB", "Contrato confidencial de la Firma B"),
];

describe("scope de recuperación (dominio)", () => {
  it("sin matters autorizados no se busca nada", () => {
    const scope: RetrievalScope = { organization_id: ORG_A, authorized_matter_ids: [] };
    expect(allowedFolderPrefixes(scope)).toEqual([]);
  });

  it("una carpeta de otra firma nunca está en alcance", () => {
    const scope: RetrievalScope = { organization_id: ORG_A, authorized_matter_ids: [MATTER_A] };
    expect(folderIsInScope(matterFolderPrefix(ORG_B, MATTER_B) + "doc/", scope)).toBe(false);
    expect(folderIsInScope(matterFolderPrefix(ORG_A, MATTER_A) + "doc/", scope)).toBe(true);
  });
});

describe("buildMetadataFilter (pre-retrieval)", () => {
  it("filtra por organización exacta y matter dentro de los autorizados", () => {
    const filter = buildMetadataFilter({
      organization_id: ORG_A,
      authorized_matter_ids: [MATTER_A],
    });
    expect(filter).toEqual({ organization_id: ORG_A, matter_id: { $in: [MATTER_A] } });
  });
});

describe("request en formato actual de AI Search", () => {
  it("envía query + ai_search_options.retrieval.{filters,max_num_results}", async () => {
    const spy = vi.fn(async () => ({ chunks: [] }));
    const provider = new AiSearchRetrievalProvider({ search: spy } as unknown as AiSearchBinding);
    await provider.search({
      scope: { organization_id: ORG_A, authorized_matter_ids: [MATTER_A] },
      query: "contrato",
      max_results: 5,
    });
    expect(spy).toHaveBeenCalledOnce();
    const arg = (spy.mock.calls[0] as unknown[])[0] as {
      query: string;
      ai_search_options: { retrieval: { filters: unknown; max_num_results: number } };
    };
    expect(arg.query).toBe("contrato");
    expect(arg.ai_search_options.retrieval.max_num_results).toBe(5);
    // El filtro ACL viaja ANTES del retrieval.
    expect(arg.ai_search_options.retrieval.filters).toEqual({
      organization_id: ORG_A,
      matter_id: { $in: [MATTER_A] },
    });
  });
});

describe("refiltro post-retrieval por metadata (aunque el índice fugue)", () => {
  it("la Firma A no recibe el documento de la Firma B", async () => {
    const index = new LeakyFakeIndex(CHUNKS);
    const provider = new AiSearchRetrievalProvider(index);
    const results = await provider.search({
      scope: { organization_id: ORG_A, authorized_matter_ids: [MATTER_A] },
      query: "contrato confidencial",
    });
    // El pre-filtro viajó al índice.
    expect(index.lastFilters).toEqual({ organization_id: ORG_A, matter_id: { $in: [MATTER_A] } });
    expect(results).toHaveLength(1);
    expect(results[0]?.document_id).toBe("doc_secretoA");
    expect(results[0]?.matter_id).toBe(MATTER_A);
    expect(results.some((r) => r.excerpt.includes("Firma B"))).toBe(false);
  });

  it("otra organización (Org B + Matter B) no ve el fixture de A", async () => {
    const provider = new AiSearchRetrievalProvider(new LeakyFakeIndex(CHUNKS));
    const results = await provider.search({
      scope: { organization_id: ORG_B, authorized_matter_ids: [MATTER_B] },
      query: "contrato",
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.document_id).toBe("doc_secretoB");
  });

  it("wrong matter en la misma org: 0 resultados del otro matter", async () => {
    // Índice que fuga un chunk de MATTER_A cuando el scope autoriza sólo MATTER_B (misma org).
    const leak = new LeakyFakeIndex([chunk(ORG_A, MATTER_A, "doc_secretoA", "confidencial A")]);
    const provider = new AiSearchRetrievalProvider(leak);
    const results = await provider.search({
      scope: { organization_id: ORG_A, authorized_matter_ids: [MATTER_B] },
      query: "confidencial",
    });
    expect(results).toEqual([]); // matter_id fuera de los autorizados -> descartado
  });

  it("un scope sin matters devuelve vacío sin tocar el índice", async () => {
    const spy = vi.fn(async () => ({ chunks: CHUNKS }));
    const provider = new AiSearchRetrievalProvider({ search: spy } as unknown as AiSearchBinding);
    const results = await provider.search({
      scope: { organization_id: ORG_A, authorized_matter_ids: [] },
      query: "lo que sea",
    });
    expect(results).toEqual([]);
    expect(spy).not.toHaveBeenCalled(); // no se consulta el índice
  });
});

describe("binding ausente", () => {
  it("sin binding -> NOT_CONFIGURED y búsqueda vacía", async () => {
    const provider = new AiSearchRetrievalProvider(null);
    expect(provider.status()).toBe("NOT_CONFIGURED");
    expect(
      await provider.search({
        scope: { organization_id: ORG_A, authorized_matter_ids: [MATTER_A] },
        query: "x",
      }),
    ).toEqual([]);
  });
});
