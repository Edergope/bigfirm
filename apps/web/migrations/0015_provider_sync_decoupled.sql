-- Sincronización con el proveedor, desacoplada de la inteligencia.
--
-- `CC JFRR.pdf` —dos páginas— se detuvo en `ingestion_stage = FINAL_STORAGE`: la
-- sincronización con Drive era prerrequisito SERIAL de la normalización y del índice, y
-- `ensureMatterFolders` encadena ocho llamadas al proveedor sin cota. Último latido a
-- los 387 ms, `drive_file_id` nulo, dos entregas de cola agotadas esperando algo que
-- nunca respondió.
--
-- El original ya está a salvo en el ingreso durable, así que el proveedor no aporta
-- nada a la comprensión del documento: es procedencia y respaldo. Ahora la inteligencia
-- va primero y la sincronización queda como una etapa aparte que puede quedar pendiente
-- sin impedir que el expediente sea analizable.

-- PENDING = falta sincronizar · SYNCED = archivo en el proveedor · DEFERRED = se
-- intentó, falló y se reintentará. NULL en documentos anteriores al desacople.
ALTER TABLE documents ADD COLUMN provider_sync_state TEXT;

-- Por qué se aplazó la última vez. Para soporte; el abogado ve otra cosa.
ALTER TABLE documents ADD COLUMN provider_sync_error TEXT;
