-- =============================================================================
-- TickBar 数据库初始化 / 迁移脚本（Phase 2 锁定）
-- -----------------------------------------------------------------------------
-- Document ID : schema.sql
-- Upstream    : docs/Spec-v1.md §6 / docs/phase2/IPC-CONTRACT-v2.md
-- Owner       : 高见远（首席架构师）
-- Date        : 2026-10-16
--
-- 用途        : 由 tauri-plugin-sql 的 Migration（MigrationKind::Up）按序执行，
--               作为 %APPDATA%\com.tickbar.app\tickbar.db 的 schema 事实来源。
-- 幂等性      : 全部 DDL 使用 IF NOT EXISTS / INSERT OR IGNORE，重复执行不报错（K-7）。
-- 版本        : schema.version = 1（见文件末 settings 种子）。
--
-- 关键语义（详见 IPC-CONTRACT-v2 §7 / Spec §6）
--   1. time_records.status 仅 'active' | 'saved'（draft 已移除，Spec 变更①）。
--   2. active  = 会话进行中（ended_at IS NULL）；saved = 已结束并落盘。
--   3. running_since 非 NULL = 正在计时；NULL = 已暂停但会话未结束。
--   4. 前端实时数字 = accumulated_sec + (now - running_since)；
--      运行中每 15s 落盘一次 accumulated_sec（崩溃丢失 ≤30s）。
--   5. 全局最多一条 active 会话：uq_records_open 部分唯一索引兜底。
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
-- 用途：无事项时承接计时（PRD P0-2 / AC-09）；不可删除、不可归档，可改名。
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
  -- 时间不变式：结束不得早于开始
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  -- 状态与字段一致性：active <=> ended_at IS NULL
  CHECK ((status = 'active') = (ended_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_records_item_id      ON time_records(item_id);
CREATE INDEX IF NOT EXISTS idx_records_started_at   ON time_records(started_at);
CREATE INDEX IF NOT EXISTS idx_records_item_started ON time_records(item_id, started_at);
CREATE INDEX IF NOT EXISTS idx_records_status       ON time_records(status);

-- 兜底「全局最多一条 active 会话」（Spec §6 锁定；draft 已移除，仅 status='active'）
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

-- schema 版本号（K-7：迁移版本记录，供后续按序升级）
INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('schema.version', '1', CAST(strftime('%s','now') AS INTEGER) * 1000);

-- =============================================================================
-- 预置设置键（由 SettingsService 首次读取时以默认值写入，此处仅登记键名，不预写值）：
--   autostart.enabled        BOOLEAN  -> Settings.autostartEnabled（默认 false）
--   ui.always_on_top         BOOLEAN  -> Settings.alwaysOnTop（默认 true）
--   ui.opacity_enabled       BOOLEAN  -> Settings.opacityEnabled（默认 true）
--   ui.last_display_id       STRING   -> Settings.lastDisplayId（默认 null）
--   ui.last_item_id          INTEGER  -> TimerState.lastItemId（默认 1）
--   shortcut.toggle_window   STRING   -> Settings.shortcuts.toggleWindow（默认 null）
--   shortcut.start_pause     STRING   -> Settings.shortcuts.startPause（默认 null）
--   shortcut.stop            STRING   -> Settings.shortcuts.stop（默认 null）
--   shortcut.new_item        STRING   -> Settings.shortcuts.newItem（默认 null）
--   schema.version           STRING   -> 已在上面种入 '1'
-- =============================================================================
