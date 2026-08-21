CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`issuer` text,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`team_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`inviter_id` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invitation_organizationId_idx` ON `invitation` (`organization_id`);--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `member_organizationId_idx` ON `member` (`organization_id`);--> statement-breakpoint
CREATE INDEX `member_userId_idx` ON `member` (`user_id`);--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`created_at` integer NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_uidx` ON `organization` (`slug`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`active_organization_id` text,
	`active_team_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `team` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`member_count` integer DEFAULT 0 NOT NULL,
	`organization_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `team_organizationId_idx` ON `team` (`organization_id`);--> statement-breakpoint
CREATE TABLE `team_member` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	`membership_key` text,
	`created_at` integer,
	FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_member_membership_key_unique` ON `team_member` (`membership_key`);--> statement-breakpoint
CREATE INDEX `teamMember_teamId_idx` ON `team_member` (`team_id`);--> statement-breakpoint
CREATE INDEX `teamMember_userId_idx` ON `team_member` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `agent_definitions` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`domain` text NOT NULL,
	`prompt_ref` text NOT NULL,
	`prompt_version` text NOT NULL,
	`prompt_sha256` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`model_policy` text NOT NULL,
	`tools_policy` text NOT NULL,
	`output_type` text NOT NULL,
	`output_schema_id` text NOT NULL,
	`parallelizable` integer DEFAULT true NOT NULL,
	`timeout_ms` integer DEFAULT 120000 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_definitions_enabled_idx` ON `agent_definitions` (`enabled`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`matter_id` text,
	`actor_user_id` text,
	`actor_execution_id` text,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`outcome` text NOT NULL,
	`reason` text,
	`detail` text,
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_events_org_occurred_idx` ON `audit_events` (`organization_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_events_matter_idx` ON `audit_events` (`matter_id`);--> statement-breakpoint
CREATE TABLE `authorities` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`authority_key` text NOT NULL,
	`citation` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'REQUIRES_CALIBRATION' NOT NULL,
	`rule_summary` text NOT NULL,
	`verified_at` text,
	`established_by_execution_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`matter_id`) REFERENCES `matters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `authorities_matter_key_uq` ON `authorities` (`matter_id`,`authority_key`);--> statement-breakpoint
CREATE INDEX `authorities_org_matter_idx` ON `authorities` (`organization_id`,`matter_id`);--> statement-breakpoint
CREATE TABLE `credit_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`matter_id` text,
	`execution_id` text,
	`user_id` text,
	`provider` text,
	`model` text,
	`provider_cost_usd` real,
	`idempotency_key` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_transactions_idempotency_uq` ON `credit_transactions` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `credit_transactions_org_idx` ON `credit_transactions` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `credit_wallets` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`source` text DEFAULT 'DRIVE' NOT NULL,
	`drive_file_id` text,
	`name` text NOT NULL,
	`mime_type` text NOT NULL,
	`classification` text DEFAULT 'FUENTE' NOT NULL,
	`status` text DEFAULT 'PENDIENTE' NOT NULL,
	`content_hash` text,
	`r2_mirror_key` text,
	`indexed_at` text,
	`linked_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`matter_id`) REFERENCES `matters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`linked_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `documents_org_matter_idx` ON `documents` (`organization_id`,`matter_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `documents_matter_drive_uq` ON `documents` (`matter_id`,`drive_file_id`);--> statement-breakpoint
CREATE TABLE `execution_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`root_execution_id` text NOT NULL,
	`execution_id` text NOT NULL,
	`type` text NOT NULL,
	`from_agent_id` text,
	`to_agent_id` text,
	`status` text,
	`detail` text NOT NULL,
	`sequence` integer NOT NULL,
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `execution_events_root_seq_uq` ON `execution_events` (`root_execution_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `execution_events_execution_idx` ON `execution_events` (`execution_id`);--> statement-breakpoint
CREATE TABLE `executions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`parent_execution_id` text,
	`root_execution_id` text NOT NULL,
	`workflow_instance_id` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`provider` text,
	`model` text,
	`prompt_version` text,
	`prompt_sha256` text,
	`work_package_ref` text,
	`output_ref` text,
	`output_type` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cached_input_tokens` integer,
	`provider_cost_usd` real,
	`credits_consumed` integer,
	`error_code` text,
	`error_message` text,
	`retries` integer DEFAULT 0 NOT NULL,
	`started_by` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`matter_id`) REFERENCES `matters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`started_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `executions_org_matter_idx` ON `executions` (`organization_id`,`matter_id`);--> statement-breakpoint
CREATE INDEX `executions_root_idx` ON `executions` (`root_execution_id`);--> statement-breakpoint
CREATE INDEX `executions_parent_idx` ON `executions` (`parent_execution_id`);--> statement-breakpoint
CREATE TABLE `facts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`fact_key` text NOT NULL,
	`statement` text NOT NULL,
	`certainty` text NOT NULL,
	`source_class` text NOT NULL,
	`primary_source` text NOT NULL,
	`numbers` text,
	`established_by_execution_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`matter_id`) REFERENCES `matters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `facts_matter_key_uq` ON `facts` (`matter_id`,`fact_key`);--> statement-breakpoint
CREATE INDEX `facts_org_matter_idx` ON `facts` (`organization_id`,`matter_id`);--> statement-breakpoint
CREATE TABLE `matter_members` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`delegated_by_user_id` text,
	`granted_by` text NOT NULL,
	`granted_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`matter_id`) REFERENCES `matters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`delegated_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`granted_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matter_members_matter_user_uq` ON `matter_members` (`matter_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `matter_members_org_user_idx` ON `matter_members` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `matters` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`reference` text NOT NULL,
	`title` text NOT NULL,
	`client_name` text NOT NULL,
	`status` text DEFAULT 'INTAKE' NOT NULL,
	`materiality` text DEFAULT 'SIMPLE' NOT NULL,
	`practice_areas` text NOT NULL,
	`jurisdiction` text NOT NULL,
	`parties` text NOT NULL,
	`objective` text,
	`risk_level` text DEFAULT 'UNASSESSED' NOT NULL,
	`risk_rationale` text,
	`opened_at` text NOT NULL,
	`closed_at` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matters_org_reference_uq` ON `matters` (`organization_id`,`reference`);--> statement-breakpoint
CREATE INDEX `matters_org_status_idx` ON `matters` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `matters_org_updated_idx` ON `matters` (`organization_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`matter_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`kind` text DEFAULT 'TASK' NOT NULL,
	`status` text DEFAULT 'PENDIENTE' NOT NULL,
	`due_at` text,
	`deadline_rule` text,
	`deadline_source` text,
	`assigned_to` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`matter_id`) REFERENCES `matters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_to`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tasks_org_matter_idx` ON `tasks` (`organization_id`,`matter_id`);--> statement-breakpoint
CREATE INDEX `tasks_org_due_idx` ON `tasks` (`organization_id`,`due_at`);