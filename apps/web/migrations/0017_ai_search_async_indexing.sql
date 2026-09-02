-- Indexación asíncrona en AI Search e historial de intentos de ingestión.
--
-- MEDIDO en el lote de cinco de IUS-2026-016: el índice tardó 77-112 s y fue el
-- 98,8 %-99,4 % del tiempo total. Bloquear al consumidor esperándolo era el último cuello
-- artificial: la documentación oficial confirma que `items.upload()` encola y retorna, y
-- que `items.get(id).info()` devuelve `status` y `chunks_count`. Ya no hay razón para
-- esperar dentro del trabajo de ingestión.

-- Identidad EXACTA del item en el índice. Sin ella, confirmar significaba buscar a
-- ciegas dentro del expediente y esperar que apareciera el documento.
ALTER TABLE documents ADD COLUMN ai_search_item_id TEXT;
ALTER TABLE documents ADD COLUMN ai_search_item_key TEXT;
ALTER TABLE documents ADD COLUMN ai_search_uploaded_at TEXT;

-- Confirmación de indexación: contador propio y cuándo toca volver a preguntar.
ALTER TABLE documents ADD COLUMN index_confirm_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN index_confirm_next_at TEXT;

-- La barrida busca confirmaciones vencidas; sin índice recorrería la tabla entera.
CREATE INDEX IF NOT EXISTS documents_index_confirm_idx
  ON documents (ingestion_status, index_confirm_next_at);

-- HISTORIAL DE INTENTOS.
--
-- `markIngestionStarted` pone `ingestion_failure_code` a NULL en cada intento, así que
-- el segundo intento de `Cedula extrangeria Maria.pdf` destruyó la causa exacta del
-- primero: sé que fue un vencimiento por el margen de 7,9 s, pero no tengo el código.
-- La fila del documento conserva el estado ACTUAL para la pantalla; el forense necesita
-- lo que pasó antes, y eso no cabe en una sola fila.
CREATE TABLE IF NOT EXISTS document_ingestion_attempts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  matter_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  cf_queue_message_id TEXT,
  cf_queue_attempt INTEGER,
  reason TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  final_state TEXT,
  stage TEXT,
  failure_code TEXT,
  failure_message TEXT,
  timings TEXT
);

CREATE INDEX IF NOT EXISTS ingestion_attempts_doc_idx
  ON document_ingestion_attempts (document_id, started_at);
CREATE INDEX IF NOT EXISTS ingestion_attempts_org_idx
  ON document_ingestion_attempts (organization_id, matter_id);
