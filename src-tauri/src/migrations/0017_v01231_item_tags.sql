-- =============================================================================
-- Timing 业务库迁移 0017（0.12.3+ · 事项多标签）
--
-- 变更：items 增加 `tags` 列（JSON 数组，存**分类/标签键**，不是显示名）。
--
-- 为什么是单列 JSON 而不是 `item_tags` 关联表：
--   · 事项本来就会随 `items` 行进全额数据包（`BUSINESS_TABLES` 的 items 用动态列合并），
--     加列即跨设备可用；再加一张关联表就要同时改包契约、合并顺序与引用改写；
--   · 标签集合只按事项整体读写（没有「按标签查全部事项」的热路径），关联表的索引收益
--     换不来那套同步成本；
--   · 事项名本身是**隐式的同名标签**，不落库 —— 改名即改名，不存在第二份要跟着改的副本。
--
-- 为什么还要一个触发器：`trg_items_touch_update` 的 OF 列表是逐列枚举的，旧库里它不会
-- 因为这里多了一列就自动跟上。没有这条触发器，改标签不会推进 `updated_at_ms`，
-- 跨设备合并会把同一事项的新旧标签判成同一版本。
--
-- 加列**不在本文件**：`ALTER TABLE ... ADD COLUMN` 不幂等，而 runner 每次启动都会跑
-- 全部迁移（K-13）。列由 `MIGRATE_COLUMNS_V17` 的 `ensure_column` 补，这里只留幂等的
-- 触发器与版本推进（后者由 Rust 侧的 `< 17` 版本门只放行一次）。
-- =============================================================================

CREATE TRIGGER IF NOT EXISTS trg_items_touch_tags
AFTER UPDATE OF tags ON items
BEGIN
  UPDATE items
     SET updated_at_ms = MAX(CAST(strftime('%s','now') AS INTEGER) * 1000,
                              COALESCE(OLD.updated_at_ms, 0) + 1)
   WHERE id = NEW.id;
END;

UPDATE settings SET value = '17', updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'schema.version';