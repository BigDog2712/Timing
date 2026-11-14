-- =============================================================================
-- Timing 业务库迁移 0009（0.12.2 · 设备维度）—— **一次性段**
--
-- 由 `infra/migrate.rs::migrate()` 在 `schema_version(pool) < 9` 时执行一次。
--
-- 这个文件里**只有版本推进**。加列、建索引、建触发器全部在别处：
--   · 加列（device_id / uid / merged_into_uid）→ `MIGRATE_COLUMNS_V9` 的 ensure_column
--     （SQLite 没有 `ADD COLUMN IF NOT EXISTS`，裸 ALTER 跑第二次必然报错，K-13）；
--   · 索引与触发器的抵消段 → `0009_v0140_device_dimension_guard.sql`（**每次启动**）。
--
-- 为什么版本推进必须单独一次性：`UPDATE settings SET value='9'` 本身幂等，但它
-- **会把更高的版本号改写回 9**。留在这里 + 版本门 = 只写一次。
-- =============================================================================

UPDATE settings SET value = '9', updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'schema.version';
