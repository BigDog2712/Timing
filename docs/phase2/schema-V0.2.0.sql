-- =============================================================================
-- Timing 数据库 Schema V0.2.0（5 表全量 DDL + 增量迁移）
-- -----------------------------------------------------------------------------
-- Document ID : schema-V0.2.0.sql
-- Upstream    : docs/phase1/ARCHITECTURE-V0.2.0.md §4 / docs/phase2/IPC-CONTRACT-V0.2.0.md
-- Owner       : 高见远（首席架构师）
-- Date        : 2026-10-16
--
-- 用途
--   1) 【全量 DDL】新建库（V0.2.0 首装）的目标 schema —— 权威参考。
--   2) 【增量迁移】V0.1.0 老库升级（items / time_records 加列）—— 由 Rust 侧
--      `src-tauri/src/infra/migrate.rs` 的列守卫（PRAGMA table_info）执行。
--
-- 注意（K-13，务必先读）：幂等性
--   - CREATE TABLE / CREATE INDEX / INSERT OR IGNORE 全部幂等，可反复执行。
--   - **SQLite 不支持 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`**（重复执行报
--     `duplicate column name`）。因此「增量迁移」段的 ALTER 语句**不能**靠纯 SQL
--     幂等，必须由 migrate.rs 的 `ensure_column(table, col, def)` 守卫：
--         仅当 col 不在 PRAGMA table_info(table) 中才执行该 ALTER。
--   - 本文件把 ALTER 语句**完整列出**（可审计 / 可手工参考），但其**执行者**是
--     migrate.rs，不是直接 raw_sql 全量跑。见 ARCHITECTURE-V0.2.0 §4.5。
--
-- 版本：schema.version = 2
--
-- 关键语义（沿用 v1 + V0.2.0 增量）
--   - time_records.status 仅 'active' | 'saved'（draft 已移除）。
--   - 全局最多一条 active 会话：uq_records_open 部分唯一索引兜底。
--   - V0.2.0：time_records.mode ∈ {countup,countdown}；countdown 时 target_sec > 0。
--   - V0.2.0：items/todos 的 remind_at + reminded_at 组合保证「一条提醒只触发一次」。
--   - V0.2.0：notes.is_open=1 表示便利贴窗口当前打开（启动据此恢复窗口）。
-- =============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- =============================================================================
-- 第一部分：全量 DDL（目标 schema，新库直接用；老库由 IF NOT EXISTS 跳过）
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 表 items — 事项（归类主体）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  color       TEXT,
  status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  is_system   INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  -- V0.2.0 新增
  remind_at   INTEGER,                                  -- 事项提醒时刻（epoch ms）；NULL=无提醒
  reminded_at INTEGER,                                  -- 已触发时刻；NULL=未触发（去重标记，K-19）
  is_pinned   INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0,1)),  -- 1=固定任务/常用事项
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
-- 提醒扫描热点（部分索引：只覆盖未触发提醒）
CREATE INDEX IF NOT EXISTS idx_items_remind
  ON items(remind_at) WHERE remind_at IS NOT NULL AND reminded_at IS NULL;

-- 系统内置事项「未归类」(id=1, is_system=1)：无事项时承接计时；不可删除/归档，可改名。
INSERT OR IGNORE INTO items (id, name, color, status, is_system, sort_order, created_at, updated_at)
VALUES (
  1, '未归类', NULL, 'active', 1, 0,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
);

-- -----------------------------------------------------------------------------
-- 表 time_records — 时间记录（一次计时会话）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS time_records (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id         INTEGER NOT NULL REFERENCES items(id),
  status          TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','saved')),
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  accumulated_sec INTEGER NOT NULL DEFAULT 0 CHECK (accumulated_sec >= 0),
  running_since   INTEGER,
  note            TEXT,
  -- V0.2.0 新增
  mode            TEXT    NOT NULL DEFAULT 'countup' CHECK (mode IN ('countup','countdown')),
  target_sec      INTEGER CHECK (target_sec IS NULL OR target_sec > 0),  -- 仅 countdown 非空
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted_at      INTEGER,
  -- 时间不变式：结束不得早于开始
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  -- 状态与字段一致性：active <=> ended_at IS NULL
  CHECK ((status = 'active') = (ended_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_records_item_id      ON time_records(item_id);
CREATE INDEX IF NOT EXISTS idx_records_started_at   ON time_records(started_at);
CREATE INDEX IF NOT EXISTS idx_records_item_started ON time_records(item_id, started_at);
CREATE INDEX IF NOT EXISTS idx_records_status       ON time_records(status);
-- 兜底「全局最多一条 active 会话」
CREATE UNIQUE INDEX IF NOT EXISTS uq_records_open
  ON time_records(status) WHERE status = 'active';

-- -----------------------------------------------------------------------------
-- 表 notes — 便利贴（一窗一行；窗口由 note-{id} 承载）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    INTEGER REFERENCES items(id),          -- NULL = 独立便签
  content    TEXT    NOT NULL DEFAULT '',           -- 纯文本，保留换行；应用层上限 4000 字符
  pos_x      REAL    NOT NULL,                      -- 逻辑像素 x（非物理像素，K-15）
  pos_y      REAL    NOT NULL,
  width      REAL    NOT NULL,                      -- 逻辑像素宽（硬钳制 160–900；运行时再受 work_area 钳制）
  height     REAL    NOT NULL,                      -- 逻辑像素高（硬钳制 120–900；运行时再受 work_area 钳制）
  is_open    INTEGER NOT NULL DEFAULT 0 CHECK (is_open IN (0,1)),  -- 1=窗口当前打开
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_notes_item_id ON notes(item_id);
-- 启动恢复打开态便利贴（热点，部分索引）
CREATE INDEX IF NOT EXISTS idx_notes_open
  ON notes(is_open) WHERE is_open = 1 AND deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- 表 todos — 待办事项（独立，不挂事项）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS todos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL CHECK (length(title) > 0),
  planned_at  INTEGER,                              -- 计划执行时刻；NULL=未排期
  remind_at   INTEGER,                              -- 提醒时刻；NULL=无提醒
  reminded_at INTEGER,                              -- 已触发时刻；NULL=未触发（去重标记，K-19）
  done_at     INTEGER,                              -- 完成时刻；NULL=未完成
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_todos_done    ON todos(done_at);
CREATE INDEX IF NOT EXISTS idx_todos_planned ON todos(planned_at);
-- 提醒扫描热点（部分索引）
CREATE INDEX IF NOT EXISTS idx_todos_remind
  ON todos(remind_at) WHERE remind_at IS NOT NULL AND reminded_at IS NULL;

-- -----------------------------------------------------------------------------
-- 表 settings — 键值配置（结构不变）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- =============================================================================
-- 第二部分：settings 种子（INSERT OR IGNORE，幂等）
-- =============================================================================

INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('schema.version', '2', CAST(strftime('%s','now') AS INTEGER) * 1000);

-- V0.2.0 新增键（默认值；未命中时由 SettingsService 读取兜底）
INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('theme.mode', '"dark"', CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('accent.running', '"#4DA3E8"', CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('accent.warn', '"#E8A33D"', CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('accent.done', '"#4CC38A"', CAST(strftime('%s','now') AS INTEGER) * 1000);
-- accent.bar：NULL = 跟随主题令牌（用户显式设置后才落 hex）
INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('accent.bar', 'null', CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('countdown.presets', '[300,900,1500,1800,2700,3600]', CAST(strftime('%s','now') AS INTEGER) * 1000);

-- =============================================================================
-- 第三部分：增量迁移（V0.1.0 老库升级）
-- -----------------------------------------------------------------------------
-- 注意：本段 ALTER 不幂等（SQLite 无 ADD COLUMN IF NOT EXISTS，K-13）。
--    实际执行者 = src-tauri/src/infra/migrate.rs::ensure_column（PRAGMA table_info 守卫）。
--    此处完整列出以留痕 + 允许人工参考；**不要**用 raw_sql 直接全量执行本段两次。
--
-- ensure_column 守卫的等价伪码：
--     for (table, col, def) in MIGRATE_COLUMNS:
--         if col not in PRAGMA table_info(table):
--             ALTER TABLE table ADD COLUMN col def
-- -----------------------------------------------------------------------------

-- --- items 加列 -------------------------------------------------------------
-- ALTER TABLE items ADD COLUMN remind_at   INTEGER;
-- ALTER TABLE items ADD COLUMN reminded_at INTEGER;
-- ALTER TABLE items ADD COLUMN is_pinned   INTEGER NOT NULL DEFAULT 0;
-- （注：SQLite 的 ADD COLUMN 不允许带 CHECK，故 is_pinned 的 CHECK 只在「全量 DDL」的新库中存在；
--   老库升级后该列无 CHECK 约束，取值由应用层保证 0/1。）

-- --- time_records 加列 ------------------------------------------------------
-- ALTER TABLE time_records ADD COLUMN mode       TEXT NOT NULL DEFAULT 'countup';
-- ALTER TABLE time_records ADD COLUMN target_sec INTEGER;
-- （注：同理，ADD COLUMN 不能带 CHECK；mode 取值与 target_sec>0 由 TimerService 校验。）

-- --- notes / todos 无需 ALTER（由第一部分 CREATE TABLE 直接建出全列）--------

-- --- 增量索引 ----------------------------------------------------------------
-- 全部索引已在「第一部分」定义（IF NOT EXISTS 幂等），此处不再重复。
-- 注意执行顺序（K-13）：migrate.rs 必须**先**跑 ensure_column 补列，**再**跑本文件；
-- 否则 `idx_items_remind` 会在旧库上因 items.remind_at 尚不存在而报错。
--   正确顺序：① 0001_init.sql（幂等建 3 张基表） → ② ensure_column（补 5 列）
--            → ③ 本文件（建 notes/todos + 全部索引 + 种子） → ④ 版本推进。

-- --- 版本推进 --------------------------------------------------------------
UPDATE settings SET value = '2', updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'schema.version';

-- =============================================================================
-- 完整预置设置键清单（由 SettingsService 首次读取时以默认值兜底，此处仅登记）
-- -----------------------------------------------------------------------------
-- V0.1.0（不变）：
--   autostart.enabled        BOOLEAN -> Settings.autostartEnabled（默认 false）
--   ui.always_on_top         BOOLEAN -> Settings.alwaysOnTop（默认 true）
--   ui.opacity_enabled       BOOLEAN -> Settings.opacityEnabled（默认 true）
--   ui.last_display_id       STRING  -> Settings.lastDisplayId（默认 null）
--   ui.last_item_id          INTEGER -> TimerState.lastItemId（默认 1）
--   ui.window_x / ui.window_y REAL   -> 主窗位置
--   shortcut.toggle_window / start_pause / stop / new_item  STRING（默认 null）
-- V0.2.0（新增）：
--   theme.mode               STRING  -> Settings.themeMode（"dark"|"light"|"system"，默认 "dark"）
--   accent.running / warn / done  STRING(hex) -> Settings.accents.{running,warn,done}
--   accent.bar               STRING(hex)|null -> Settings.accents.bar（null=跟随主题）
--   countdown.presets        STRING(JSON)     -> Settings.countdownPresets
-- =============================================================================
