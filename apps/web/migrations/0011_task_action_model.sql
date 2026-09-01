-- Semántica de acción de las tareas y su vínculo con el documento generado.
--
-- La estrategia ya produce tareas reales, pero eran texto con una casilla: redactar el
-- requerimiento que la propia tarea pide era trabajo que el sistema sabe hacer y que el
-- abogado tenía que empezar desde cero en otra pantalla.
--
-- No se crea otra tabla ni otro sistema de tareas: se extiende el contrato existente.
-- Todas las columnas son opcionales, así que las tareas ya creadas siguen siendo
-- válidas y se comportan como OTHER.

-- Qué clase de actuación es. Ver TASK_ACTION_TYPES.
ALTER TABLE tasks ADD COLUMN action_type TEXT;

-- Qué documento hay que producir, sólo para DOCUMENT_DRAFT. Ver DOCUMENT_INTENTS.
ALTER TABLE tasks ADD COLUMN document_intent TEXT;

-- Ejecución del análisis que PROPUSO la tarea. Es la trazabilidad hacia el trabajo del
-- equipo: permite reconstruir con qué hechos y qué estrategia se pidió esta actuación.
ALTER TABLE tasks ADD COLUMN source_execution_id TEXT;

-- Documento generado a partir de esta tarea, si ya se generó.
ALTER TABLE tasks ADD COLUMN generated_document_id TEXT;

-- Ejecución de la generación documental. Distinta de `source_execution_id`: una propuso
-- la tarea, la otra redactó el borrador.
ALTER TABLE tasks ADD COLUMN document_generation_execution_id TEXT;

-- Procedencia inversa en el documento: de qué tarea nació. Permite que la pestaña de
-- documentos muestre el origen sin consultar la tabla de tareas.
ALTER TABLE documents ADD COLUMN origin_task_id TEXT;

-- Las tareas pendientes de un expediente se consultan en cada apertura de la pestaña.
CREATE INDEX IF NOT EXISTS tasks_org_matter_status_idx
  ON tasks (organization_id, matter_id, status);
