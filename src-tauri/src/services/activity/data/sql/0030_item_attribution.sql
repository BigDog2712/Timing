-- =============================================================================
-- Patina 活动库迁移 30（0.13.x · 事项归属）
-- -----------------------------------------------------------------------------
-- 三张表，都只服务「应用活动如何归属到事项」这一件事：
--   app_category            应用 ↔ 分类（多对多，带首位）
--   block_segment_override  子记录的手工改判（例外手段）
--   focus_blocks            事项计时块的投影（真源在业务库 time_records）
--
-- 【为什么分类表在活动库而不是业务库】
--   分类的读写入口（`classification_settings` / `resolve_session_category`）本来就
--   全在活动库这套 pool 里；子记录切片也在活动库侧做。搬到业务库 = 每次解析都要
--   跨库取一次配置，而两个 pool 不能 JOIN。事项的 `category_key` 会随块投影过来
--   （`focus_blocks.category_key` 是快照），所以活动库侧解析**不需要**读业务库。
--
-- 【迁移语义】
--   本文件由 sqlx `Migrator` 只执行一次（`_sqlx_migrations` 账本），所以
--   `CREATE TABLE IF NOT EXISTS` 的幂等只是防御，不是运行前提。
--   ⚠️ 不要往 `schema_revision_limit()` 里加 30 的探测项：加了会让老库被整表
--   标成「30 已应用」而 DDL 从未执行，开机即 schema validation failed。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 应用 ↔ 分类（多对多）
-- 一个应用可有多条：chrome 既有「学习」也有「娱乐」「游戏」「工作」。
-- `priority` 最小者 = 「分类首位」：事项分类不在应用的分类集里时用它兜底，
-- 这正是 bilibili 在学习事项下显示「摸鱼」的全部机制（没有第二套规则）。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_category (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  app_key       TEXT    NOT NULL,             -- 归一 exe / 包名，与 sessions.app_key 同源
  category_key  TEXT    NOT NULL,
  priority      INTEGER NOT NULL DEFAULT 100, -- 越小越靠前
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  device_id     TEXT    NOT NULL DEFAULT '',
  uid           TEXT,                         -- c:<device>:<id>
  updated_at_ms INTEGER NOT NULL DEFAULT 0,
  UNIQUE (app_key, category_key)
);

CREATE INDEX IF NOT EXISTS idx_app_category_order
  ON app_category(app_key, priority);
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_category_uid
  ON app_category(uid) WHERE uid IS NOT NULL;

-- uid 由库自己发（写入口有设置页 / 导入 / 恢复三处，靠调用点记得拼必然漏）。
-- `TRIM(NEW.device_id) <> ''` 是哨兵守卫：迁移期 device_id 还是 '' 时不生成
-- 半截身份（`c::chrome:game`），而 uid 一旦落库就不再重算。
CREATE TRIGGER IF NOT EXISTS trg_app_category_uid AFTER INSERT ON app_category
WHEN NEW.uid IS NULL AND TRIM(NEW.device_id) <> ''
BEGIN
  UPDATE app_category SET uid = 'c:' || NEW.device_id || ':' || NEW.id
   WHERE id = NEW.id;
END;

-- -----------------------------------------------------------------------------
-- 子记录的手工改判（**例外手段，不是规则**）
-- 规则只有 3 条（见 attribution::category）。用户想「这一段其实不是学习」时落这里，
-- 不改事实（sessions）也不改块（focus_blocks）——两者都是别处的真源。
-- `block_uid` 指向 focus_blocks.uid，同一库，但不建 FK：投影重推会 DELETE+INSERT，
-- 带 ON DELETE CASCADE 会把用户的改判一起删掉。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS block_segment_override (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  block_uid    TEXT    NOT NULL,
  app_key      TEXT    NOT NULL,
  seg_start    INTEGER NOT NULL,
  seg_end      INTEGER NOT NULL,
  category_key TEXT,                              -- 改判后的分类；NULL = 仅排除
  excluded     INTEGER NOT NULL DEFAULT 0 CHECK (excluded IN (0,1)),
  note         TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  device_id    TEXT    NOT NULL DEFAULT '',
  uid          TEXT,                              -- o:<device>:<id>
  updated_at_ms INTEGER NOT NULL DEFAULT 0,
  CHECK (seg_end > seg_start)
);

CREATE INDEX IF NOT EXISTS idx_override_block
  ON block_segment_override(block_uid, seg_start);
CREATE UNIQUE INDEX IF NOT EXISTS uq_override_span
  ON block_segment_override(block_uid, app_key, seg_start);
CREATE UNIQUE INDEX IF NOT EXISTS uq_override_uid
  ON block_segment_override(uid) WHERE uid IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_block_segment_override_uid
AFTER INSERT ON block_segment_override
WHEN NEW.uid IS NULL AND TRIM(NEW.device_id) <> ''
BEGIN
  UPDATE block_segment_override
     SET uid = 'o:' || NEW.device_id || ':' || NEW.id
   WHERE id = NEW.id;
END;

-- -----------------------------------------------------------------------------
-- 事项计时块的投影
-- 真源是业务库 `time_records`（= fold(timer_ops) 的物化）。这里的判据很硬：
-- **清空本表必须能从 time_records 完整重造**。做不到就不是投影，是双写。
-- 存 `item_name` / `category_key` 快照的理由：时间轴要秒开，且事项改名后历史块
-- 应显示当时的名字（与 app_usage「不存显示名」的取舍相反 —— 那张表是纯事实，
-- 名字随时可查；块是可读记录，改名会让历史整体漂移）。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS focus_blocks (
  uid           TEXT PRIMARY KEY,             -- 与 time_records.uid 逐字相同
  device_id     TEXT    NOT NULL,             -- 发起设备（不是「本机」）
  item_uid      TEXT    NOT NULL,
  item_name     TEXT    NOT NULL,
  category_key  TEXT,
  start_time    INTEGER NOT NULL,
  end_time      INTEGER,                      -- NULL = 进行中
  updated_at_ms INTEGER NOT NULL DEFAULT 0,
  CHECK (end_time IS NULL OR end_time >= start_time)
);

CREATE INDEX IF NOT EXISTS idx_focus_blocks_range
  ON focus_blocks(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_focus_blocks_item
  ON focus_blocks(item_uid, start_time);
CREATE INDEX IF NOT EXISTS idx_focus_blocks_device
  ON focus_blocks(device_id, start_time);
