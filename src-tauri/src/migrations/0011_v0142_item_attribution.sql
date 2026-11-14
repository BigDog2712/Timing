-- =============================================================================
-- Timing 业务库迁移 0011（0.13.x · 事项归属）—— **一次性段**
--
-- 由 `infra/migrate.rs::migrate()` 在 `schema_version(pool) < 11` 时执行一次。
--
-- 这个文件里**只有版本推进**。三段实活都在别处：
--   · 加列（`items.parent_id` / `depth` / `category_key` / `device_id` / `uid` /
--     `updated_at_ms`）→ `MIGRATE_COLUMNS_V11` 的 `ensure_column`（K-13：SQLite 没有
--     `ADD COLUMN IF NOT EXISTS`，裸 ALTER 跑第二次必然报错）；
--   · 墓碑类别放宽 → `migrate::widen_tombstone_kinds`（要读 `sqlite_master` 判断
--     当前结构，纯 SQL 做不到条件重建；函数本身幂等，每次启动跑）；
--   · 索引 / 触发器 / 新表 → `0011_v0142_item_attribution_guard.sql`（每次启动）。
--
-- 为什么版本推进必须单独一次性：`UPDATE settings SET value='11'` 本身幂等，但它
-- **会把更高的版本号改写回 11**。留在这里 + 版本门 = 只写一次。
-- =============================================================================

UPDATE settings SET value = '11', updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'schema.version';
