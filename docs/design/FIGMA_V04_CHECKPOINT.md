# IUSIA — Matter Workspace · Resumen v0.4 — Checkpoint MCP oficial

> Generado al detener el uso del Figma MCP oficial (límite del plan Starter alcanzado).
> A partir de este checkpoint, todo trabajo de Figma continúa vía **figma-cli local**
> (`~/Developer/tools/figma-cli`), NO vía MCP remoto oficial.

## Identidad del archivo

- **Figma file key:** `O6Lk5XqizRT9f6et9wQoZ3`
- **Figma file URL:** https://www.figma.com/design/O6Lk5XqizRT9f6et9wQoZ3
- **Nombre del archivo:** `IUSIA — Product Design v0.4`
- **Plan/team usado para crearlo:** `EderGope` (planKey `team::1103114194394315143`)
- **Página:** `01 · Matter Workspace` — page id `0:1`

## Variables — colección `IUSIA`

- **Collection ID:** `VariableCollectionId:1:2`
- **Mode ID:** `1:0` (nombre del modo: `Value`, modo único — sin dark mode, por instrucción del brief)

### Color (18 variables)

| Nombre | Variable ID | Hex |
| :-- | :-- | :-- |
| color/navy | VariableID:1:3 | #0B1D3A |
| color/carbon | VariableID:1:4 | #1F2937 |
| color/action | VariableID:1:5 | #2563EB |
| color/intel | VariableID:1:6 | #22C7E8 |
| color/intelText | VariableID:1:7 | #0F798F |
| color/gold | VariableID:1:8 | #C9A24B |
| color/goldText | VariableID:1:9 | #8B6D2A |
| color/mist | VariableID:1:10 | #A7ADB5 |
| color/mistText | VariableID:1:11 | #68707B |
| color/mistStrong | VariableID:1:12 | #89919B |
| color/surface | VariableID:1:13 | #F7F8FA |
| color/paper | VariableID:1:14 | #FFFFFF |
| color/success | VariableID:1:15 | #16A34A |
| color/successText | VariableID:1:16 | #11803A |
| color/warning | VariableID:1:17 | #D97706 |
| color/warningText | VariableID:1:18 | #A65B05 |
| color/critical | VariableID:1:19 | #DC2626 |
| color/info | VariableID:1:20 | #2563EB |

### Spacing / Radius (10 variables)

| Nombre | Variable ID | Valor |
| :-- | :-- | :-- |
| space/1 | VariableID:1:21 | 8 |
| space/2 | VariableID:1:22 | 12 |
| space/3 | VariableID:1:23 | 16 |
| space/4 | VariableID:1:24 | 24 |
| space/5 | VariableID:1:25 | 32 |
| space/6 | VariableID:1:26 | 48 |
| radius/sm | VariableID:1:27 | 8 |
| radius/md | VariableID:1:28 | 10 |
| radius/card | VariableID:1:29 | 14 |
| radius/pill | VariableID:1:30 | 9999 |

Todas las variables tienen `scopes` explícitos (no `ALL_SCOPES`) y `codeSyntax` WEB en formato `var(--iusia-*)`.

**Nota importante:** NO se crearon variables de layout (`sidebarWidth`/`topbarHeight`) como variables Figma — el layout final usa un rail reducido de 176px (ver decisión visual más abajo), distinto del `sidebarWidth: 236px` de producción. Esto es intencional (exploración de composición, ver `docs/design/DESIGN.md` para el token de producción vigente, que no se modifica).

## Estilos de texto (9) — **familia única: Inter**

> **Corrección importante:** no se creó una familia serif. El Design System bloqueado
> (`docs/design/IUSIA_VISUAL_DIRECTION_LOCK.md` §4) especifica Inter/Geist Sans como única
> familia y prohíbe introducir una escala/familia nueva. El brief de esta fase permitía
> "serif + sans cuando exista una razón jerárquica" como rescate opcional de Stitch, pero
> por regla de precedencia (§1 del brief) se **omitió el serif** — la jerarquía editorial se
> logra solo con tamaño/peso, tal como exige el Design System. Ver Design Notes finales.

