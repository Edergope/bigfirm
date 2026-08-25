import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { motion, useReducedMotion } from "motion/react";
import clsx from "clsx";

/**
 * Motion de IUSIA.
 *
 * Diagnóstico que originó este módulo: existían tokens, keyframes y clases, pero
 * NO estaban conectados a ningún componente. `.iusia-bar` se aplicaba a cero
 * elementos, las celdas de indicador sólo transicionaban color, y ningún elemento
 * nuevo usaba la librería. El movimiento no era demasiado sutil: prácticamente no
 * existía fuera del Drawer y los avisos.
 *
 * Criterio: el movimiento comunica que la interfaz responde a una intención. Se
 * percibe sin pensarlo y no compite con el dato. Springs amortiguados sin rebote,
 * porque esto es un producto jurídico.
 */

/**
 * ¿Puede animarse ahora mismo?
 *
 * Falso con `prefers-reduced-motion` y también con la pestaña oculta, porque el
 * navegador congela `requestAnimationFrame` ahí: una animación que arranca en
 * `opacity: 0` no avanzaría nunca y el elemento quedaría invisible. Se detectó con
 * la red de especialistas de la portada: abierta en una pestaña de fondo, el hero
 * aparecía sin nodos ni conexiones.
 *
 * La regla que impone: el estado FINAL es el estado por defecto; la animación sólo
 * lo modula. Nada de lo que se ve puede depender de que un frame llegue a tiempo.
 */
export function useCanAnimate(): boolean {
  const reduce = useReducedMotion();
  const visible = useSyncExternalStore(
    (cb) => {
      document.addEventListener("visibilitychange", cb);
      return () => document.removeEventListener("visibilitychange", cb);
    },
    () => !document.hidden,
    () => true,
  );
  return reduce !== true && visible;
}

/** Muelle institucional: llega, se asienta y no rebota. */
export const SPRING = { type: "spring" as const, stiffness: 420, damping: 38, mass: 0.9 };
export const EASE_STANDARD = [0.22, 0.61, 0.36, 1] as const;

/**
 * Barra de dato que crece desde su origen real.
 *
 * `scaleX` en lugar de `width`: animar width obliga a recalcular el layout en cada
 * frame, y con varias barras a la vez eso es exactamente el tirón que hace sentir
 * pesada una tabla. Ocurre UNA vez, al entrar, y se reproduce sólo cuando el valor
 * cambia de verdad.
 */
export function DataBar({
  value,
  className,
  trackClassName,
  delay = 0,
  label,
}: {
  /** 0–100. */
  value: number;
  className?: string;
  trackClassName?: string;
  delay?: number;
  label?: string;
}) {
  const canAnimate = useCanAnimate();
  const reduce = !canAnimate;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <span
      className={clsx("block h-1.5 overflow-hidden rounded-full bg-iusia-ice", trackClassName)}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      <motion.span
        className={clsx("block h-full origin-left rounded-full", className)}
        style={{ width: `${pct}%` }}
        initial={reduce ? false : { scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.62, ease: EASE_STANDARD, delay: reduce ? 0 : delay }}
      />
    </span>
  );
}

/**
 * Cifra que se aproxima a su valor.
 *
 * Sólo para métricas ejecutivas —las que alguien mira para decidir—, nunca para
 * metadata de tabla: un número que tarda medio segundo en estabilizarse retrasa la
 * lectura si aparece cien veces. Al actualizarse interpola desde el valor anterior,
 * no desde cero, porque volver a cero contaría una caída que no ocurrió.
 */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const reduce = !useCanAnimate();
  const [shown, setShown] = useState(reduce ? value : 0);
  const from = useRef(reduce ? value : 0);

  useEffect(() => {
    if (reduce) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = from.current;
    const delta = value - start;
    if (delta === 0) return;
    const duration = 620;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      // Desaceleración: llega rápido y se asienta, sin sobrepasar el valor.
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(start + delta * eased));
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduce]);

  return (
    <span className={className} aria-label={String(value)}>
      {shown.toLocaleString("es-CO")}
    </span>
  );
}

/** Entrada de un elemento que aparece: sube y se revela. Una sola vez. */
export function Rise({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = !useCanAnimate();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE_STANDARD, delay: reduce ? 0 : delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Indicador de selección que se DESPLAZA entre elementos en vez de apagarse y
 * encenderse en otro sitio. Es el gesto que hace sentir que el foco se mueve dentro
 * de una misma aplicación, y el más barato de todos los que dan sensación de
 * producto acabado. `layoutId` debe ser único por grupo de navegación.
 */
export function SelectionPill({ layoutId, className }: { layoutId: string; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      layoutId={layoutId}
      aria-hidden
      className={clsx("absolute inset-0 -z-10 rounded-[var(--radius-md)]", className)}
      transition={reduce ? { duration: 0 } : SPRING}
    />
  );
}
