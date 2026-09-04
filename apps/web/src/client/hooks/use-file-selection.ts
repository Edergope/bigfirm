import { useCallback, useMemo, useState } from "react";
import { MAX_FILES_PER_UPLOAD, planFileSelection, summarizeSelection } from "@iusia/domain";

/**
 * Selección de archivos, con las mismas reglas en las cuatro entradas de carga.
 *
 * Había cuatro. «Nuevo expediente» recortaba a diez en silencio; el modal de Convocar
 * recortaba a diez en silencio, dos veces —arrastrar y elegir—; el panel de Documentos
 * no tenía techo pero mandaba una petición por archivo; y el workspace del expediente
 * mandaba todo de golpe sin límite. Cuatro respuestas distintas a la misma pregunta, y
 * la del formulario de alta fue la que se comió siete de los diecisiete documentos de
 * un abogado sin decírselo.
 *
 * El límite y el aviso viven en el dominio —los comparte el servidor, que rechaza con
 * `TOO_MANY_FILES`—; aquí sólo está el estado de React.
 */
export function useFileSelection(limit = MAX_FILES_PER_UPLOAD) {
  const [files, setFiles] = useState<File[]>([]);
  const [limitNotice, setLimitNotice] = useState<string | null>(null);

  /** Añade lo elegido. Si no cabe, se dice cuánto queda fuera; nunca se recorta callado. */
  const add = useCallback(
    (incoming: FileList | File[] | null) => {
      const next = [...files, ...Array.from(incoming ?? [])];
      const plan = planFileSelection(next.map((f) => f.name), limit);
      setFiles(next.slice(0, plan.accepted));
      setLimitNotice(plan.notice);
    },
    [files, limit],
  );

  const remove = useCallback((index: number) => {
    setFiles((current) => current.filter((_, i) => i !== index));
    setLimitNotice(null);
  }, []);

  const clear = useCallback(() => {
    setFiles([]);
    setLimitNotice(null);
  }, []);

  /**
   * Lo que se sabe del formato se sabe AHORA. Dos `.DOC` no pueden descubrirse tres
   * minutos después de subirlos, cuando el procesamiento ya terminó.
   */
  const formatNotices = useMemo(
    () => summarizeSelection(files.map((f) => ({ name: f.name, type: f.type }))).notices,
    [files],
  );

  const totalBytes = useMemo(() => files.reduce((sum, f) => sum + f.size, 0), [files]);

  return { files, add, remove, clear, limitNotice, formatNotices, totalBytes, limit };
}

/** Tamaño legible. Diecisiete archivos son megabytes, y el abogado merece verlos. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
