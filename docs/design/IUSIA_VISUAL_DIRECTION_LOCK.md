# IUSIA — Visual Direction Lock

> Interpretación operativa bloqueada del sistema visual ya implementado. **No reemplaza**
> `documentacion/IUSIA_UI_UX_Design_System_MVP_v1.pdf` (fuente normativa) ni `docs/design/DESIGN.md`
> (guía derivada). Ante contradicción, gobierna el PDF. Precedencia completa:
>
> ```
> IUSIA_UI_UX_Design_System_MVP_v1.pdf → IUSIA_VISUAL_DIRECTION_LOCK.md (este doc)
>   → DESIGN.md → tokens → Figma → packages/ui → screens
> ```
>
> Este documento fija decisiones — no inventa estética nueva. Cada regla aquí ya está
> implementada en `packages/ui`, `docs/design/iusia.tokens.json` y las 5 vistas MVP en Figma.

## 1. Design statement

**IUSIA es el sistema operativo intelectual de una firma jurídica moderna.** No es un CRM, no
es un dashboard financiero, no es un chatbot, no es un "AI wrapper" con una capa de chat encima.
El **matter** es el centro; la IA es una capacidad integrada al expediente, nunca la protagonista
visual. La interfaz comunica autoridad, inteligencia, control, precisión, serenidad y
sofisticación — jurídica antes que futurista, tecnológica sin estética cyberpunk.

## 2. Principios visuales

- **Sobriedad.** Nada es decorativo porque sí. Si un elemento no comunica jerarquía, estado o
  función, no existe.
- **Densidad profesional.** El abogado procesa mucha información sin sentir saturación
  (`COMPACT PREMIUM`, no `SPACIOUS MARKETING SAAS`, no Excel).
- **Jerarquía editorial.** ADN de documento jurídico premium: títulos claros, metadata
  subordinada, lectura escaneable. La diferencia entre niveles surge de tamaño + peso +
  espaciado + color — no de inventar más estilos.
- **Inteligencia operativa.** La IA aparece contextual y estructurada (Case Brief, Strategy
  Room), nunca omnipresente. No domina visualmente la interfaz.
- **Precisión.** Estado, términos, riesgo, autoridades y agentes se distinguen instantáneamente
  — nunca sólo por color (siempre texto o icono acompañando).

## 3. Roles de color

| Token | Hex | Rol | Uso como texto |
| :-- | :-- | :-- | :-- |
| `navy` | `#0B1D3A` | Marca, navegación, autoridad | Sí (16.8:1) |
| `carbon` | `#1F2937` | Texto principal | Sí (14.7:1) |
| `action` | `#2563EB` | CTA, foco, selección — único azul "clicable" | Sí (5.2:1) |
| `intel` | `#22C7E8` | IA, nodos, flujos — **decorativo, no texto** | No → usar `intelText` (`#0F798F`, 4.5–5.1:1) |
| `gold` | `#C9A24B` | Acento premium mínimo — **decorativo, no texto** | No → usar `goldText` (`#8B6D2A`, 4.5–4.9:1) |
| `mist` | `#A7ADB5` | Bordes decorativos, dividers, tintes — **no texto** | No → `mistText` (`#68707B`) para texto, `mistStrong` (`#89919B`) para bordes de control interactivo |
| `success`/`warning` | `#16A34A`/`#D97706` | Estados — decorativo (dots, iconos, fondos) | No como texto pequeño → `successText`/`warningText` |
| `critical`/`info` | `#DC2626`/`#2563EB` | Estados | Sí, ya cumplen AA |
| `surface`/`paper` | `#F7F8FA`/`#FFFFFF` | Superficie general / lectura y tarjetas | — |

**Regla dura:** todo color de marca/estado tiene dos roles posibles — decorativo (icono, borde,
punto, fondo tintado; sólo exige ≥3:1) o texto (exige ≥4.5:1). Cuando la duda exista, usar la
variante `-Text`. Esto no diluye la marca: `intel` vívido sigue en iconos, bordes y nodos; sólo
el texto pequeño usa el tono oscurecido. Ver §14 (baseline de accesibilidad).

**Proporción orientativa** (no es fórmula, es disciplina de restraint): 70–80% neutrales
(paper/surface/mist), 15–20% navy/carbon, <10% acentos semánticos (action/intel/gold/estados).

