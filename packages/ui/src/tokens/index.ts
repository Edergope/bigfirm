/**
 * Design tokens de IUSIA como código.
 *
 * FUENTE ÚNICA DE VERDAD VISUAL: derivados de
 * `documentacion/IUSIA_UI_UX_Design_System_MVP_v1.pdf` (§01–§02).
 * No introducir paletas, tipografías ni escalas nuevas sin decisión explícita.
 * El espejo machine-readable vive en `docs/design/iusia.tokens.json`.
 */

/** Paleta operativa (Design System §02). */
export const colors = {
  navy: "#0B1D3A", // marca, navegación, autoridad
  carbon: "#1F2937", // texto principal
  action: "#2563EB", // CTA, foco, selección
  intel: "#22C7E8", // IA, nodos, flujos (decorativo/no-texto: iconos, bordes, dots)
  intelText: "#0F798F", // intel a ≥4.5:1 AA sobre paper y su tinte /15 — usar cuando intel es texto
  gold: "#C9A24B", // acento premium mínimo (decorativo/no-texto)
  goldText: "#8B6D2A", // gold a ≥4.5:1 AA sobre paper y su tinte /10 — usar cuando gold es texto
  mist: "#A7ADB5", // bordes decorativos, dividers, tintes de fondo (no usar como texto)
  mistText: "#68707B", // texto mudo (metadata/hints/labels) — mist a ≥4.5:1 AA
  mistStrong: "#89919B", // borde de control interactivo — mist a ≥3:1 (WCAG 1.4.11)
  surface: "#F7F8FA", // superficies generales
  paper: "#FFFFFF", // lectura y tarjetas
  canvas: "#EEF1F6", // lienzo interior de la aplicación
  ambient: "#E7ECF4", // fondo ambiental sobre el que flota el contenedor
  ice: "#F4F7FC", // superficie fría interior
  aqua: "#EAF3F6", // tinte frío de acento
  navyDeep: "#071429", // navy con más materia (navegación)
  navySoft: "#12294B", // navy con menos peso (superficies internas)
  line: "#E3E7EE", // trazo estructural entre paneles
  lineStrong: "#D3D9E3", // trazo estructural con más presencia (cabeceras de tabla)
  // Estados semánticos — nunca únicos portadores de significado.
  success: "#16A34A", // decorativo/no-texto (dots, iconos, fondos)
  successText: "#11803A", // success a ≥4.5:1 AA sobre paper y su tinte /10 — usar cuando success es texto
  warning: "#D97706", // decorativo/no-texto (dots, iconos, fondos)
  warningText: "#A65B05", // warning a ≥4.5:1 AA sobre paper y su tinte /10 — usar cuando warning es texto
  critical: "#DC2626", // ya ≥4.5:1 AA como texto, no requiere variante
  info: "#2563EB", // ya ≥4.5:1 AA como texto, no requiere variante
} as const;

/** Escala tipográfica. Mínimos: 14px metadata, 15–16px texto operativo (§07). */
export const typography = {
  fontFamily: 'Inter, "Geist Sans", ui-sans-serif, system-ui, sans-serif',
  size: {
    meta: "13px",
    body: "15px",
    bodyLg: "16px",
    h4: "17px",
    h3: "20px",
    h2: "24px",
    h1: "30px",
  },
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
  leading: { tight: 1.2, snug: 1.35, normal: 1.5 },
} as const;

/** Grid base 8px; espaciados 8/12/16/24/32 (§02). */
export const spacing = {
  1: "8px",
  2: "12px",
  3: "16px",
  4: "24px",
  5: "32px",
  6: "48px",
} as const;

/** Radios de tarjeta 12–16px; controles algo menores para sobriedad. */
export const radius = {
  sm: "8px",
  md: "10px",
  card: "14px",
  pill: "9999px",
} as const;

/** Sombras mínimas — el Design System prohíbe sombras exageradas. */
export const shadows = {
  none: "none",
  hairline: "0 1px 2px rgba(11,29,58,0.06)",
  raised: "0 4px 16px -6px rgba(11,29,58,0.16)",
  overlay: "0 24px 60px -20px rgba(11,29,58,0.35)",
} as const;

/**
 * Motion. Reservado para orquestación, feedback y cambios espaciales (§05).
 * La navegación cotidiana es inmediata. Siempre respetar prefers-reduced-motion.
 */
export const motion = {
  duration: { instant: 0.08, fast: 0.16, base: 0.24, slow: 0.4 },
  ease: {
    standard: [0.2, 0, 0, 1] as [number, number, number, number],
    exit: [0.4, 0, 1, 1] as [number, number, number, number],
  },
  spring: { type: "spring", stiffness: 420, damping: 34 } as const,
} as const;

export const layout = {
  sidebarWidth: "236px",
  topbarHeight: "64px",
  contentMax: "1360px",
} as const;

export const tokens = { colors, typography, spacing, radius, shadows, motion, layout } as const;
export type Tokens = typeof tokens;
