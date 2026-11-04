-- =============================================================================
-- Timing 数据库迁移 0003（V0.3.0）
-- -----------------------------------------------------------------------------
-- 变更：notes 增加 is_pinned（便利贴置顶持久化，AC-64 / ADR-019）
-- 版本：schema.version = 3
--
-- 【为什么加列不写在本文件里】
--   SQLite 不支持 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`，重复执行会报
--   `duplicate column name`（K-13）。故加列由 `infra::migrate::ensure_column`
--   以 `PRAGMA table_info` 守卫执行，本文件只做「其余幂等语句 + 版本推进」。
--
-- 【列定义（在 migrate.rs 的 MIGRATE_COLUMNS_V3 中）】
--   notes.is_pinned INTEGER NOT NULL DEFAULT 1
--   默认 1 = 置顶：与 V0.2.x 一致（当时窗口硬编码 always_on_top=true），
--   老便利贴升级后外观与行为都不变，用户主动取消置顶才落 0。
-- =============================================================================

-- 历史笔记补默认值（加列时已有 DEFAULT，这里只兜底 ALTER 无法回填的极端情况）
UPDATE notes SET is_pinned = 1 WHERE is_pinned IS NULL;

-- -----------------------------------------------------------------------------
-- 版本推进：schema.version = 3
-- -----------------------------------------------------------------------------
UPDATE settings SET value = '3', updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'schema.version';
