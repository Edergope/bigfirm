-- Sprint 7.8 — SYSTEM_SUPERADMIN.
-- Autoridad global de plataforma, separada de los roles de firma (organization).
-- Una sola columna: Better Auth la gobierna como additionalField con input:false,
-- de modo que ningún cliente ni perfil OAuth puede asignarla. NULL = sin autoridad.
ALTER TABLE user ADD COLUMN system_role TEXT;
