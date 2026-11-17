-- Timing schema v15: durable immutable upload batch for sync_stream.
-- This table is intentionally separate from timer business state and events.
CREATE TABLE IF NOT EXISTS sync_event_outbox (
  device_id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  max_op_id INTEGER NOT NULL,
  body BLOB NOT NULL
);
UPDATE settings SET value = '15', updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'schema.version';
