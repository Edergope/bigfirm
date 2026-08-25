import { useId } from "react";
import { motion } from "motion/react";
import { useCanAnimate } from "./motion.js";

/**
 * Red de especialistas — el retrato de IUSIA convocando a su equipo.
 *
 * No es la constelación de análisis (`AnalysisConstellation`), que dibuja datos
 * reales de una ejecución en curso. Ésta es la representación del PRODUCTO: qué es
 * IUSIA antes de que exista ningún análisis. Por eso los nodos son áreas de
 * especialidad y no agentes concretos, y por eso vive en la portada.
 *
 * Dos estados:
 *  · `idle`      — la red respira: existe, está disponible, no está trabajando.
 *  · `convoking` — los enlaces se trazan hacia el núcleo y los nodos se encienden
 *                  en secuencia. Ocurre UNA vez, al convocar.
 *
 * Cada nodo lleva su nombre y su materia, no sólo un punto de color: una red donde
 * el significado dependa del color es ilegible para quien no distingue tonos.
 *
 * Sobria a propósito: sin partículas decorativas, sin destellos, sin bucles
 * infinitos que compitan con el contenido. Lo que se mueve, significa.
 */

export interface SpecialistNode {
  /** Nombre de la especialidad, en lenguaje de despacho. */
  label: string;
  /** Materia concreta, para que el nombre no tenga que adivinarse. */
  detail: string;
}