| Nombre | Style ID | Tamaño | Peso | Line height |
| :-- | :-- | :-- | :-- | :-- |
| IUSIA/h1 | S:262e1c032f02b824045160568fe95596560a94e1, | 30 | Semi Bold | 38 |
| IUSIA/h2 | S:84f15dc290a712e0c6610ba0558132c77f334ab6, | 24 | Semi Bold | 31 |
| IUSIA/h3 | S:9b35c375ef089356b43805f8952c7d4c2a89e88e, | 20 | Semi Bold | 26 |
| IUSIA/h4 | S:22cdf807589755a9977f04121b1b69267687be65, | 17 | Semi Bold | 23 |
| IUSIA/bodyLg | S:762ea5eb93cb528e1c29170964ab6fbe36e0986e, | 16 | Regular | 24 |
| IUSIA/body | S:1334bc1db56220f950f932e77185740054491ca1, | 15 | Regular | 22 |
| IUSIA/bodyMedium | S:fd4522c690105aa57e5ce498ac8e26570dd25728, | 15 | Medium | 22 |
| IUSIA/meta | S:62cc7377e1d574b02c6124a4b0ad0ef69d2d0bf5, | 13 | Medium | 18 |
| IUSIA/badge | S:2b70e64c207953998fd69873f27d143770cf1874, | 12.5 | Medium | 16 |

## Estilos de sombra (3)

| Nombre | Style ID | Offset | Blur | Spread | Color/alpha |
| :-- | :-- | :-- | :-- | :-- | :-- |
| IUSIA/hairline | S:b24bf05e4e1e7867686af05760aa0572391e8a85, | 0,1 | 2 | 0 | navy 6% |
| IUSIA/raised | S:cb1b72552890512c8b49ab6e2bf1594416e7c221, | 0,4 | 16 | -6 | navy 16% |
| IUSIA/overlay | S:d5e3e35309bf90e016b4aeb7b99a977d517679f2, | 0,24 | 60 | -20 | navy 35% |

## Componentes maestros (8) — construidos y validados visualmente

Todos ubicados en un área de staging en la misma página, `x=1600+`, fuera del frame principal.

| Componente | Node ID | Estado | Notas |
| :-- | :-- | :-- | :-- |
| StatusChip | `2:2` | ✅ validado | dot + label, tono/color se sobreescriben por instancia (no es un variant set formal) |
| Button/Ghost | `2:5` | ✅ validado | label + chevron-right, único estilo de acción usado en todo el screen (sin variante Secondary/Primary — decisión: editorial, evita "botonería" pesada) |
| NavItem | `3:2` | ✅ validado | icon + label, 212px maestro (las instancias usan `layoutSizingHorizontal: FILL` dentro del rail de 176px) |
| MatterTab | `3:7` | ✅ validado | label + indicator inferior |
| DocumentRow | `3:11` | ✅ validado | icon + nombre/meta + instancia anidada de StatusChip |
| TimelineItem | `3:24` | ✅ validado | fecha + label + instancia anidada de StatusChip (tag) |
| AttentionItem | `4:6` | ✅ validado | icon + título/descripción + instancia anidada de Button/Ghost |
| IntelligenceInsight | `4:19` | ✅ validado (tras fix de opacidad del fondo) | badge "IUSIA DETECTÓ" + finding/reason/source + instancia de Button/Ghost. Fondo intel/7% tint — CORREGIDO tras bug inicial (ver "Bugs encontrados") |

### Bugs encontrados y corregidos durante la construcción (para no repetirlos)

