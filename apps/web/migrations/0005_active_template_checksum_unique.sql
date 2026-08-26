CREATE UNIQUE INDEX IF NOT EXISTS templates_active_checksum_unique_idx
  ON templates(checksum)
  WHERE checksum IS NOT NULL AND status = 'ACTIVE';
