ALTER TABLE `documents` ADD `retired_at` text;
--> statement-breakpoint
ALTER TABLE `documents` ADD `retired_by` text REFERENCES `user`(`id`);
--> statement-breakpoint
ALTER TABLE `documents` ADD `retired_reason` text;
--> statement-breakpoint
CREATE INDEX `documents_org_matter_retired_idx` ON `documents` (`organization_id`,`matter_id`,`retired_at`);