1. **`resize()` resetea `counterAxisSizingMode` a `FIXED`.** Afectó a NavItem, DocumentRow, TimelineItem, AttentionItem, IntelligenceInsight — todos se crearon con altura fija (10px) en vez de hug. Corregido reasignando `counterAxisSizingMode = "AUTO"` después de la creación. **Regla para next steps:** siempre `resize()` ANTES de fijar los sizing modes, nunca después.
2. **Ejes de sizing invertidos en IntelligenceInsight** (layout VERTICAL): se puso `primaryAxisSizingMode="FIXED"` (fija la altura, incorrecto) y `counterAxisSizingMode="AUTO"` (hug del ancho, incorrecto) — era al revés. Corregido a `counterAxisSizingMode="FIXED"` (ancho fijo 360) + `primaryAxisSizingMode="AUTO"` (hug alto).
3. **Opacidad de paint bound a variable no se aplicó** al asignar `.opacity` sobre el objeto retornado por `setBoundVariableForPaint` antes de asignarlo a `.fills` — el fill quedó sólido en vez de 7%. Corregido leyendo `node.fills[0]`, clonando con spread `{...current, opacity: 0.07}` y reasignando el array completo.
4. **`array.indexOf(nodeRef)` con una referencia obtenida vía `findOne()` devolvió `-1`** (falla de igualdad de referencia entre wrappers), causando `insertChild` con índice negativo. **Regla:** usar `array.findIndex(c => c.id === ref.id)` en vez de `indexOf` con objetos-nodo.

## Frame principal — `Matter Workspace · Resumen · Desktop`

- **Wrapper frame ID:** `5:12` — 1440px ancho, `layoutMode: HORIZONTAL`, fills = `color/surface`
- **Rail ID:** `5:13` — 176px ancho fijo, fondo `color/paper`, borde derecho `color/mist` 18% opacidad 1px. **Contenido: PENDIENTE** (el script de contenido del Rail está escrito y corregido — dos bugs resueltos — pero la última ejecución no llegó a correr por el rate limit del MCP; ver sección "Script pendiente" abajo)
- **MainColumn ID:** `5:14` (frame vertical, fills=[], FILL horizontal+vertical dentro del wrapper) — *nota: el ID exacto de MainColumn no fue capturado explícitamente en el return de la llamada; recuperar vía `get_metadata`/inspección de hijos de `5:12` al retomar*
- **Topbar ID:** `5:15` — 64px alto, ancho FILL, fondo `paper`, borde inferior `mist` 18%. **Contenido: PENDIENTE** (búsqueda deshabilitada honesta, notificaciones, usuario — sin inventar funcionalidades)
- **Content ID:** `5:16` — vertical, gap 24, padding 40/28/40/40 (L/T/R/B tal como se creó: left 40, right 40, top 28, bottom 40), ancho FILL
  - **MatterHeader ID:** `5:17` — placeholder, PENDIENTE
  - **TabsRow ID:** `5:18` — placeholder, PENDIENTE
  - **BodySplit ID:** `5:19` — placeholder, PENDIENTE (aquí va el split 8/4: Strategic Core + Hechos/Documentos clave + Próximos hitos a la izquierda; Requiere tu atención + IUSIA detectó a la derecha)

## Contenido/copy ya decidido (para no re-redactar)

**Header del Matter:**
- Cliente: Grupo Meridian S.A.S.
- Matter: Terminación anticipada de contrato de distribución nacional
- Contraparte: Distribuciones Andinas S.A.S.
- Área: Derecho Comercial · Jurisdicción: Colombia — Bogotá D.C.
- Responsable: Laura Mendoza (Socia)
- Estado: Estrategia en revisión · Materialidad: Alto impacto (warning)
- Próximo término relevante: Contestación reconvención — 12 sept 2026

**Tabs reales (de `apps/web/src/client/pages/MatterWorkspace.tsx`):** Resumen (activo) · Documentos · Hechos y fuentes · Tareas y términos · Estrategia · Actividad

**Nav real (de `AppShell.tsx`):** Inicio · Casos (activo, porque estamos dentro de un matter) · Tareas y términos · Documentos · Plantillas · Inteligencia

