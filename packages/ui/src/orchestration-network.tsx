import { useId } from "react";
import { motion } from "motion/react";
import { useCanAnimate } from "./motion.js";

/**
 * Red de orquestación — IUSIA trabajando, con datos reales.
 *
 * Distinta de `SpecialistNetwork`, que retrata el producto antes de que exista
 * ninguna ejecución. Ésta dibuja UNA orquestación concreta: los especialistas que
 * el planificador eligió de verdad y el trabajo circulando entre ellos.
 *
 * REGLA DE VERDAD: cada nodo es un especialista realmente despachado y cada pulso
 * corresponde a un estado registrado en el ledger. Nada decorativo:
 *
 *   · encargo (ida)    — el especialista está trabajando: la luz va del núcleo a él.
 *   · hallazgo (vuelta)— terminó: la luz vuelve del especialista al núcleo.
 *   · integrando       — el orquestador consolida: convergencia dorada.
 *
 * Se ve circular el trabajo, no nodos parpadeando: la dirección del pulso es la
 * información. Sin bucles infinitos que compitan con la lectura del progreso.
 */

export type NetworkNodeState = "waiting" | "active" | "done" | "failed";

export interface NetworkNode {
  id: string;
  label: string;
  state: NetworkNodeState;
}

export interface NetworkLink {
  from: string;
  to: string;
  transferred: boolean;
}

const STATE_STROKE: Record<NetworkNodeState, string> = {
  waiting: "#7C8AA0",
  active: "#4FD8F5",
  done: "#34D399",
  failed: "#F87171",
};

