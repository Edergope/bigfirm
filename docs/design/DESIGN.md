# IUSIA — DESIGN.md (guía de diseño derivada)

> **Fuente normativa:** `documentacion/IUSIA_UI_UX_Design_System_MVP_v1.pdf`.
> Este documento **deriva** de ese PDF; no lo reemplaza. Ante conflicto, gobierna el PDF.
> Los tokens machine-readable están en [`iusia.tokens.json`](./iusia.tokens.json) y en
> código en `packages/ui/src/tokens`.

## Voz visual

IUSIA es **LegalTech premium e institucional**: criterio, control y trazabilidad.
Jurídica antes que futurista; tecnológica sin estética cyberpunk. El **matter es el
centro**; la IA es una capacidad integrada al expediente, no un chatbot.

La navegación cotidiana es **sobria, densa y estable**. La expresividad se reserva para
la **orquestación multiagente** (Strategy Room) y sólo representa actividad real.

## Anti-slop (rechazar explícitamente)

Gradientes morado/azul cliché · glow aleatorio · glassmorphism gratuito · iconos en
cuadrados redondeados por todas partes · card-in-card · sombras exageradas · texto gris
minúsculo · badges para todo · hero dentro del app · todo centrado · animación decorativa ·
espacio vacío sin propósito · copy genérica tipo "Unlock the power of AI".

## Paleta

| Rol | Token | Hex |
| :-- | :-- | :-- |
| Marca / navegación | `navy` | #0B1D3A |
| Texto principal | `carbon` | #1F2937 |
| Acción / foco | `action` | #2563EB |
| IA / nodos / flujos | `intel` | #22C7E8 |
| Acento premium | `gold` | #C9A24B |
| Bordes / metadata | `mist` | #A7ADB5 |
| Superficie | `surface` | #F7F8FA |
| Lectura / tarjetas | `paper` | #FFFFFF |

Semánticos: éxito #16A34A · advertencia #D97706 · crítico #DC2626 · info #2563EB.
**Nunca depender sólo del color**: siempre texto o icono.

## Tipografía

Inter / Geist Sans. Mínimos: 13px metadata, 15–16px texto operativo. Jerarquía por peso y
tamaño, no por color. El wordmark IUSIA conserva tratamiento propio (tracking amplio).

## Estructura y densidad

- Grid base 8px; espaciados 8/12/16/24/32/48.
- Sidebar fija ~236px; top bar ~64px.
- Tarjetas: borde sutil, sombra mínima, radio 14px. Sin cards anidadas sin función.
- Tablas de alta legibilidad, filas 44–52px, acciones a la derecha.
- Botón primario `action`; secundario contorno; destructivo `critical` sólo cuando aplique.

## Estados (siempre distinguibles)

Toda vista conectada a datos distingue: `LOADING · EMPTY · NOT_CONFIGURED · UNAUTHORIZED ·
FORBIDDEN · ERROR · READY`. **Nunca ceros silenciosos ni datos fingidos.** Seed data se
rotula `DEMO / DEVELOPMENT DATA`.

## Motion

Reservado para Strategy Room, procesos de agentes, feedback, drawers/modals y cambios
espaciales. Navegación, tablas y filtros son **inmediatos**. Sólo `transform`/`opacity`;
siempre `prefers-reduced-motion`. Tokens en `packages/ui/src/tokens` (`motion`).

## Strategy Room

Identidad visual propia. Cada nodo = una ejecución real (`execution_id`); cada pulso = un
evento real del Execution Ledger. La raíz de ejecución **no** es un nodo-agente. Sin loops
espurios. Ramas paralelas se ven realmente paralelas.

## Flujo de verdad

```
IUSIA_UI_UX_Design_System_MVP_v1.pdf → DESIGN.md → tokens → packages/ui → React
```

Los skills externos de diseño (Taste, Impeccable, Emil, figma-cli) —cuando se conecten—
**mejoran el criterio**, no reemplazan esta identidad.