**Strategic Core (hoja ejecutiva editorial, NO 4 KPI cards):**
1. Situación actual: representación de Grupo Meridian en terminación anticipada; contraparte objetó y anunció reconvención por lucro cesante; expediente en fase de preparación de contestación. Riesgo: Medio-Alto.
2. Objetivo jurídico: sostener validez de la terminación (cláusula 14ª, incumplimiento de cuotas mínimas) y contener exposición de la reconvención bajo COP 800.000.000.
3. Estrategia actual: consolidar incumplimiento documental de cuotas mínimas 2025-2026 como causal objetiva; explorar salida negociada si el riesgo de reconvención se eleva tras la contestación.
4. Issues críticos:
   - Preaviso de 90 días — controversia sobre cumplimiento por Meridian [warning]
   - Cláusula de exclusividad regional — riesgo de alegato de competencia desleal [warning]
   - Cuantificación del lucro cesante reclamado — sin soporte contable verificado [info/neutral]

**Hechos clave (TimelineItem, certeza vía StatusChip):**
- 14 ene 2025 — Suscripción del Otrosí No. 2 que modifica cuotas mínimas [Documental]
- 03 jun 2026 — Meridian notifica terminación por incumplimiento de cuotas mínimas [Acreditado]
- 22 jul 2026 — Distribuciones Andinas objeta la terminación y anuncia reconvención [Alegado]

**Documentos clave (DocumentRow):**
- Otrosí No. 2 — Contrato de distribución · Aprobado · 14 ene 2025 · Laura Mendoza
- Carta de terminación — Comunicación formal · Aprobado · 03 jun 2026 · Laura Mendoza
- Proyección de lucro cesante (contraparte) — Documento de la contraparte · Crítico (sin verificar) · 22 jul 2026 · —

**Próximos hitos (TimelineItem, tipo vía StatusChip):**
- 12 sept 2026 — Contestación de la reconvención [Término, warning]
- 05 sept 2026 — Verificar cumplimiento de preaviso en bitácora comercial [Tarea, neutral]
- 28 ago 2026 — Comité de riesgo con Dirección [Reunión, info]

**Requiere tu atención (AttentionItem x3):**
1. Aprobación: objetivo de orquestación jurídica pendiente de validación por Dirección → acción "Aprobar"
2. Documento pendiente: soporte contable de cuotas mínimas 2026 aún no cargado por el cliente → acción "Solicitar"
3. Término: contestación de la reconvención vence en 21 días → acción "Ver tarea"

**IUSIA detectó (IntelligenceInsight, instancia única):**
- Hallazgo: la cláusula 14ª exige preaviso de 90 días; la carta de terminación se envió con 76 días de antelación.
- Razón: podría debilitar el fundamento de la terminación si la contraparte acredita el cómputo correcto del plazo.
- Fuente: Otrosí No. 2, Cláusula 14ª · Carta de terminación, 03 jun 2026.
- Acción: revisar cómputo de días hábiles con el equipo antes de la contestación.

Este contenido conecta Issues críticos ↔ IUSIA detectó ↔ Hechos clave (la tensión de los 90 vs. 76 días), demostrando inteligencia integrada real, no decorativa.

## Script pendiente (Rail) — listo para adaptar a figma-cli

El siguiente script de Plugin API estaba listo para ejecutarse (corregido, no ejecutado por el
rate limit) y construye: bloque de marca (wordmark "IUSIA" + tagline), lista de 6 NavItem
(instancias del maestro `3:2`, "Casos" activo), spacer, footer "Cerrar sesión". Debe adaptarse
a la sintaxis/mecanismo que exponga figma-cli (puede que no acepte Plugin API JS crudo).
Ver commits/historial de esta sesión si se necesita el código exacto; en su defecto, reconstruir
siguiendo la especificación de esta sección + "Estructura y componentes" arriba.

## Pendiente (orden sugerido al retomar)

