-- =============================================================================
-- Timing 数据库迁移 0002 — V0.1.0 → V0.2.0（幂等）
-- -----------------------------------------------------------------------------
-- 权威参考 : docs/phase2/schema-V0.2.0.sql（目标全量 DDL）
-- 上游依据 : docs/phase1/ARCHITECTURE-V0.2.0.md §4.5（迁移策略）
--            docs/Spec-V0.2.0.md §6（迁移铁律）
--
-- 执行者   : src-tauri/src/infra/migrate.rs::migrate()
--   ① 0001_init.sql（3 张基表，IF NOT EXISTS）
--   ② ensure_column ×5（items/time_records 补列；PRAGMA table_info 守卫，K-13）
--   ③ 本文件（建 notes/todos + 全部索引 + settings 种子）
--   ④ settings['schema.version'] = 2
--
-- 幂等性（K-13）
--   - CREATE TABLE / CREATE INDEX 全 IF NOT EXISTS；种子 INSERT OR IGNORE；版本 UPDATE 幂等。
--   - items/time_records 的加列**不在本文件**：SQLite 无 ADD COLUMN IF NOT EXISTS，
--     重复执行报 `duplicate column name`。加列一律由 migrate.rs 的 ensure_column 守卫执行。
--     本文件里这两张表的 CREATE TABLE 仅作**目标 schema 留痕**——因 0001 已先建表，
--     该语句在任何路径上都是 no-op（列实际由 ensure_column 补齐）。
--   - 因此 `idx_items_remind`（依赖 items.remind_at）**必须**在 ensure_column 之后执行。
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- items（目标 schema 留痕；实际列由 ensure_column 补齐）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  color       TEXT,
  status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  is_system   INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  remind_at   INTEGER,
  reminded_at INTEGER,
  is_pinned   INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0,1)),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
-- J-5 提醒扫描热点（部分索引，只覆盖未触发提醒）
CREATE INDEX IF NOT EXISTS idx_items_remind
  ON items(remind_at) WHERE remind_at IS NOT NULL AND reminded_at IS NULL;

-- -----------------------------------------------------------------------------
-- time_records（目标 schema 留痕；实际列由 ensure_column 补齐）
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
  mode            TEXT    NOT NULL DEFAULT 'countup' CHECK (mode IN ('countup','countdown')),
  target_sec      INTEGER CHECK (target_sec IS NULL OR target_sec > 0),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted_at      INTEGER,
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  CHECK ((status = 'active') = (ended_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_records_item_id      ON time_records(item_id);
CREATE INDEX IF NOT EXISTS idx_records_started_at   ON time_records(started_at);
CREATE INDEX IF NOT EXISTS idx_records_item_started ON time_records(item_id, started_at);
CREATE INDEX IF NOT EXISTS idx_records_status       ON time_records(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_records_open
  ON time_records(status) WHERE status = 'active';

-- -----------------------------------------------------------------------------
-- notes — 便利贴（新表；一窗一行，窗口 label = note-{id}）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    INTEGER REFERENCES items(id),
  content    TEXT    NOT NULL DEFAULT '',
  pos_x      REAL    NOT NULL,
  pos_y      REAL    NOT NULL,
  width      REAL    NOT NULL,
  height     REAL    NOT NULL,
  is_open    INTEGER NOT NULL DEFAULT 0 CHECK (is_open IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_notes_item_id ON notes(item_id);
CREATE INDEX IF NOT EXISTS idx_notes_open
  ON notes(is_open) WHERE is_open = 1 AND deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- todos — 待办事项（新表；独立，不挂 items）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS todos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL CHECK (length(title) > 0),
  planned_at  INTEGER,
  remind_at   INTEGER,
  reminded_at INTEGER,
  done_at     INTEGER,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_todos_done    ON todos(done_at);
CREATE INDEX IF NOT EXISTS idx_todos_planned ON todos(planned_at);
CREATE INDEX IF NOT EXISTS idx_todos_remind
  ON todos(remind_at) WHERE remind_at IS NOT NULL AND reminded_at IS NULL;

-- -----------------------------------------------------------------------------
-- settings（结构不变）+ V0.2.0 新增键种子
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('theme.mode', '"dark"', CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('accent.running', '"#4DA3E8"', CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('accent.warn', '"#E8A33D"', CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('accent.done', '"#4CC38A"', CAST(strftime('%s','now') AS INTEGER) * 1000);
-- accent.bar：null = 跟随主题令牌（用户显式设置后才落 hex）
INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('accent.bar', 'null', CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('countdown.presets', '[300,900,1500,1800,2700,3600]', CAST(strftime('%s','now') AS INTEGER) * 1000);

-- -----------------------------------------------------------------------------
-- 版本推进：schema.version = 2
-- -----------------------------------------------------------------------------
UPDATE settings SET value = '2', updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'schema.version';