**Gold nunca es CTA universal** — sólo acento premium puntual (`CreditBadge`, detalles selectos).
**Cyan/intel no pinta toda la aplicación** — reservado a IA, Strategy Room, navegación activa.

## 4. Jerarquía tipográfica

Familia: Inter / Geist Sans. Ninguna escala adicional a la ya tokenizada
(`packages/ui/src/tokens/index.ts`):

| Nivel | Tamaño | Peso | Uso |
| :-- | :-- | :-- | :-- |
| Display / Product heading | 30px (`h1`) | 600 | Título de página (`PageHeader`) |
| Section heading | 24px (`h2`) | 600 | `h2` de página |
| Card/panel heading | 20px (`h3`) | 600 | Títulos de tarjeta |
| Subheading | 17px (`h4`) | 600 | Encabezados menores |
| Body operativo | 15–16px | 400–500 | Texto de trabajo, inputs |
| Metadata | 13px | 400–500 | Hints, subtítulos, timestamps — **piso general** |
| Badge/status | 12.5–13px | 500 | Chips, contadores |

Jerarquía por tamaño + peso + color — nunca por introducir una familia o escala nueva.

**Excepción documentada (marca):** el wordmark/tagline `IUSIA · INTELLIGENCE · LAW · ADVANTAGE`
usa 10.5–11px por tratamiento tipográfico propio (tracking amplio, mayúsculas). Calza en la
exención WCAG de "texto que es parte de un logo/marca" — y aun así se subió su contraste a
`white/55` (5.8:1) para no depender de la exención. Ver §14.

**Excepción documentada (Strategy Room):** metadata técnica del grafo (modelo, créditos,
secuencia de eventos) usa 10.5–11.5px por ser un "command space" denso (§13). Contraste ya
cumple AA (`mistText`/`intelText`/etc.); el tamaño reducido es una decisión de densidad, no un
defecto — ver §5 y §13.

## 5. Densidad y spacing

Grid base 8px: `8 · 12 · 16 · 24 · 32 · 48`. Radios: `8 (sm) · 10 (md) · 14 (card) · 9999 (pill)`
— sin radios de 20–24px salvo justificación. Sombras mínimas y tintadas hacia navy
(`hairline · raised · overlay`), nunca negro puro.

| Superficie | Padding interno | Radio |
| :-- | :-- | :-- |
| Control (Input/Select/Button) | `px-3` / `px-4`, altura 32–40px | `md` (10px) |
| Card | `px-6 py-4` header, `p-6`/`p-5` body | `card` (14px) |
| Drawer | `px-5 py-5` | — |
| Tabla | filas 44–52px, `px-5` | — |

`COMPACT PREMIUM`: sidebar fija 236px, topbar 64px, contenido `max-w-[1360px]`. Sin scroll
innecesario en vistas core; sin verse como spreadsheet (tablas con aire vertical, no ceros
comprimidos).

## 6. Iconografía

Lucide, único set. `strokeWidth` 1.8 (inactivo) / 2.2 (activo) en nav; 16–20px según contexto.
Sin emoji. Sin iconos encerrados en cajas decorativas sin función. Icono nunca sustituye texto
en acciones ambiguas.

## 7. Lenguaje de botones

Confirmado: **4 variantes reales, no 8.** Los "8 variants" de Figma son `variant(4) × size(2)` —
un sistema de 2 ejes correcto, no 8 apariencias redundantes. No se consolidó porque no hay
redundancia que resolver.

- **Primary** (`action`, fondo sólido) — una sola CTA principal por vista.
- **Secondary** (borde `mistStrong`, fondo `paper`) — acción alternativa.
- **Ghost** (sin fondo/borde) — acción terciaria, tablas y toolbars.
- **Destructive** (`critical`) — sólo cuando la acción es irreversible.

Sin glow, sin gradiente, sin tamaño gigante. Feedback de presión: `active:scale-[0.97]`
(agregado en esta pasada — antes sólo tenía `transition-colors`, quedaba plano al presionar).

## 8. Tablas

