-- Legacy device-only ledgers have no trustworthy target ownership; preserve them without copying progress.
CREATE TABLE IF NOT EXISTS sync_target_cursor (
  scope TEXT NOT NULL,
  device_id TEXT NOT NULL,
  last_op_id INTEGER NOT NULL DEFAULT 0,
  last_seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, device_id)
);
CREATE TABLE IF NOT EXISTS sync_target_outbox (
  scope TEXT NOT NULL,
  device_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  max_op_id INTEGER NOT NULL,
  body BLOB NOT NULL,
  PRIMARY KEY (scope, device_id)
);
UPDATE settings SET value = '16', updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'schema.version';
