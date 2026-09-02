-- Ingreso durable de documentos.
--
-- El incidente de IUS-2026-016: la ruta de carga creaba cuatro carpetas en Drive antes
-- de escribir nada, y sólo insertaba la fila del documento DESPUÉS de que la subida al
-- proveedor terminara. Cualquier cuelgue o aborto del navegador antes de ese punto no
-- dejaba rastro — el ledger de ese expediente tiene `matter.create` y nada más: cero
-- documentos, cero carpetas, ni un solo evento `document.upload`.
--
-- Ahora la fila y los bytes se persisten primero y Drive se sincroniza en segundo
-- plano. Eso obliga a que una versión pueda existir sin archivo en el proveedor todavía.
--
-- SQLite no permite quitar NOT NULL con ALTER, así que se recrea la tabla. El índice
-- único sobre (matter_id, drive_file_id) se conserva: SQLite admite varios NULL en un
-- índice único, que es justo lo que necesitan las versiones aún sin sincronizar.

PRAGMA foreign_keys=OFF;

CREATE TABLE `document_versions_new` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`document_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`drive_file_id` text,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer,
	`checksum` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`change_type` text DEFAULT 'ORIGINAL' NOT NULL,
	`change_summary` text DEFAULT 'Versión inicial' NOT NULL,
	`ingestion_status` text DEFAULT 'FILE_STORED' NOT NULL,
	`is_current` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`matter_id`) REFERENCES `matters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);

INSERT INTO `document_versions_new`
SELECT `id`, `organization_id`, `matter_id`, `document_id`, `version_number`,
       `drive_file_id`, `filename`, `mime_type`, `size_bytes`, `checksum`,
       `created_by`, `created_at`, `change_type`, `change_summary`,
       `ingestion_status`, `is_current`
FROM `document_versions`;

DROP TABLE `document_versions`;
ALTER TABLE `document_versions_new` RENAME TO `document_versions`;

CREATE UNIQUE INDEX `document_versions_number_uq` ON `document_versions` (`document_id`,`version_number`);
CREATE UNIQUE INDEX `document_versions_drive_uq` ON `document_versions` (`matter_id`,`drive_file_id`);
CREATE INDEX `document_versions_org_document_idx` ON `document_versions` (`organization_id`,`document_id`);
CREATE INDEX `document_versions_org_current_idx` ON `document_versions` (`organization_id`,`matter_id`,`is_current`);

PRAGMA foreign_keys=ON;
