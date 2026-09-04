# SPRINT_01B — INGESTIÓN DISTRIBUIDA DE EXPEDIENTES GRANDES

Estado: **BACKLOG FORMAL. No abierto.** No se implementa sin aprobación explícita.

## Por qué existe

El diseño actual es monolítico por documento: se descargan los bytes enteros, se
convierten enteros con una sola llamada a `toMarkdown`, y se suben como UN item a AI
Search. Para uno a cien páginas es adecuado y está medido. Para diez mil no lo es, y
no por lentitud sino por forma:

- **El techo de 4 MB por item es del proveedor.** Ya existe `PARTITION_REQUIRED` como
  estado operativo —un archivo grande no se convierte en `ERROR`—, pero hoy nadie lo
  resuelve: es una señal sin destinatario.
- **Una conversión = una invocación.** Un documento de diez mil páginas no cabe en el
  presupuesto de CPU ni de tiempo de una sola invocación de Worker.
- **La recuperación es de todo o nada.** No hay forma de que el abogado empiece a
  trabajar con la parte del expediente que ya está lista.

## Lo que el sprint tendría que resolver

- **Manifiesto**: un documento grande se describe antes de procesarse (páginas,
  secciones, tamaño), y ese manifiesto es la unidad de progreso.
- **Particionado**: el documento se divide en partes indexables por debajo del techo
  del proveedor, conservando la identidad del documento en la metadata de cada parte.
- **Fan-out acotado**: las partes se procesan en paralelo con un techo, como ya hace
  `INGESTION_CONCURRENCY` con los documentos de un lote.
- **Contrapresión**: un expediente grande no puede monopolizar la cola y dejar sin
  turno al expediente pequeño del abogado de al lado.
- **Recuperación parcial**: que falle la parte 340 no puede obligar a reprocesar las
  339 anteriores.
- **Recuperación progresiva**: el conjunto de evidencia crece por partes confirmadas, y
  el abogado ve avanzar la disponibilidad.
- **Pruebas**: una de cien páginas real, y una sintética grande.

## Qué NO puede romper el trabajo previo

- El conjunto de evidencia se congela al arrancar el análisis (`freezeEvidenceSet`). El
  particionado añade partes a un documento, no documentos al conjunto.
- Las fronteras de aislamiento del RAG (organización + expediente) van en la metadata de
  cada parte, no sólo del documento.
- `PARTITION_REQUIRED` es el punto de entrada previsto: ya se emite, ya no es un error.

---

## Capacidad medida — lote de 19 (IUS-2026-019, 2026-09-04)

Un solo lote real. `SINGLE_BATCH_REAL_MEASUREMENT`: no hay P95 que sacar de aquí, y
cualquier cifra presentada como SLA sería inventada.

Lo que sí quedó medido, del libro de intentos:

| observación | valor |
|---|---|
| documentos por entrega del consumidor | 4 (`max_batch_size`) |
| lotes solapados en el pico | 3 (16:23:30 · 16:23:36 · 16:23:37) |
| documentos abiertos a la vez en el pico | ~11 |
| bytes de PDF abiertos en el pico | >40 MB |
| lotes que sobrevivieron | los que abrieron ≤17 MB sin solaparse con otros dos |
| lotes que murieron | los dos que arrancaron durante el solape |

De ahí sale `INFLIGHT_BUDGET_BYTES = 24 MB` por aislamiento: por encima de esa cifra
hubo muertes, por debajo no las hubo. Es una cota tomada de lo observado, no un número
elegido por bonito, y debería revisarse con más lotes antes de darla por buena.

Lo que este sprint NO resuelve y el 01B debe recoger:

- **La cota es por aislamiento, no global.** Protege de la muerte por memoria, que es
  el fallo observado. No impide que un expediente grande monopolice la cola entera y
  deje sin turno al expediente pequeño del abogado de al lado — eso es contrapresión y
  necesita coordinación entre aislamientos.
- **La disponibilidad sigue siendo por documento entero.** Con particionado, un
  documento estará disponible por partes y `freezeEvidenceSet` tendrá que hablar de
  partes confirmadas, no sólo de documentos.
- **El rescate de lo abandonado es genérico.** Reencola el documento entero. Con
  particionado hará falta reanudar por la parte que falló.
