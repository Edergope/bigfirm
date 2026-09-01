-- Identidad server-owned de una convocatoria: una acción humana de "crear expediente
-- y convocar" es UNA operación lógica durable, por muchas veces que el navegador la
-- reintente. Sin esta clave, un doble clic o un reintento de red creaba un expediente
-- nuevo cada vez (incidente IUS-2026-011/012/013).
ALTER TABLE `matters` ADD `creation_request_key` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `matters_creation_request_key_uq` ON `matters` (`creation_request_key`);
