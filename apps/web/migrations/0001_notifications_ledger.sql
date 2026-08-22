CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`matter_id` text,
	`execution_id` text,
	`recipient` text NOT NULL,
	`channel` text DEFAULT 'EMAIL' NOT NULL,
	`event` text NOT NULL,
	`subject` text,
	`provider` text NOT NULL,
	`provider_message_id` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`normalized_error` text,
	`correlation_id` text,
	`detail` text,
	`created_at` text NOT NULL,
	`attempted_at` text,
	`sent_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_org_created_idx` ON `notifications` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_matter_idx` ON `notifications` (`matter_id`);