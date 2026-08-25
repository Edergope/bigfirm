import { useQuery } from "@tanstack/react-query";
import { api } from "../api.js";

/**
 * Análisis de IUSIA en curso en la firma, visibles para este usuario.
 *
 * Vive fuera de cualquier vista: cerrar la pantalla de un análisis no debe hacer
 * perder de vista que sigue trabajando. Se consulta de forma pausada porque es un
 * indicador de fondo, no la vista principal del análisis.
 */
export function useActiveAnalyses() {
  const query = useQuery({
    queryKey: ["active-analyses"],
    queryFn: api.activeAnalyses,
    refetchInterval: 8000,
    // Un fallo del indicador nunca debe romper la navegación.
    retry: 1,
  });
  return {
    analyses: query.data?.active ?? [],
    count: query.data?.active.length ?? 0,
    isLoading: query.isLoading,
  };
}
