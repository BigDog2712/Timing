-- =============================================================================
-- Timing 业务库迁移 0012（0.12.5 · 应用使用的具体时段）—— **一次性段**
--
-- 由 `infra/migrate.rs::migrate()` 在 `schema_version(pool) < 12` 时执行一次。
--
-- 建表在 `0012_v01250_usage_span_guard.sql`（每次启动、`IF NOT EXISTS`）；
-- 本文件**只有版本推进**。
--
-- 为什么版本推进必须单独一次性：`UPDATE settings SET value='12'` 本身幂等，但它
-- **会把更高的版本号改写回 12**。留在这里 + 版本门 = 只写一次。
-- =============================================================================

UPDATE settings SET value = '12', updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'schema.version';
