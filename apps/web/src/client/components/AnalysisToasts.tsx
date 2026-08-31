import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ToastStack, type ToastItem } from "@iusia/ui";
import {
  analysisCompletionNotice,
  diffFinishedAnalyses,
  type ActiveAnalysisRef,
} from "@iusia/domain";
import { api } from "../api.js";
import { useActiveAnalyses } from "../hooks/use-active-analyses.js";

/**
 * Avisa cuando un análisis que corría en segundo plano termina, esté el abogado
 * donde esté. Sustituye a cualquier `alert()`: no bloquea, no roba el foco y
 * ofrece la única acción que importa —ir al resultado.
 */
export function AnalysisToasts() {
  const navigate = useNavigate();
  const { analyses } = useActiveAnalyses();
  const [items, setItems] = useState<ToastItem[]>([]);
  const prev = useRef<ActiveAnalysisRef[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((c) => c.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const finished = diffFinishedAnalyses(prev.current, analyses);
    prev.current = analyses;
    if (finished.length === 0) return;

    let cancelled = false;
    void (async () => {
      for (const f of finished) {
        // Salir de los activos no dice CÓMO terminó. Se consulta el estado real antes
        // de anunciarlo: decir «terminó» sobre un análisis que el abogado acaba de
        // detener contradice a la propia ventana que dice «Análisis detenido».
        let status = "";
        try {
          status = (await api.executionResult(f.root_execution_id)).status;
        } catch {
          // Si no se puede resolver, se informa sin afirmar un desenlace.
        }
        if (cancelled) return;
        const notice = analysisCompletionNotice(status);
        setItems((current) =>
          current.some((t) => t.id === f.root_execution_id)
            ? current
            : [
                ...current,
                {
                  id: f.root_execution_id,
                  title: notice.title,
                  body: f.matter_title,
                  tone: notice.tone,
                  action: {
                    label: "Ver en el expediente",
                    onClick: () => {
                      dismiss(f.root_execution_id);
                      navigate(`/casos/${f.matter_id}?analisis=${f.root_execution_id}`);
                    },
                  },
                },
              ],
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [analyses, navigate, dismiss]);

  return <ToastStack items={items} onDismiss={dismiss} />;
}
