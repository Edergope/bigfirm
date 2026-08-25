import { FileSignature } from "lucide-react";
import { Module, ScreenTitle } from "@iusia/ui";

/**
 * Plantillas — estado futuro, dicho con honestidad.
 *
 * La pantalla anunciaba "Motores no configurados" y "Google Docs API y
 * Docxtemplater requieren configuración externa": eso le explica al abogado un
 * problema de infraestructura que no puede resolver, y no le dice lo único
 * relevante —que esto llegará y qué hará por él—. Tampoco se promete nada que no
 * esté decidido: la biblioteca no existe todavía.
 */
export function Templates() {
  return (
    <div className="pb-2">
      <ScreenTitle
        eyebrow="Producción documental"
        title="Plantillas"
        description="Escritos, contratos y minutas institucionales de la firma."
      />

      <Module className="max-w-2xl">
        <div className="flex items-start gap-4 py-1">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-iusia-navy/8 text-iusia-navy"
            aria-hidden
          >
            <FileSignature size={18} />
          </span>
          <div>
            <p className="text-[15px] font-medium text-iusia-navy">
              Se habilitan en el siguiente bloque
            </p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-iusia-mist-text">
              Las plantillas institucionales permitirán generar escritos a partir del
              expediente, con los hechos y las fuentes que IUSIA ya tiene establecidos.
              Todavía no hay ninguna disponible.
            </p>
          </div>
        </div>
      </Module>
    </div>
  );
}
