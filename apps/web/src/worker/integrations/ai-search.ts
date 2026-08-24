import {
  allowedFolderPrefixes,
  type IntegrationState,
  type RetrievalProvider,
  type RetrievalQuery,
  type RetrievalResult,
  type RetrievalScope,
} from "@iusia/domain";

/**
 * Adapter de recuperación sobre Cloudflare AI Search (binding `ai_search`).
 *
 * Estado: ADAPTER migrado a la API vigente de AI Search. La instancia real
 * (`iusia-rag-e2e`) es un POC pendiente de aprovisionar; sin binding,
 * `status()` es NOT_CONFIGURED y `search()` no toca ningún índice.
 *
 * AISLAMIENTO (no negociable, no textual): el alcance lo construye SIEMPRE el
 * servidor a partir de la autorización real (organization + matters autorizados).
 * El filtro se aplica ANTES del retrieval como metadata filter sobre
 * `organization_id` + `matter_id`, y los resultados se REVALIDAN después contra
 * `chunk.item.metadata` (defensa en profundidad). Nunca se usa `folder` como única
 * frontera de seguridad.
 */

/** Filtro de metadata compatible con Vectorize/AI Search (subconjunto usado). */
export type MetadataFilter = Record<string, string | { $in: string[] }>;

/**
 * Forma mínima del binding `ai_search` (estructuralmente compatible con el tipo
 * global `AiSearchInstance` de @cloudflare/workers-types).
 */
export interface AiSearchBinding {
  search(params: {
    query: string;
    ai_search_options?: {
      retrieval?: {
        filters?: MetadataFilter;
        max_num_results?: number;
      };
    };
  }): Promise<{
    chunks?: Array<{
      score?: number;
      text?: string;
      item?: { key?: string; metadata?: Record<string, unknown> };
    }>;
  }>;
}

export class AiSearchRetrievalProvider implements RetrievalProvider {
  readonly id = "cloudflare-ai-search";
  constructor(private readonly binding: AiSearchBinding | null) {}

  status(): IntegrationState {
    return this.binding ? "CONNECTED" : "NOT_CONFIGURED";
  }

  async search(query: RetrievalQuery): Promise<RetrievalResult[]> {
    // Sin matters autorizados no hay nada que buscar: se corta antes de tocar el índice.
    if (allowedFolderPrefixes(query.scope).length === 0) return [];
    if (!this.binding) return [];

    const raw = await this.binding.search({
      query: query.query,
      ai_search_options: {
        retrieval: {
          // Filtro PRE-retrieval por tenant/matter: el índice nunca ve otras firmas.
          filters: buildMetadataFilter(query.scope),
          max_num_results: query.max_results ?? 8,
        },
      },
    });

    const results: RetrievalResult[] = [];
    for (const chunk of raw.chunks ?? []) {
      const metadata = chunk.item?.metadata ?? {};
      const organizationId = str(metadata.organization_id);
      const matterId = str(metadata.matter_id);
      const documentId = str(metadata.document_id);

      // Defensa en profundidad: revalida org + matter contra la metadata del chunk.
      // Descarta cualquier resultado fuera de alcance aunque el índice lo devolviera.
      if (organizationId !== query.scope.organization_id) continue;
      if (!query.scope.authorized_matter_ids.includes(matterId)) continue;

      const key = str(chunk.item?.key);
      results.push({
        document_id: documentId || documentIdOf(key),
        matter_id: matterId,
        score: chunk.score ?? 0,
        excerpt: (chunk.text ?? "").slice(0, 600),
        source_folder: folderOf(key),
      });
    }
    return results;
  }
}

/** Filtro de metadata: organización exacta + matter dentro de los autorizados. */
export function buildMetadataFilter(scope: RetrievalScope): MetadataFilter {
  return {
    organization_id: scope.organization_id,
    matter_id: { $in: [...scope.authorized_matter_ids] },
  };
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function folderOf(filename: string): string {
  const idx = filename.lastIndexOf("/");
  return idx >= 0 ? filename.slice(0, idx + 1) : "";
}

function documentIdOf(filename: string): string {
  const base = filename.slice(filename.lastIndexOf("/") + 1);
  return base.replace(/\.(txt|json)$/, "");
}