export function SpecialistNetwork({
  nodes,
  state = "idle",
  coreLabel = "IUSIA",
  className,
}: {
  nodes: SpecialistNode[];
  state?: "idle" | "convoking";
  coreLabel?: string;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  // Sin frames disponibles, la red se dibuja YA en su estado final: lo que se ve
  // no puede depender de que la animación llegue a ejecutarse.
  const still = !useCanAnimate();

  // El lienzo reserva margen para los rótulos: con el ancho justo, "Contractualista"
  // y "Corporativo · Riesgos y cumplimiento" se cortaban contra el borde del hero.
  const W = 720;
  const H = 330;
  const cx = W / 2;
  const cy = H / 2;
  const rx = 218;
  const ry = 112;

  // Reparto elíptico determinista: la misma red se dibuja siempre igual.
  const placed = nodes.map((n, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(nodes.length, 1);
    return {
      ...n,
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
      right: Math.cos(angle) > 0.25,
      left: Math.cos(angle) < -0.25,
      // Arriba y abajo el rótulo no cabe al lado: se coloca fuera del nodo, en
      // la dirección en la que el nodo se aleja del núcleo.
      vertical: Math.abs(Math.cos(angle)) <= 0.25,
      above: Math.sin(angle) < 0,
    };
  });

  const active = state === "convoking";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-label={`IUSIA coordina especialistas en ${nodes.map((n) => n.label).join(", ")}`}
    >
      <defs>
        <radialGradient id={`${uid}-core`} cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#4FD8F5" stopOpacity="0.55" />
          <stop offset="55%" stopColor="#22C7E8" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#0B1D3A" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}-link`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#22C7E8" stopOpacity="0.05" />
          <stop offset="50%" stopColor="#22C7E8" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#22C7E8" stopOpacity="0.05" />
        </linearGradient>
      </defs>

      {/* Halo del núcleo: la masa de la que parte todo. */}
      <motion.ellipse
        cx={cx}
        cy={cy}
        rx={116}
        ry={96}
        fill={`url(#${uid}-core)`}
        initial={still ? false : { opacity: 0.5, scale: 0.96 }}
        animate={
          still
            ? { opacity: 0.75 }
            : active
              ? { opacity: [0.6, 0.95, 0.78], scale: [0.98, 1.05, 1] }
              : { opacity: [0.55, 0.72, 0.55], scale: [0.98, 1.01, 0.98] }
        }
        transition={
          still
            ? { duration: 0 }
            : active
              ? { duration: 1.6, ease: [0.22, 0.61, 0.36, 1] }
              : { duration: 5.5, repeat: Infinity, ease: "easeInOut" }
        }
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      />

      {/* Malla interna: la insinuación de una estructura pensante, no un cerebro
          anatómico. Trazos finos, sin dibujar circunvoluciones. */}
      <g stroke="#4FD8F5" strokeOpacity={0.3} strokeWidth={0.8} fill="none">
        {MESH.map(([x1, y1, x2, y2], i) => (
          <motion.line
            key={i}
            x1={cx + x1}
            y1={cy + y1}
            x2={cx + x2}
            y2={cy + y2}
            initial={still ? false : { pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={
              still ? { duration: 0 } : { duration: 0.9, delay: 0.05 * i, ease: "easeOut" }
            }
          />
        ))}
      </g>
      <g fill="#4FD8F5" fillOpacity={0.75}>
        {MESH_DOTS.map(([x, y], i) => (
          <motion.circle
            key={i}
            cx={cx + x}
            cy={cy + y}
            r={1.6}
            initial={still ? false : { opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={still ? { duration: 0 } : { duration: 0.4, delay: 0.35 + 0.04 * i }}
          />
        ))}
      </g>

      {/* Enlaces núcleo → especialista. Al convocar, se trazan. */}
      {placed.map((p, i) => (
        <motion.line
          key={`link-${p.label}`}
          x1={cx}
          y1={cy}
          x2={p.x}
          y2={p.y}
          stroke={`url(#${uid}-link)`}
          strokeWidth={active ? 1.5 : 1}
          initial={still ? false : { pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: active ? 1 : 0.7 }}
          transition={
            still
              ? { duration: 0 }
              : { duration: 0.7, delay: (active ? 0.1 : 0.5) + i * 0.09, ease: "easeOut" }
          }
        />
      ))}

      {/* Núcleo. */}
      <circle cx={cx} cy={cy} r={44} fill="#0B1D3A" fillOpacity={0.55} />
      <circle cx={cx} cy={cy} r={44} fill="none" stroke="#22C7E8" strokeOpacity={0.45} strokeWidth={1.2} />
      <text
        x={cx}
        y={cy + 5}
        textAnchor="middle"
        style={{ fontSize: 15, fontWeight: 600, letterSpacing: "0.14em", fill: "#FFFFFF" }}
      >
        {coreLabel}
      </text>

      {/* Especialistas: nodo, nombre y materia. El significado nunca va sólo en el
          color —la red se lee igual en escala de grises—. */}
      {placed.map((p, i) => (
        <motion.g
          key={p.label}
          initial={still ? false : { opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={
            still
              ? { duration: 0 }
              : { duration: 0.45, delay: (active ? 0.2 : 0.65) + i * 0.09, ease: "easeOut" }
          }
          style={{ transformOrigin: `${p.x}px ${p.y}px` }}
        >
          {active && !still ? (
            <motion.circle
              cx={p.x}
              cy={p.y}
              r={13}
              fill="#22C7E8"
              initial={{ opacity: 0.45, scale: 0.7 }}
              animate={{ opacity: 0, scale: 2.1 }}
              transition={{ duration: 1.1, delay: 0.35 + i * 0.09, ease: "easeOut" }}
              style={{ transformOrigin: `${p.x}px ${p.y}px` }}
            />
          ) : null}
          <circle cx={p.x} cy={p.y} r={13} fill="#0B1D3A" fillOpacity={0.85} />
          <circle
            cx={p.x}
            cy={p.y}
            r={13}
            fill="none"
            stroke="#4FD8F5"
            strokeOpacity={active ? 0.9 : 0.55}
            strokeWidth={1.2}
          />
          <circle cx={p.x} cy={p.y} r={4} fill="#4FD8F5" fillOpacity={0.85} />
          <text
            x={p.vertical ? p.x : p.right ? p.x + 21 : p.x - 21}
            y={p.vertical ? (p.above ? p.y - 30 : p.y + 30) : p.y - 1}
            textAnchor={p.vertical ? "middle" : p.right ? "start" : "end"}
            style={{ fontSize: 11.5, fontWeight: 500, fill: "#FFFFFF" }}
          >
            {p.label}
          </text>
          <text
            x={p.vertical ? p.x : p.right ? p.x + 21 : p.x - 21}
            y={p.vertical ? (p.above ? p.y - 17 : p.y + 43) : p.y + 12}
            textAnchor={p.vertical ? "middle" : p.right ? "start" : "end"}
            style={{ fontSize: 10, fill: "#FFFFFF", fillOpacity: 0.5 }}
          >
            {p.detail}
          </text>
        </motion.g>
      ))}
    </svg>
  );
}

/** Malla del núcleo. Coordenadas relativas al centro; fijas, no aleatorias. */
const MESH: Array<[number, number, number, number]> = [
  [-46, -28, -12, -46], [-12, -46, 26, -34], [26, -34, 48, -6],
  [48, -6, 30, 30], [30, 30, -6, 44], [-6, 44, -38, 24],
  [-38, 24, -46, -28], [-12, -46, 6, -8], [6, -8, 30, 30],
  [6, -8, -38, 24], [6, -8, 48, -6], [-46, -28, 6, -8],
];

const MESH_DOTS: Array<[number, number]> = [
  [-46, -28], [-12, -46], [26, -34], [48, -6], [30, 30], [-6, 44], [-38, 24], [6, -8],
];
