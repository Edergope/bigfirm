import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ToastStack, type ToastItem } from "@iusia/ui";
import { diffFinishedAnalyses, type ActiveAnalysisRef } from "@iusia/domain";
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

  useEffect(() => {
    const finished = diffFinishedAnalyses(prev.current, analyses);
    prev.current = analyses;
    if (finished.length === 0) return;
    setItems((current) => [
      ...current,
      ...finished.map((f) => ({
        id: f.root_execution_id,
        title: "Análisis completado",
        body: f.matter_title,
        tone: "success" as const,
        action: {
          label: "Ver resultado",
          onClick: () => {
            setItems((c) => c.filter((t) => t.id !== f.root_execution_id));
            navigate(`/casos/${f.matter_id}?analisis=${f.root_execution_id}`);
          },
        },
      })),
    ]);
  }, [analyses, navigate]);

  return <ToastStack items={items} onDismiss={(id) => setItems((c) => c.filter((t) => t.id !== id))} />;
}
