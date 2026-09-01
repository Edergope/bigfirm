-- Instrumentación de la ingestión documental e identidad de lote.
--
-- Hasta ahora la única evidencia de cuánto tarda un documento era `indexed_at`, que
-- sólo dice cuándo terminó: no se podía saber si los segundos se iban en la descarga,
-- en la conversión a Markdown o en el índice, ni distinguir la espera en cola del
-- trabajo real. Sin eso, «optimizar la ingestión» es adivinar.
--
-- Los tiempos viven en la propia fila del documento: se consultan con él, no exigen
-- una tabla nueva y desaparecen cuando el documento desaparece. Ninguno se muestra al
-- abogado — son de operación.

-- Momento en que el mensaje entró a la cola. Con `ingestion_started_at` da la espera.
ALTER TABLE documents ADD COLUMN ingestion_enqueued_at TEXT;

-- Momento en que un consumidor tomó el documento. Marca el fin de la espera en cola.
ALTER TABLE documents ADD COLUMN ingestion_started_at TEXT;

-- Duraciones por etapa, en milisegundos, como JSON:
-- { "download_ms", "normalize_ms", "r2_ms", "ai_search_ms", "finalize_ms", "total_ms" }
-- JSON y no columnas sueltas porque son telemetría: se leen juntas o no se leen.
ALTER TABLE documents ADD COLUMN ingestion_timings TEXT;

-- Cuántas veces se ha intentado ingerir. Distingue un fallo aislado de uno persistente
-- y permite que el reintento manual no se confunda con un reintento de la cola.
ALTER TABLE documents ADD COLUMN ingestion_attempts INTEGER NOT NULL DEFAULT 0;

-- Lote de carga al que pertenece el documento.
--
-- NO es una transacción: un lote no se confirma ni se revierte en bloque, y el fallo de
-- un archivo no toca a los demás. Sólo sirve para correlacionar: qué archivos entraron
-- juntos, cuánto tardó el conjunto y cuántos van preparados.
ALTER TABLE documents ADD COLUMN upload_batch_id TEXT;

-- El progreso agregado del lote se consulta en cada refresco mientras hay carga activa.
CREATE INDEX IF NOT EXISTS documents_batch_idx ON documents (organization_id, upload_batch_id);
