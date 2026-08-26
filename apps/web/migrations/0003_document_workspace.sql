CREATE TABLE `drive_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`kind` text NOT NULL,
	`scope_id` text DEFAULT '' NOT NULL,
	`drive_folder_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drive_folders_uq` ON `drive_folders` (`organization_id`,`kind`,`scope_id`);--> statement-breakpoint
CREATE INDEX `drive_folders_org_idx` ON `drive_folders` (`organization_id`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text DEFAULT 'SYSTEM' NOT NULL,
	`organization_id` text,
	`name` text NOT NULL,
	`document_type` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`engine` text DEFAULT 'GOOGLE_DOCS' NOT NULL,
	`source_ref` text,
	`variables` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `templates_scope_type_idx` ON `templates` (`scope`,`document_type`);--> statement-breakpoint
CREATE INDEX `templates_org_idx` ON `templates` (`organization_id`);