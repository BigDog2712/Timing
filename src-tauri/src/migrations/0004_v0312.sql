-- =============================================================================
-- TickBar 数据库迁移 0004（V0.3.12）
-- -----------------------------------------------------------------------------
-- 变更：todos 增加提醒链路的两个状态列
--   1. remind_stage  0 = 未提醒 / 1 = 轻提醒已弹 / 2 = 五分钟询问已弹（ADR-030）
--   2. auto_start    1 = 用户答应「当前事项结束后自动开始」
-- 版本：schema.version = 4
--
-- 【为什么加列不写在本文件里】
--   SQLite 不支持 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`，重复执行会报
--   `duplicate column name`（K-13）。加列由 `infra::migrate::ensure_column`
--   以 `PRAGMA table_info` 守卫执行（见 MIGRATE_COLUMNS_V4），本文件只做
--   「其余幂等语句 + 版本推进」。
--
-- 【为什么不复用 reminded_at】
--   `reminded_at` 是「到点提醒已触发」的单次标记，只够去重一次；待办现在有
--   **两级**提醒（T-15 轻提醒 / T-5 自动开始询问），需要单调递进的阶段值。
--   两个标记并存：`reminded_at` 仍由 `reminder_set/clear` 维护，供通用提醒列表使用。
-- =============================================================================

-- 老数据兜底（加列时已有 DEFAULT，这里只处理 ALTER 无法回填的极端情况）
UPDATE todos SET remind_stage = 0 WHERE remind_stage IS NULL;
UPDATE todos SET auto_start = 0 WHERE auto_start IS NULL;

-- -----------------------------------------------------------------------------
-- 版本推进：schema.version = 4
-- -----------------------------------------------------------------------------
UPDATE settings SET value = '4', updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'schema.version';