1. Contenido del Rail (script arriba).
2. Contenido del Topbar (búsqueda deshabilitada honesta + notificaciones + usuario).
3. Matter Header editorial (cliente/matter/contraparte/área/responsable/estado/término).
4. TabsRow (6 instancias de MatterTab, "Resumen" activo).
5. BodySplit 8/4:
   - Columna izquierda: Strategic Core → Hechos clave + Documentos clave (lado a lado) → Próximos hitos.
   - Columna derecha (~360-400px fijo): Requiere tu atención (3× AttentionItem) → IUSIA detectó (IntelligenceInsight).
6. Validación visual completa + checklist de calidad (§27 del brief): contraste, jerarquía, "¿se entiende el Matter en <10s?", no card-zoo, nav no domina, IA integrada no chatbot.
7. Entrega final: URL + page + frame + node ID, captura completa, Design Notes (máx. 10), y el cierre `GATE — MATTER WORKSPACE V0.4 READY FOR HUMAN DESIGN REVIEW`.

## Actualización — construcción vía figma-cli (Safe Mode)

Se abandonó el MCP oficial (límite de plan) y luego el modo Browser de figma-cli (no
detectaba la pestaña) a favor de **figma-cli Safe Mode** (plugin FigCli en Figma Desktop).
Conexión confirmada y estable sobre el archivo correcto `IUSIA — Product Design v0.4`.

**Completado con figma-cli:**
- Rail (`5:13`): wordmark, tagline, 6 NavItem (Casos activo), spacer, footer "Cerrar sesión". ✅
- Topbar (`5:15`): búsqueda deshabilitada honesta (400px, una línea), notificaciones, identidad de usuario (avatar iniciales "LM" + Laura Mendoza / Socia). ✅
- MatterHeader (`5:17`): eyebrow "← Casos", título editorial, chips "Alto impacto" + "Estrategia en revisión" (tintes 10-12%, no sólidos), línea de metadata. ✅

**COMPLETO.** TabsRow (`5:18`, 6 tabs, Resumen activo), BodySplit (`5:19`) con Strategic Core,
Hechos clave, Documentos clave, Próximos hitos (columna izquierda `9:563`) y Requiere tu
atención + IUSIA detectó (columna derecha `9:564`). Frame final `5:12` redimensionado a
1440×1294 (hug real del contenido). Limpieza de 6 nodos huérfanos de intentos fallidos
anteriores. Estado: **GATE — MATTER WORKSPACE V0.4 READY FOR HUMAN DESIGN REVIEW.**

### Gotchas de figma-cli (Safe Mode) — no repetir

1. **`node.placeholder` NO EXISTE en el Plugin API real** — es una propiedad sintética exclusiva
   del plugin del MCP oficial de Figma. En figma-cli lanza `object is not extensible`. **Nunca
   usar `.placeholder` en scripts de figma-cli.**
2. **`eval` reintenta automáticamente hasta 2 veces en Safe Mode ante CUALQUIER error** (no solo
   timeouts) — y **no es atómico**: cada reintento re-ejecuta el script completo, duplicando
   todo lo ya creado antes del punto de fallo. Por eso un solo error deja 2-3 copias de los nodos
   creados antes de la línea que falló.
   - **Mitigación:** scripts pequeños y ya probados; si algo falla, limpiar duplicados
     (`node.remove()` por id) ANTES de reintentar, nunca reintentar directamente sobre el estado sucio.
3. **`resize(w, h)` resetea `primaryAxisSizingMode`/`counterAxisSizingMode` a `FIXED` en AMBOS
   ejes**, sin importar si los modos se fijaron antes o después — salvo que se re-fijen DESPUÉS
   del `resize()`. Bug recurrente en esta sesión: `Content` (`5:16`) quedó con `h:10` y
   `clipsContent:true`, ocultando TODO el contenido (MatterHeader, TabsRow, BodySplit) sin dar
   ningún error — el archivo se veía "vacío" hasta revisar `primaryAxisSizingMode` explícitamente.
   **Si algo "no aparece" en una captura, lo primero a revisar es el sizing mode de cada
   contenedor ancestro, no asumir que el contenido no se creó.**
