import { formatBytes } from "../hooks/use-file-selection";

/**
 * Lo que el abogado acaba de seleccionar, dicho de una vez.
 *
 * Antes se listaba archivo por archivo sin techo. Con tres es útil; con diecisiete
 * convierte el formulario en una lista interminable y el botón de crear el expediente
 * se va debajo del pliegue. Y con cero no aparecía nada: en una prueba el abogado
 * eligió sus archivos, volvió a la pantalla y no vio ninguna confirmación de que la
 * selección hubiera ocurrido.
 *
 * Hasta cinco se nombran. A partir de ahí se cuentan, con los primeros a la vista y el
 * resto detrás de «Ver todos», porque lo que importa entonces es el número y el peso.
 */
export function FileSelectionSummary({
  files,
  totalBytes,
  expanded,
  onToggle,
  onRemove,
}: {
  files: readonly File[];
  totalBytes: number;
  expanded: boolean;
  onToggle: () => void;
  onRemove: (index: number) => void;
}) {
  if (files.length === 0) return null;
  const LISTA_COMPLETA_HASTA = 5;
  const compacta = files.length > LISTA_COMPLETA_HASTA && !expanded;
  const visibles = compacta ? files.slice(0, 3) : files;

  return (
    <div className="mt-3">
      <p
        // `role="status"` y no `alert`: es una confirmación, no un problema.
        role="status"
        className="mb-2 text-[12.5px] font-medium text-iusia-carbon"
      >
        {files.length === 1 ? "1 archivo seleccionado" : `${files.length} archivos seleccionados`}
        <span className="font-normal text-iusia-mist-text"> · {formatBytes(totalBytes)}</span>
      </p>
      <ul className="flex flex-col gap-1">
        {visibles.map((f, i) => (
          <li
            key={`${f.name}-${i}`}
            className="flex items-center justify-between gap-3 rounded-[8px] bg-iusia-paper px-2.5 py-1.5"
          >
            <span className="min-w-0 truncate text-[12.5px] text-iusia-carbon">{f.name}</span>
            <span className="shrink-0 text-[11.5px] tabular-nums text-iusia-mist-text">
              {formatBytes(f.size)}
            </span>
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="shrink-0 text-[11.5px] text-iusia-mist-text underline underline-offset-2 hover:text-iusia-carbon"
            >
              Quitar
            </button>
          </li>
        ))}
      </ul>
      {files.length > LISTA_COMPLETA_HASTA ? (
        <button
          type="button"
          onClick={onToggle}
          className="mt-1.5 text-[12px] text-iusia-mist-text underline underline-offset-2 hover:text-iusia-carbon"
        >
          {compacta ? `Ver los ${files.length}` : "Ver menos"}
        </button>
      ) : null}
    </div>
  );
}
