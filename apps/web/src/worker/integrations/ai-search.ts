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
          // Cuando se pide un documento concreto, se acota también a él: pedir el
          // expediente entero y filtrar después no encuentra nada en un expediente
          // grande.
          filters: query.document_id
            ? buildDocumentFilter({
                organizationId: query.scope.organization_id,
                matterId: query.scope.authorized_matter_ids[0] ?? "",
                documentId: query.document_id,
              })
            : buildMetadataFilter(query.scope),
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
      // Defensa en profundidad: aunque el índice haya filtrado, se revalida contra la
      // metadata del chunk. Nunca se confía sólo en el índice.
      if (query.document_id && documentId !== query.document_id) continue;

      const key = str(chunk.item?.key);
      results.push({
        document_id: documentId || documentIdOf(key),
        matter_id: matterId,
        score: chunk.score ?? 0,
        // Extracto acotado del chunk recuperado (no es tuning de AI Search, sólo el
        // tamaño del fragmento que se expone). Suficiente para soportar el hecho jurídico.
        excerpt: (chunk.text ?? "").slice(0, 2000),
        source_folder: folderOf(key),
      });
    }
    return results;
  }
}

/**
 * Filtro de metadata: organización exacta + matter dentro de los autorizados.
 *
 * Éstas son las DOS claves que constituyen la frontera de seguridad, y no se tocan:
 * el índice nunca ve otra firma ni un matter no autorizado, y los chunks se
 * revalidan además contra su propia metadata al volver.
 *
 * NO se filtra aquí por `is_active`. Se hizo, y dejó la recuperación en cero:
 * la última recuperación con chunks fue el 2026-08-26T23:11Z y la cláusula entró en
 * el filtro 78 minutos después (fb68d13); desde entonces las 7 recuperaciones
 * registradas devolvieron 0 chunks, con el mismo `$in` sobre `matter_id` que venía
 * funcionando durante semanas. La cláusula era además insalvable por diseño: es una
 * igualdad sobre un campo OPCIONAL que ningún documento indexado antes de ese commit
 * puede satisfacer, de modo que excluía en silencio todo el corpus previo.
 *
 * El retiro NO queda sin control: se aplica después, contra D1, que es la autoridad.
 * `listForMatter` filtra `retired_at IS NULL` y `collectMatterEvidence` intersecta los
 * chunks recuperados con ese conjunto, en todas las rutas RAG. Ese control es más
 * fuerte que el del índice, no más débil: es inmediato, mientras que la metadata del
 * índice sólo cambia cuando el reenvío del item aterriza.
 */
export function buildMetadataFilter(scope: RetrievalScope): MetadataFilter {
  return {
    organization_id: scope.organization_id,
    matter_id: { $in: [...scope.authorized_matter_ids] },
  };
}

/**
 * Filtro para comprobar que UN documento concreto se recupera.
 *
 * La comprobación anterior lanzaba una consulta genérica al expediente, pedía los cinco
 * mejores resultados y esperaba que el documento apareciera entre ellos. En un
 * expediente de cincuenta documentos eso no encuentra el suyo casi nunca: la
 * confirmación habría dependido de la suerte, y un documento perfectamente indexado se
 * habría quedado sin confirmar.
 *
 * El documento se pide POR SU IDENTIDAD, antes de buscar. Las dos claves de aislamiento
 * siguen presentes: esto restringe, nunca amplía.
 */
export function buildDocumentFilter(args: {
  organizationId: string;
  matterId: string;
  documentId: string;
}): MetadataFilter {
  return {
    organization_id: args.organizationId,
    matter_id: { $in: [args.matterId] },
    document_id: args.documentId,
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
