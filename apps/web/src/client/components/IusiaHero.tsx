import { motion } from "motion/react";
import { ArrowRight, FileSearch, Network, PenLine, Users } from "lucide-react";
import { SpecialistNetwork, useCanAnimate, type SpecialistNode } from "@iusia/ui";

/**
 * Portada de IUSIA — la convocatoria.
 *
 * El Inicio explicaba el estado de la cartera pero no lo que IUSIA ES. Un director
 * que abre la aplicación por primera vez veía indicadores; no veía que puede
 * convocar un equipo jurídico y ponerlo a trabajar sobre un expediente. Esta pieza
 * dice eso en el primer viewport y ofrece la acción, no la explicación.
 *
 * Patrón Hero-Centric (UI/UX Pro Max): titular y visual a sangre, una tira de
 * propuesta de valor, y una acción primaria dominante. Se descartó el patrón de
 * embudo por pasos: es lenguaje de página de captación, no de aplicación de
 * trabajo.
 */

/** Las materias que IUSIA cubre, en el idioma del despacho. */
export const HERO_SPECIALISTS: SpecialistNode[] = [
  { label: "Procesalista", detail: "Vía procesal y estrategia" },
  { label: "Contractualista", detail: "Contratos y cláusulas" },
  { label: "Tributario", detail: "Impuestos y fiscalidad" },
  { label: "Laboralista", detail: "Relaciones laborales" },
  { label: "Corporativo", detail: "Riesgos y cumplimiento" },
];

const FLOW = [
  { icon: FileSearch, label: "Analiza" },
  { icon: Network, label: "Orquesta" },
  { icon: PenLine, label: "Redacta" },
];

export function IusiaHero({ onConvoke }: { onConvoke: () => void }) {
  const still = !useCanAnimate();

  return (
    <motion.section
      initial={still ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 0.84, 0.44, 1] }}
      className="on-navy relative mb-4 overflow-hidden rounded-[var(--radius-lg)] bg-iusia-navy-deep shadow-[var(--shadow-panel)]"
    >
      {/* Atmósfera: dos focos fríos muy tenues. Da materia al navy sin ruido. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_120%_at_78%_50%,rgba(34,199,232,0.16),transparent_62%),radial-gradient(50%_90%_at_0%_0%,rgba(79,216,245,0.09),transparent_60%)]"
      />

      <div className="relative flex flex-col gap-6 px-6 py-7 lg:flex-row lg:items-center lg:gap-4 lg:px-8">
        <div className="min-w-0 lg:max-w-[440px] lg:flex-1">
          <span className="inline-flex items-center rounded-full bg-white/[0.07] px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-iusia-intel">
            Nuevo en IUSIA
          </span>

          <h2 className="mt-3 text-[30px] font-semibold leading-[1.08] tracking-[-0.03em] text-white lg:text-[34px]">
            Convoca tu equipo jurídico de IA
          </h2>
          <p className="mt-2.5 max-w-md text-[14px] leading-relaxed text-white/60">
            IUSIA analiza el caso, activa especialistas, construye estrategia y sigue
            trabajando aunque cierres la vista.
          </p>

          <div className="mt-5">
            <ConvokeButton onClick={onConvoke} />
          </div>

          {/* Tira de propuesta de valor: qué hace, en orden. */}
          <ul className="mt-5 flex flex-wrap items-center gap-x-1 gap-y-2">
            {FLOW.map(({ icon: Icon, label }, i) => (
              <li key={label} className="flex items-center gap-1">
                <span className="flex items-center gap-1.5 text-[12.5px] text-white/70">
                  <Icon size={14} className="text-iusia-intel" aria-hidden />
                  {label}
                </span>
                {i < FLOW.length - 1 ? (
                  <ArrowRight size={12} className="mx-1.5 text-white/25" aria-hidden />
                ) : null}
              </li>
            ))}
            <li className="ml-2 flex items-center gap-1.5 text-[12.5px] text-white/45">
              <span aria-hidden className="h-1 w-1 rounded-full bg-white/30" />
              Continúa en segundo plano
            </li>
          </ul>
        </div>

        <div className="relative -mx-2 lg:mx-0 lg:w-[520px] lg:shrink-0">
          <SpecialistNetwork nodes={HERO_SPECIALISTS} className="w-full" />
        </div>
      </div>
    </motion.section>
  );
}

/**
 * La acción primaria de la portada. Motion gobierna elevación y presión: con
 * clases de Tailwind el desplazamiento acababa en la propiedad `translate`, fuera
 * de la transición, y el botón saltaba sin animarse.
 */
function ConvokeButton({ onClick }: { onClick: () => void }) {
  const still = !useCanAnimate();
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={false}
      animate={{ y: 0, scale: 1, boxShadow: "0 4px 14px -4px rgba(37,99,235,0.55)" }}
      whileHover={still ? undefined : { y: -2, boxShadow: "0 14px 30px -8px rgba(37,99,235,0.7)" }}
      whileTap={still ? undefined : { y: 0, scale: 0.985 }}
      transition={{ type: "spring", stiffness: 480, damping: 34, mass: 0.7 }}
      className="group inline-flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-md)] bg-iusia-action px-5 py-3 text-[14px] font-semibold text-white transition-colors duration-[var(--motion-fast)] hover:bg-[#1d4fd0]"
    >
      <Users size={16} aria-hidden />
      Convocar equipo jurídico
      <ArrowRight
        size={15}
        aria-hidden
        className="transition-transform duration-[var(--motion-fast)] ease-[var(--ease-standard)] group-hover:translate-x-1 motion-reduce:transition-none"
      />
    </motion.button>
  );
}
