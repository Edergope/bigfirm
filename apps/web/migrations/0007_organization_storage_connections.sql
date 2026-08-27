CREATE TABLE `organization_storage_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text DEFAULT 'GOOGLE_DRIVE' NOT NULL,
	`account_id` text NOT NULL,
	`storage_owner_user_id` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`storage_owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_storage_connection_uq` ON `organization_storage_connections` (`organization_id`,`provider`);
--> statement-breakpoint
CREATE TABLE `platform_storage_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'GOOGLE_DRIVE' NOT NULL,
	`account_id` text NOT NULL,
	`storage_owner_user_id` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`storage_owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_storage_provider_uq` ON `platform_storage_connections` (`provider`);