export function OrchestrationNetwork({
  nodes,
  links = [],
  integrating = false,
  coreLabel = "IUSIA",
  className,
}: {
  nodes: NetworkNode[];
  links?: NetworkLink[];
  integrating?: boolean;
  coreLabel?: string;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const canAnimate = useCanAnimate();

  const W = 640;
  const H = 300;
  const cx = W / 2;
  const cy = H / 2 - 4;
  const rx = 218;
  const ry = 96;

  const placed = nodes.map((n, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(nodes.length, 1);
    return {
      ...n,
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
      right: Math.cos(angle) > 0.25,
      left: Math.cos(angle) < -0.25,
      vertical: Math.abs(Math.cos(angle)) <= 0.25,
      above: Math.sin(angle) < 0,
      index: i,
    };
  });

  const byId = new Map(placed.map((p) => [p.id, p]));
  const anyActive = nodes.some((n) => n.state === "active");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-label={
        nodes.length === 0
          ? "IUSIA está entendiendo el encargo"
          : `IUSIA coordina a ${nodes.length} especialistas: ${nodes
              .map((n) => `${n.label}, ${STATE_WORD[n.state]}`)
              .join("; ")}`
      }
    >
      <defs>
        <radialGradient id={`${uid}-core`} cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#4FD8F5" stopOpacity="0.5" />
          <stop offset="60%" stopColor="#22C7E8" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#0B1D3A" stopOpacity="0" />
        </radialGradient>
      </defs>

      <motion.ellipse
        cx={cx}
        cy={cy}
        rx={104}
        ry={88}
        fill={`url(#${uid}-core)`}
        animate={
          !canAnimate
            ? { opacity: 0.7 }
            : integrating
              ? { opacity: [0.6, 0.95, 0.6] }
              : anyActive
                ? { opacity: [0.5, 0.78, 0.5] }
                : { opacity: 0.5 }
        }
        transition={
          !canAnimate
            ? { duration: 0 }
            : { duration: integrating ? 2.2 : 3.4, repeat: Infinity, ease: "easeInOut" }
        }
      />

      {/* Radios núcleo ↔ especialista. */}
      {placed.map((p) => (
        <line
          key={`spoke-${p.id}`}
          x1={cx}
          y1={cy}
          x2={p.x}
          y2={p.y}
          stroke={STATE_STROKE[p.state]}
          strokeOpacity={p.state === "waiting" ? 0.22 : 0.4}
          strokeWidth={1}
        />
      ))}

      {/* Dependencias reales entre especialistas: lo que uno entrega a otro. */}
      {links.map((l, i) => {
        const a = byId.get(l.from);
        const b = byId.get(l.to);
        if (!a || !b) return null;
        return (
          <line
            key={`link-${i}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="#4FD8F5"
            strokeOpacity={l.transferred ? 0.45 : 0.14}
            strokeWidth={1}
            strokeDasharray={l.transferred ? undefined : "3 4"}
          />
        );
      })}

      {/* EL FLUJO. Ida mientras trabaja, vuelta cuando entrega. La dirección del
          pulso es lo que se lee, no el brillo. */}
      {canAnimate
        ? placed
            .filter((p) => p.state === "active" || p.state === "done")
            .map((p) => {
              const outbound = p.state === "active";
              const from = outbound ? { x: cx, y: cy } : { x: p.x, y: p.y };
              const to = outbound ? { x: p.x, y: p.y } : { x: cx, y: cy };
              const color = outbound ? "#4FD8F5" : "#34D399";
              return (
                <motion.circle
                  key={`pulse-${p.id}`}
                  r={3.2}
                  fill={color}
                  initial={{ cx: from.x, cy: from.y, opacity: 0 }}
                  animate={{
                    cx: [from.x, to.x],
                    cy: [from.y, to.y],
                    opacity: [0, 1, 1, 0],
                  }}
                  transition={{
                    duration: outbound ? 1.5 : 1.2,
                    repeat: Infinity,
                    repeatDelay: 0.5,
                    delay: p.index * 0.28,
                    ease: "easeInOut",
                    times: [0, 0.15, 0.85, 1],
                  }}
                  style={{ filter: `drop-shadow(0 0 5px ${color})` }}
                />
              );
            })
        : null}

      {/* Convergencia al integrar: todo vuelve al orquestador. */}
      {canAnimate && integrating
        ? placed.map((p) => (
            <motion.circle
              key={`conv-${p.id}`}
              r={3}
              fill="#C9A24B"
              initial={{ cx: p.x, cy: p.y, opacity: 0 }}
              animate={{ cx: [p.x, cx], cy: [p.y, cy], opacity: [0, 1, 1, 0] }}
              transition={{
                duration: 1.1,
                repeat: Infinity,
                repeatDelay: 0.3,
                delay: p.index * 0.16,
                ease: "easeIn",
                times: [0, 0.2, 0.8, 1],
              }}
              style={{ filter: "drop-shadow(0 0 5px #C9A24B)" }}
            />
          ))
        : null}

      {/* Núcleo: el orquestador. */}
      <circle cx={cx} cy={cy} r={40} fill="#0B1D3A" fillOpacity={0.72} />
      <motion.circle
        cx={cx}
        cy={cy}
        r={40}
        fill="none"
        stroke={integrating ? "#C9A24B" : "#22C7E8"}
        strokeWidth={1.4}
        animate={
          canAnimate && (anyActive || integrating)
            ? { strokeOpacity: [0.4, 0.95, 0.4] }
            : { strokeOpacity: 0.6 }
        }
        transition={
          canAnimate ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" } : { duration: 0 }
        }
      />
      <text
        x={cx}
        y={cy + 5}
        textAnchor="middle"
        style={{ fontSize: 14, fontWeight: 600, letterSpacing: "0.13em", fill: "#FFFFFF" }}
      >
        {coreLabel}
      </text>

      {/* Especialistas. El estado va en el trazo Y en la palabra: nunca sólo color. */}
      {placed.map((p) => (
        <g key={`node-${p.id}`}>
          {p.state === "active" && canAnimate ? (
            <motion.circle
              cx={p.x}
              cy={p.y}
              r={12}
              fill={STATE_STROKE.active}
              initial={{ opacity: 0.3, scale: 1 }}
              animate={{ opacity: [0.3, 0, 0.3], scale: [1, 1.9, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
              style={{ transformOrigin: `${p.x}px ${p.y}px` }}
            />
          ) : null}
          <circle cx={p.x} cy={p.y} r={12} fill="#0B1D3A" fillOpacity={0.9} />
          <circle
            cx={p.x}
            cy={p.y}
            r={12}
            fill="none"
            stroke={STATE_STROKE[p.state]}
            strokeOpacity={p.state === "waiting" ? 0.5 : 0.95}
            strokeWidth={1.4}
          />
          {p.state === "done" ? (
            <path
              d={`M ${p.x - 4} ${p.y} l 2.8 3 l 5.2 -6`}
              fill="none"
              stroke={STATE_STROKE.done}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <circle cx={p.x} cy={p.y} r={3.4} fill={STATE_STROKE[p.state]} fillOpacity={0.9} />
          )}
          <text
            x={p.vertical ? p.x : p.right ? p.x + 19 : p.x - 19}
            y={p.vertical ? (p.above ? p.y - 26 : p.y + 30) : p.y - 1}
            textAnchor={p.vertical ? "middle" : p.right ? "start" : "end"}
            style={{ fontSize: 11, fontWeight: 500, fill: "#FFFFFF" }}
          >
            {truncate(p.label)}
          </text>
          <text
            x={p.vertical ? p.x : p.right ? p.x + 19 : p.x - 19}
            y={p.vertical ? (p.above ? p.y - 14 : p.y + 42) : p.y + 11}
            textAnchor={p.vertical ? "middle" : p.right ? "start" : "end"}
            style={{ fontSize: 9.5, fill: STATE_STROKE[p.state], fillOpacity: 0.85 }}
          >
            {STATE_WORD[p.state]}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** El estado dicho con palabras: el color solo nunca porta el significado. */
const STATE_WORD: Record<NetworkNodeState, string> = {
  waiting: "en espera",
  active: "trabajando",
  done: "entregó",
  failed: "con incidencia",
};

function truncate(s: string, max = 22): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
