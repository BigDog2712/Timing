-- =============================================================================
-- Timing 业务库迁移 0010（0.12.2 · 同步簿记）—— **一次性段**
--
-- 由 `infra/migrate.rs::migrate()` 在 `schema_version(pool) < 10` 时执行一次。
--
-- 这个文件里**只有版本推进**。索引、触发器、墓碑表、回填全在
-- `0010_v0141_sync_bookkeeping_guard.sql`（每次启动无条件执行，逐条幂等）。
--
-- 为什么版本推进必须单独一次性：`UPDATE settings SET value='10'` 本身幂等，但它
-- **会把更高的版本号改写回 10**。留在这里 + 版本门 = 只写一次。
-- =============================================================================

UPDATE settings SET value = '10', updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'schema.version';
