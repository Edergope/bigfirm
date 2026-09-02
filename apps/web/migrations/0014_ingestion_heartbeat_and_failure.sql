-- Latido de progreso y etapa de fallo de la ingestión.
--
-- Los cinco documentos de IUS-2026-016 quedaron en «Procesamiento detenido» sin que el
-- sistema supiera nada: `ingestion_attempts = 0`, `ingestion_started_at = NULL`,
-- `ingestion_timings = NULL`. La UI declaró muertos cinco trabajos basándose ÚNICAMENTE
-- en la antigüedad de `updated_at`, sin un solo dato sobre su estado real.
--
-- Dos carencias, dos columnas:
--
-- 1. No había forma de distinguir «trabajando normalmente» de «abandonado». Un latido
--    por etapa lo resuelve sin infraestructura nueva: si una etapa termina, se sella la
--    hora. Un trabajo vivo se delata solo; uno que nunca empezó, también.
--
-- 2. Cuando algo fallaba, la fila no conservaba DÓNDE. El mensaje quedaba en la cola o
--    en la DLQ y el documento se quedaba congelado en PROCESSING para siempre.

-- Última señal de vida del trabajo de ingestión. Se sella al terminar cada etapa.
ALTER TABLE documents ADD COLUMN ingestion_heartbeat_at TEXT;

-- Etapa en curso o en la que se detuvo: INGRESS | FINAL_STORAGE | DOWNLOAD |
-- NORMALIZATION | AI_SEARCH | FINALIZATION | UNKNOWN.
ALTER TABLE documents ADD COLUMN ingestion_stage TEXT;

-- Clasificación del fallo, para soporte y auditoría. NUNCA se muestra al abogado.
ALTER TABLE documents ADD COLUMN ingestion_failure_code TEXT;
ALTER TABLE documents ADD COLUMN ingestion_failure_message TEXT;
