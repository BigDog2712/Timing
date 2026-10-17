-- =============================================================================
-- TickBar 数据库初始化 / 迁移脚本（迁移 0001，Phase 2 锁定）
-- -----------------------------------------------------------------------------
-- Upstream : docs/Spec-v1.md §6 / docs/phase2/IPC-CONTRACT-v2.md / docs/phase2/schema.sql
-- 幂等性   : 全部 DDL 使用 IF NOT EXISTS / INSERT OR IGNORE，重复执行不报错（K-7）。
-- 版本     : schema.version = 1
-- =============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

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
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);

-- 系统内置事项「未归类」(id=1, is_system=1)
INSERT OR IGNORE INTO items (id, name, color, status, is_system, sort_order, created_at, updated_at)
VALUES (
  1,
  '未归类',
  NULL,
  'active',
  1,
  0,
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

-- 兜底「全局最多一条 active 会话」
CREATE UNIQUE INDEX IF NOT EXISTS uq_records_open
  ON time_records(status) WHERE status = 'active';

-- -----------------------------------------------------------------------------
-- 表 settings — 键值配置（快捷键 / 自启 / 透明度 / 显示器等）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('schema.version', '1', CAST(strftime('%s','now') AS INTEGER) * 1000);
