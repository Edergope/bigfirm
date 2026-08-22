# IUSIA — UI_QA_PLAN

Auditoría del frontend actual (`mvp-design-v0.3`) con el toolchain instalado. Prioridad
normativa: **IUSIA Design System > Taste > Impeccable > Emil** (para motion: IUSIA > Emil).

**Detector determinista de Impeccable:** `node .claude/skills/impeccable/scripts/detect.mjs
apps/web/src/client packages/ui/src` → **0 anti-patrones**. Sin nested cards, contraste
malo, gris minúsculo, badges gratuitos ni drift detectable.

Hallazgos de juicio (Taste/Impeccable/Emil), priorizados:

| # | Issue | Source | Prio | Cambio | Files |
| :- | :- | :- | :- | :- | :- |
| 1 | Barra de búsqueda del topbar es un `<div>` no funcional que aparenta ser interactivo (fake affordance = slop; y no es accesible por teclado). | Impeccable/Taste | **P1** | Convertir en control honesto: `<button>` con `aria-label`, cursor `not-allowed`, cue "Pronto". No fingir funcionalidad. | `AppShell.tsx` |
| 2 | Los tabs del Matter Workspace son `<button>` sueltos sin semántica de tablist (sin `role="tab"`/`aria-selected`, sin navegación por flechas). | Impeccable (a11y) | **P1** | `role="tablist"`/`role="tab"`/`aria-selected`; foco correcto. | `MatterWorkspace.tsx` |
| 3 | La arista `work_package.sent` de la Strategy Room se anima **siempre**, incluso tras completar — motion decorativo sin evento vivo. | Emil | **P1** | Animar la arista sólo mientras el nodo destino está `RUNNING`/`WAITING`. | `StrategyRoom.tsx` |
| 4 | Home mezcla vencidos (rojo) y próximos (ámbar) en una lista sin encabezados de grupo. | Taste (jerarquía) | **P2** | Separadores/etiquetas de grupo. | `Home.tsx` (diferido: aceptable) |
| 5 | Sidebar fija de 236px consume mucho ancho en <768px (móvil no es prioridad MVP). | Impeccable (responsive) | **P3** | Diferido: el DS marca desktop-first; tablet/desktop verificados sin overflow. | — |

**Correcciones aplicadas:** #1, #2, #3 (justificadas y compatibles con el DS). #4/#5 diferidas
por restraint del Design System (no sobre-diseñar; desktop-first es la prioridad declarada).
