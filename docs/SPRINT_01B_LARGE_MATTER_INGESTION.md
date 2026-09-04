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
