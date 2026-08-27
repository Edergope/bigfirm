-- Un checksum identifica un binario, no una familia editorial. Dos familias pueden
-- preservar el mismo original; la invariancia correcta es una versión ACTIVE por familia.
DROP INDEX IF EXISTS `templates_active_checksum_unique_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `templates_one_active_per_family_idx`
  ON `templates` (`family_id`)
  WHERE `status` = 'ACTIVE';