Patrón ya correcto en `Matters.tsx` — lockeado: header discreto (`mistText`, 12.5px, mayúsculas
implícitas por tracking, no bold agresivo), filas 44–52px, hover `surface`, alineación numérica
tabular (`tnum`), acciones/estado a la derecha. Las tablas NO se reemplazan por cards cuando son
superiores (listas de expedientes, specs). Nunca `border` en cada fila — un solo separador
(`divide-y`) o ninguno.

## 9. Matter Workspace

**El corazón visual del producto.** El matter pesa más que cualquier widget. Ya implementado:
Case Brief (hechos aceptados, riesgos, próximos términos) como panel primario, pestañas
(`role="tablist"` real, ya con ARIA) para Tareas/Documentos/Strategy Room. No es un dashboard de
mini-cards — es lectura editorial + operativa: qué asunto es, qué ocurre, qué riesgos, qué
vence, qué hizo la IA, qué debe hacer el abogado.

## 10. Home

Responde "¿qué requiere mi atención?", no "cuántos KPIs tengo". Ya implementado: KPIs son la
fila superior (secundaria), "Expedientes recientes" + "Requiere atención" son el cuerpo
(primario). No se invierte este orden.

## 11. Strategy Room — excepción visual documentada

Única vista con licencia para romper ligeramente el sistema general (§13 del brief original) —
pero sigue siendo IUSIA, no sci-fi. Reglas ya cumplidas:

- Cada nodo = una ejecución real (`execution_id`); cada arista = un evento real del Execution
  Ledger. La raíz de ejecución no es un nodo-agente.
- El pulso de una arista sólo se activa si el nodo destino está `RUNNING`/`WAITING` — motion
  nunca decorativo tras completar.
- Fondo de nodos: blanco/paper, no oscuro — la IA no domina visualmente ni en su propia vista.
- Sin partículas aleatorias, sin holograms, sin Matrix UI, sin actividad de IA fingida.

## 12. Motion

Tokens ya fijados en `packages/ui/src/tokens/index.ts`:

| Tier | Duración | Uso |
| :-- | :-- | :-- |
| `instant` | 80ms | Micro-feedback (press) |
| `fast` | 160ms | Hover, botones |
| `base` | 240ms | Drawers, dropdowns |
| `slow` | 400ms | Cambios espaciales grandes |
| `spring` | stiffness 420 / damping 34 | Drawer, transiciones interrumpibles |

Reglas: `motion = state change / event / relación causal`, nunca decoración. Navegación, tablas
y filtros son inmediatos por diseño (no un olvido — confirmado en esta revisión). Reservado a
Strategy Room, procesos de agentes, feedback, drawers/modals y cambios espaciales. Animación
continua (pulso "en ejecución") usa `ease: "linear"`, no la curva por defecto — corregido en
esta pasada en `StrategyRoom.tsx`. Siempre `prefers-reduced-motion`.

## 13. Anti-patrones (bloqueados)

Los ya listados en `DESIGN.md` — gradientes morado/azul, glow de IA, glassmorphism gratuito,
card-in-card, badges para todo, hero dentro del app, animación decorativa, copy genérica — más:

- Cyan/gold como color de fondo dominante de cualquier vista fuera de Strategy Room.
- Ocho variantes visuales de botón donde dos ejes (variant × size) ya cubren el caso.
- Contraste de texto por debajo de 4.5:1 "porque el tono de marca lo pide" — usar la variante
  `-Text` en su lugar (§3).
- Regla ciega "todo texto <12px es inválido" — el criterio real es contraste + función +
  densidad, no un umbral de píxeles (ver §4, excepciones documentadas).

## 14. Baseline de accesibilidad

WCAG AA: texto normal ≥4.5:1, texto grande (≥18.66px o ≥14px bold) ≥3:1, componentes gráficos
funcionales (bordes de Input/Select/Textarea/botón secundario) ≥3:1 (1.4.11). Implementado vía
tokens `-Text` (§3) y `mistStrong` para bordes interactivos. `figma-cli a11y audit` en las 5
vistas MVP: **contraste 100% pass**; únicos restantes son el heurístico de tamaño de fuente
(no-WCAG) del tagline de marca y la metadata densa de Strategy Room, ambos documentados como
excepción en §4.

---

*Bloqueado 2026-08-22. Cambios futuros al sistema visual pasan primero por este documento antes
que por código o Figma.*
