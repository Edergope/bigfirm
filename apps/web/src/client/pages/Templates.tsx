import { useQuery } from "@tanstack/react-query";
import { FileSignature } from "lucide-react";
import { Module, ScreenTitle, Skeleton, StatusChip } from "@iusia/ui";
import { api } from "../api.js";

/**
 * Plantillas — biblioteca institucional real.
 *
 * Cada plantilla es un documento oficial de Google Docs con estructura editorial
 * Pisoso Legal; IUSIA la rellena desde el análisis del expediente y produce DOCX y
 * PDF. Desde aquí sólo se consultan; se generan dentro de cada expediente, donde
 * existe el contexto.
 */

const DOC_TYPE_LABEL: Record<string, string> = {
  OPINION: "Opinión legal",
  CONTRATO: "Contrato",
  DEMANDA: "Demanda",
  MEMORANDO: "Memorando",
  ESCRITO: "Escrito",
};

export function Templates() {
  const templates = useQuery({ queryKey: ["templates"], queryFn: api.listTemplates });
  const rows = templates.data?.templates ?? [];

  return (
    <div className="pb-2">
      <ScreenTitle
        eyebrow="Producción documental"
        title="Plantillas"
        description="Documentos oficiales de la firma. IUSIA los redacta desde el expediente y produce DOCX y PDF."
      />

      {templates.isLoading ? (
        <Skeleton className="h-40" />
      ) : rows.length === 0 ? (
        <Module className="max-w-2xl">
          <div className="flex items-start gap-4 py-1">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-iusia-navy/8 text-iusia-navy"
              aria-hidden
            >
              <FileSignature size={18} />
            </span>
            <div>
              <p className="text-[15px] font-medium text-iusia-navy">Aún no hay plantillas</p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-iusia-mist-text">
                La dirección de la firma habilitará las plantillas institucionales.
              </p>
            </div>
          </div>
        </Module>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((t) => (
            <Module key={t.id} className="flex flex-col">
              <div className="flex items-start gap-3">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-iusia-navy/8 text-iusia-navy"
                  aria-hidden
                >
                  <FileSignature size={16} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[14.5px] font-semibold text-iusia-navy">{t.name}</p>
                  <p className="mt-0.5 text-[12.5px] text-iusia-mist-text">
                    {DOC_TYPE_LABEL[t.document_type] ?? t.document_type} · v{t.version}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <StatusChip
                  label={t.scope === "SYSTEM" ? "Institucional" : "De la firma"}
                  tone="neutral"
                />
                <StatusChip label="DOCX + PDF" tone="info" />
              </div>
              <p className="mt-3 text-[12.5px] leading-snug text-iusia-mist-text">
                {t.variables.length} campo{t.variables.length === 1 ? "" : "s"} que IUSIA completa.
                Se genera desde el expediente.
              </p>
            </Module>
          ))}
        </div>
      )}
    </div>
  );
}
