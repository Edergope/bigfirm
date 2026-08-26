ALTER TABLE `documents` ADD `current_version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `documents` ADD `size_bytes` integer;
--> statement-breakpoint
ALTER TABLE `documents` ADD `ingestion_status` text DEFAULT 'FILE_STORED' NOT NULL;
--> statement-breakpoint
CREATE TABLE `document_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`document_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`drive_file_id` text NOT NULL,
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
--> statement-breakpoint
INSERT INTO `document_versions` (`id`,`organization_id`,`matter_id`,`document_id`,`version_number`,`drive_file_id`,`filename`,`mime_type`,`checksum`,`created_by`,`created_at`,`change_type`,`change_summary`,`ingestion_status`,`is_current`)
SELECT 'version_' || substr(`id`, 10), `organization_id`, `matter_id`, `id`, 1, `drive_file_id`, `name`, `mime_type`, `content_hash`, `linked_by`, `created_at`, 'ORIGINAL', 'Versión inicial', CASE WHEN `indexed_at` IS NOT NULL THEN 'AI_INDEXED' ELSE 'FILE_STORED' END, true
FROM `documents` WHERE `drive_file_id` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `document_versions_number_uq` ON `document_versions` (`document_id`,`version_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_versions_drive_uq` ON `document_versions` (`matter_id`,`drive_file_id`);
--> statement-breakpoint
CREATE INDEX `document_versions_org_document_idx` ON `document_versions` (`organization_id`,`document_id`);
--> statement-breakpoint
CREATE INDEX `document_versions_org_current_idx` ON `document_versions` (`organization_id`,`matter_id`,`is_current`);
--> statement-breakpoint
ALTER TABLE `templates` ADD `original_source_ref` text;
--> statement-breakpoint
ALTER TABLE `templates` ADD `family_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `templates` ADD `category` text DEFAULT 'General' NOT NULL;
--> statement-breakpoint
ALTER TABLE `templates` ADD `description` text;
--> statement-breakpoint
ALTER TABLE `templates` ADD `mime_type` text DEFAULT 'application/vnd.google-apps.document' NOT NULL;
--> statement-breakpoint
ALTER TABLE `templates` ADD `checksum` text;
--> statement-breakpoint
ALTER TABLE `templates` ADD `original_filename` text;
--> statement-breakpoint
ALTER TABLE `templates` ADD `created_by` text REFERENCES `user`(`id`);
--> statement-breakpoint
UPDATE `templates` SET `family_id` = `id` WHERE `family_id` = '';
--> statement-breakpoint
CREATE INDEX `templates_family_version_idx` ON `templates` (`family_id`,`version`);
