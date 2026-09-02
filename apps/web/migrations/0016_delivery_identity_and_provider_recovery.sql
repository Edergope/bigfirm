-- Identidad de entrega y recuperación real de la sincronización con el proveedor.
--
-- DOS DEFECTOS QUE ESTA MIGRACIÓN ACOMPAÑA:
--
-- 1. `ingestion_attempts` se incrementaba DOS VECES por entrega: había dos llamadas a
--    `markIngestionStarted` en el mismo `ingest()`. Por eso `attempts = 2` en
--    CC JFRR.pdf NO probaba dos entregas de Cloudflare — probaba UNA. La identidad real
--    del mensaje nunca se guardaba, así que la única forma de saberlo era leer el
--    código. Ahora se persiste lo que Cloudflare mismo dice.
--
-- 2. `provider_sync_state = DEFERRED` no lo leía NADIE. No había cron, ni handler
--    scheduled, ni mensaje de cola, ni reconciliación: un documento con Drive aplazado
--    se quedaba así para siempre y sus bytes originales nunca se limpiaban del ingreso.
--    El comentario del código afirmaba «se reintenta sola». No era cierto.

-- Identidad que asigna Cloudflare al mensaje, y su número de entrega. Permiten decir
-- «esto fue la entrega N del mensaje X» sin inferir nada del contador lógico.
ALTER TABLE documents ADD COLUMN cf_queue_message_id TEXT;
ALTER TABLE documents ADD COLUMN cf_queue_attempt INTEGER;

-- Intentos de sincronización con el proveedor. Contador PROPIO: una caída de Drive no
-- puede consumir los reintentos del trabajo de inteligencia, que es otra cosa.
ALTER TABLE documents ADD COLUMN provider_sync_attempts INTEGER NOT NULL DEFAULT 0;

-- Cuándo volver a intentarlo. Es lo que hace posible el backoff y lo que la barrida de
-- reconciliación consulta para no reencolar lo que aún está esperando su turno.
ALTER TABLE documents ADD COLUMN provider_sync_next_at TEXT;

-- La barrida busca documentos pendientes por antigüedad; sin índice recorrería la tabla.
CREATE INDEX IF NOT EXISTS documents_provider_sync_idx
  ON documents (provider_sync_state, provider_sync_next_at);
