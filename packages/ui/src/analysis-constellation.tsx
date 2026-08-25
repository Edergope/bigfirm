import { useMemo } from "react";
import { colors } from "./tokens/index.js";

/**
 * Constelación de análisis — la representación visual de IUSIA trabajando.
 *
 * REGLA DE VERDAD (Design System §05): cada nodo es un especialista realmente
 * despachado y cada arista una dependencia real del plan. No hay partículas
 * decorativas ni movimiento inventado: si el motor no lo registró, no se dibuja.
 *
 * Es deliberadamente abstracta —un núcleo y sus especialistas, no un cerebro
 * anatómico— porque representa inteligencia jurídica colectiva ante socios y
 * clientes institucionales. El movimiento sólo señala trabajo en curso y se
 * desactiva por completo con `prefers-reduced-motion`.
 */

export type ConstellationNodeState = "waiting" | "active" | "done" | "failed";

export interface ConstellationNode {
  id: string;
  /** Nombre legible del especialista. Nunca un código de nodo interno. */
  label: string;
  state: ConstellationNodeState;
}

export interface ConstellationLink {
  from: string;
  to: string;
  /** Hubo una transferencia real de hallazgos entre estos dos especialistas. */
  transferred: boolean;
}

const STATE_COLOR: Record<ConstellationNodeState, string> = {
  waiting: colors.mistStrong,
  active: colors.intel,
  done: colors.success,
  failed: colors.critical,
};

export function AnalysisConstellation({
  nodes,
  links = [],
  integrating = false,
  coreLabel = "IUSIA",
  height = 300,
}: {
  nodes: ConstellationNode[];
  links?: ConstellationLink[];
  /** El integrador está consolidando: las aristas convergen hacia el núcleo. */
  integrating?: boolean;
  coreLabel?: string;
  height?: number;
}) {
  const W = 520;
  const H = height;
  const cx = W / 2;
  const cy = H / 2;
  const radius = Math.min(W, H) * 0.34;

  // Posiciones deterministas: el mismo equipo siempre se dibuja igual.
  const placed = useMemo(() => {
    const n = nodes.length;
    return nodes.map((node, i) => {
      // Se empieza arriba y se reparte en el círculo.
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(n, 1);
      return {
        ...node,
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      };
    });
  }, [nodes, cx, cy, radius]);

  const byId = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);
  const anyActive = nodes.some((n) => n.state === "active");

  if (nodes.length === 0) {
    // Todavía no sabemos el equipo: se muestra el núcleo pensando, sin inventar nodos.
    return (
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="IUSIA está analizando el encargo"
      >
        <Core cx={cx} cy={cy} label={coreLabel} pulsing />
      </svg>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={`IUSIA trabajando con ${nodes.length} especialistas`}
    >
      {/* Radios núcleo → especialista: el encargo que el orquestador repartió. */}
      {placed.map((p) => (
        <line
          key={`spoke-${p.id}`}
          x1={cx}
          y1={cy}
          x2={p.x}
          y2={p.y}
          stroke={p.state === "waiting" ? colors.mist : STATE_COLOR[p.state]}
          strokeWidth={p.state === "waiting" ? 1 : 1.5}
          strokeOpacity={p.state === "waiting" ? 0.35 : 0.55}
          strokeDasharray={p.state === "active" ? "4 4" : undefined}
        >
          {p.state === "active" ? (
            <animate
              attributeName="stroke-dashoffset"
              from="16"
              to="0"
              dur="1.1s"
              repeatCount="indefinite"
            />
          ) : null}
        </line>
      ))}

      {/* Dependencias reales entre especialistas: el trabajo que uno entrega a otro. */}
      {links.map((l, i) => {
        const a = byId.get(l.from);
        const b = byId.get(l.to);
        if (!a || !b) return null;
        return (
          <g key={`link-${i}`}>
            <path
              d={curve(a.x, a.y, b.x, b.y, cx, cy)}
              fill="none"
              stroke={colors.intel}
              strokeWidth={1.25}
              strokeOpacity={l.transferred ? 0.5 : 0.18}
            />
            {l.transferred ? (
              // El pulso representa una transferencia que ocurrió de verdad.
              <circle r={3} fill={colors.intel} opacity={0.9}>
                <animateMotion
                  dur="2.4s"
                  repeatCount="indefinite"
                  path={curve(a.x, a.y, b.x, b.y, cx, cy)}
                />
              </circle>
            ) : null}
          </g>
        );
      })}

      {/* Convergencia final: el integrador consolida los aportes. */}
      {integrating
        ? placed.map((p) => (
            <circle key={`conv-${p.id}`} r={3.5} fill={colors.gold} opacity={0.95}>
              <animateMotion
                dur="1.6s"
                repeatCount="indefinite"
                path={`M ${p.x} ${p.y} L ${cx} ${cy}`}
              />
            </circle>
          ))
        : null}

      <Core cx={cx} cy={cy} label={coreLabel} pulsing={anyActive || integrating} integrating={integrating} />

      {placed.map((p) => (
        <g key={`node-${p.id}`}>
          {p.state === "active" ? (
            <circle cx={p.x} cy={p.y} r={13} fill={STATE_COLOR[p.state]} opacity={0.18}>
              <animate attributeName="r" values="13;19;13" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.22;0.05;0.22" dur="2s" repeatCount="indefinite" />
            </circle>
          ) : null}
          <circle
            cx={p.x}
            cy={p.y}
            r={7}
            fill={p.state === "done" ? STATE_COLOR[p.state] : "#FFFFFF"}
            stroke={STATE_COLOR[p.state]}
            strokeWidth={1.8}
          />
          <text
            x={p.x}
            y={p.y + (p.y < cy ? -16 : 22)}
            textAnchor="middle"
            className="fill-current"
            style={{ fontSize: 11, fill: colors.carbon }}
          >
            {truncate(p.label)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Core({
  cx,
  cy,
  label,
  pulsing,
  integrating,
}: {
  cx: number;
  cy: number;
  label: string;
  pulsing?: boolean;
  integrating?: boolean;
}) {
  const ring = integrating ? colors.gold : colors.intel;
  return (
    <g>
      {pulsing ? (
        <circle cx={cx} cy={cy} r={30} fill={ring} opacity={0.12}>
          <animate attributeName="r" values="30;42;30" dur="2.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.14;0.03;0.14" dur="2.6s" repeatCount="indefinite" />
        </circle>
      ) : null}
      <circle cx={cx} cy={cy} r={26} fill={colors.navy} />
      <circle cx={cx} cy={cy} r={26} fill="none" stroke={ring} strokeWidth={1.5} strokeOpacity={0.8} />
      <text
        x={cx}
        y={cy + 4}
        textAnchor="middle"
        style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", fill: "#FFFFFF" }}
      >
        {label}
      </text>
    </g>
  );
}

/** Arco suave que evita cruzar el núcleo. */
function curve(x1: number, y1: number, x2: number, y2: number, cx: number, cy: number): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  // Se separa del centro para que la relación entre especialistas se lea aparte.
  const k = 0.35;
  const qx = mx + (mx - cx) * k;
  const qy = my + (my - cy) * k;
  return `M ${x1} ${y1} Q ${qx} ${qy} ${x2} ${y2}`;
}

function truncate(label: string, max = 22): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}
