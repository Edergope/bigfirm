-- Particiones de documentos grandes.
--
-- El techo de 4 MB por item es del proveedor de índice, no nuestro. Un expediente de
-- cien páginas convertido a Markdown lo supera, y hasta ahora eso terminaba en
-- `PARTITION_REQUIRED`: un código de fallo correcto sin destinatario. El documento
-- quedaba fuera del análisis y nadie podía hacer nada.
--
-- Una fila por parte. No cabía en `documents` porque es una relación uno a muchos, y
-- ésa es la única razón por la que existe esta tabla.

CREATE TABLE IF NOT EXISTS document_partitions (
  id TEXT PRIMARY KEY,
  -- Las cuatro claves de aislamiento se repiten aquí a propósito: cada trabajo de
  -- partición las revalida contra D1 en vez de confiar en lo que traiga el mensaje.
  organization_id TEXT NOT NULL,
  matter_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document_version INTEGER NOT NULL,
  -- Posición en el documento, desde 1. Ordena y da procedencia.
  ordinal INTEGER NOT NULL,
  source_key TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING',
  ai_search_item_id TEXT,
  index_confirm_attempts INTEGER NOT NULL DEFAULT 0,
  index_confirm_next_at TEXT,
  failure_code TEXT,
  failure_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- IDEMPOTENCIA, en la base y no en el código.
--
-- Con entrega «al menos una vez» el mismo mensaje puede llegar dos veces. Sin esta
-- restricción, la segunda vez crearía una fila nueva, subiría un item nuevo y contaría
-- dos veces la misma parte como lista. La unicidad la garantiza el motor, que es el
-- único sitio donde una garantía así no depende de que nadie se equivoque.
CREATE UNIQUE INDEX IF NOT EXISTS document_partitions_identity
  ON document_partitions (document_id, document_version, ordinal);

CREATE INDEX IF NOT EXISTS document_partitions_document
  ON document_partitions (organization_id, document_id, state);

-- Recuento del documento. Vive en `documents` porque es lo que la pantalla lee para
-- decir «disponible en un 40 %» sin recorrer las particiones una por una.
ALTER TABLE documents ADD COLUMN partition_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN partitions_ready INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN partitions_failed INTEGER NOT NULL DEFAULT 0;