4. **La opacidad en un paint ligado a variable (`setBoundVariableForPaint`) no se aplica de forma
   confiable si se hace `{ ...paint, opacity: X }` en la MISMA sentencia donde se crea el paint y
   se asigna a `.fills`.** Patrón que sí funciona: asignar primero el paint (opacity queda en 1),
   luego en un paso posterior leer `node.fills[0]` (ya asignado) y reasignar
   `node.fills = [{ ...node.fills[0], opacity: X }]`. Pasó 3 veces en esta sesión (nav activo,
   IntelligenceInsight, chips del header).
5. **Instancias de componentes NO permiten `insertChild`/`removeChild`** (edición estructural) —
   solo overrides de propiedades existentes. Para reemplazar un ícono SVG dentro de una instancia
   (p. ej. NavItem), primero `instance.detachInstance()` (retorna un FRAME normal editable) y
   recién ahí insertar/eliminar hijos.
6. **`node.textStyleId = X` síncrono falla bajo `documentAccess: dynamic-page`** (manifest del
   plugin Safe Mode) con `Cannot call with documentAccess: dynamic-page`. Evitar estilos de texto
   vía `textStyleId` en scripts de figma-cli; asignar `fontName`/`fontSize`/`lineHeight`
   directamente en su lugar (funciona sin problema).
7. Preferir `eval -f <archivo>` (script en disco) sobre pasar JS inline como argumento — más
   fácil de depurar y reintentar.

## Regla vigente a partir de este checkpoint

**El Figma MCP oficial queda fuera del flujo** por límite del plan Starter. Todas las
operaciones de Figma de aquí en adelante deben hacerse vía **figma-cli local**
(`~/Developer/tools/figma-cli`), no vía MCP remoto.

## Ronda 2 — atmósfera, profundidad y superficies (Premium Soft Glass)

Sin tocar la arquitectura de información ya construida, se añadió (misma sesión figma-cli):

- **Fondo del frame** (`5:12`): gradiente lineal sutil blanco → gris-azulado frío (antes gris
  plano `color/surface`).
- **Dos resplandores atmosféricos** dentro de `Content` (`5:16`): `AtmosphereGlow/Navy`
  (`13:787`, navy 5%, blur 140px) y `AtmosphereGlow/Cyan` (`13:788`, intel 6%, blur 130px),
  posicionamiento absoluto, muy sutiles — atmósfera sin ruido visual.
- **`HeaderPlane/Surface`** (`13:789`): superficie blanca posicionada en absoluto detrás de
  MatterHeader + TabsRow, radio 22, sombra suave navy 10% (offset 0,10 blur 32 spread -8).
- **`LeftColumn`** (`9:563`) y **`RightColumn`** (`9:564`) convertidas en superficies propias:
  padding 30-34px / 26-28px, fondo `paper`, radio 24, sombra suave navy 9% (offset 0,14 blur 40
  spread -12) — layout bento asimétrico de 2 módulos grandes sobre el fondo atmosférico;
  resuelve la integración visual del rail derecho (ya no flota aislado sobre gris plano).
- **`IntelligenceInsight`** instancia (`9:772`): reemplazado el tinte sólido plano por gradiente
  lineal cian→navy (14%→5% alpha), borde 1px cian 22% opacidad, sombra-glow cian 16% blur 28 —
  sofisticación del bloque de IA sin caer en glassmorphism exagerado ni bloque de color chillón.
- Wrapper redimensionado a **1440×1449** tras el crecimiento por padding de las nuevas
  superficies.

**Gotcha adicional confirmado en esta ronda:** el bug de opacidad-no-aplicada en paints ligados
a variable (ítem 4 de la lista de arriba) también afecta ellipses/rects nuevos, no solo texto —
se repitió en los 2 blobs atmosféricos (`13:787`, `13:788`) y se corrigió con el mismo patrón de
dos pasos (asignar, releer `fills[0]`, reasignar con opacity correcta).

Estado tras ronda 2: **GATE — MATTER WORKSPACE V0.4 READY FOR HUMAN DESIGN REVIEW** (iteración 2,
premium soft glass).
