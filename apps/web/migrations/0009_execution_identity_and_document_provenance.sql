-- Identidad lógica del despacho: un reintento TÉCNICO del Workflow debe reutilizar la
-- misma ejecución jurídica (y con ella la misma clave de idempotencia de créditos).
ALTER TABLE `executions` ADD `dispatch_key` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `executions_dispatch_key_uq` ON `executions` (`dispatch_key`);
--> statement-breakpoint
-- Provenance del entregable EN EL DOCUMENTO, no sólo en el detalle de auditoría.
ALTER TABLE `documents` ADD `content_source` text;
--> statement-breakpoint
ALTER TABLE `documents` ADD `generated_from_template_id` text;
--> statement-breakpoint
ALTER TABLE `documents` ADD `generated_from_template_version` integer;
--> statement-breakpoint
ALTER TABLE `documents` ADD `generated_by_execution_id` text;
--> statement-breakpoint
ALTER TABLE `documents` ADD `generated_by_agent_id` text;
--> statement-breakpoint
ALTER TABLE `documents` ADD `generated_prompt_sha256` text;
--> statement-breakpoint
ALTER TABLE `documents` ADD `generated_model` text;
