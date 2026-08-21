import {
  allowedFolderPrefixes,
  folderIsInScope,
  type IntegrationState,
  type RetrievalProvider,
  type RetrievalQuery,
  type RetrievalResult,
} from "@iusia/domain";

/**
 * Adapter de recuperación sobre Cloudflare AI Search.
 *
 * Estado: ADAPTER listo; la instancia de AI Search es un POC pendiente (Blueprint §07,
 * "validar ACL/aislamiento antes de producción"). Sin binding configurado,
 * `status()` es NOT_CONFIGURED.
 *
 * AISLAMIENTO TÉCNICO (no textual): toda consulta se ancla a los prefijos de carpeta
 * autorizados (`org/{org}/matter/{matter}/`). Si el alcance no tiene matters, no se
 * consulta nada. Además, los resultados se filtran de nuevo por prefijo como defensa
 * en profundidad, por si el índice devolviera algo fuera de alcance.
 */

/** Binding de AI Search. Su forma exacta la fija Cloudflare; se tipa laxo a propósito. */
export interface AiSearchBinding {
  search(input: {
    query: string;
    filters?: unknown;
    max_num_results?: number;
  }): Promise<{ data?: Array<{ filename?: string; score?: number; content?: string }> }>;
}

export class AiSearchRetrievalProvider implements RetrievalProvider {
  readonly id = "cloudflare-ai-search";
  constructor(private readonly binding: AiSearchBinding | null) {}

  status(): IntegrationState {
    return this.binding ? "CONNECTED" : "NOT_CONFIGURED";
  }

  async search(query: RetrievalQuery): Promise<RetrievalResult[]> {
    const prefixes = allowedFolderPrefixes(query.scope);
    // Sin matters autorizados no hay nada que buscar: se corta antes de tocar el índice.
    if (prefixes.length === 0) return [];
    if (!this.binding) return [];

    // Filtro OR sobre las carpetas autorizadas. El índice nunca ve otras firmas.
    const filters =
      prefixes.length === 1
        ? { folder: prefixes[0] }
        : { $or: prefixes.map((p) => ({ folder: p })) };

    const raw = await this.binding.search({
      query: query.query,
      filters,
      max_num_results: query.max_results ?? 8,
    });

    const results: RetrievalResult[] = [];
    for (const item of raw.data ?? []) {
      const folder = folderOf(item.filename ?? "");
      // Defensa en profundidad: descarta cualquier resultado fuera de alcance.
      if (!folderIsInScope(folder, query.scope)) continue;
      results.push({
        document_id: documentIdOf(item.filename ?? ""),
        matter_id: matterIdOf(folder),
        score: item.score ?? 0,
        excerpt: (item.content ?? "").slice(0, 600),
        source_folder: folder,
      });
    }
    return results;
  }
}

function folderOf(filename: string): string {
  const idx = filename.lastIndexOf("/");
  return idx >= 0 ? filename.slice(0, idx + 1) : "";
}

function documentIdOf(filename: string): string {
  const base = filename.slice(filename.lastIndexOf("/") + 1);
  return base.replace(/\.txt$/, "");
}

function matterIdOf(folder: string): string {
  // org/{org}/matter/{matter}/doc/  →  {matter}
  const m = folder.match(/matter\/([^/]+)\//);
  return m?.[1] ?? "";
}
