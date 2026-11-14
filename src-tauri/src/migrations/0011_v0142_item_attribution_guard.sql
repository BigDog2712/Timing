-- =============================================================================
-- Timing 业务库迁移 0011（0.13.x · 事项归属）—— **幂等段**（每次启动无条件执行）
--
-- 与 0009 / 0010 的 guard 同一个处置理由：`infra/migrate.rs` 每次启动都重跑
-- 0001–0006，任何「只建一次」的东西都不能靠版本门；本文件每条语句本身幂等
-- （CREATE ... IF NOT EXISTS、UPDATE ... WHERE 命中 0 行），所以每次跑都安全。
--
-- 加列（`items.parent_id` / `depth` / `category_key` / `device_id` / `uid` /
-- `updated_at_ms`）由 `MIGRATE_COLUMNS_V11` 的 `ensure_column` 补，**不是**裸 ALTER
-- （SQLite 没有 ADD COLUMN IF NOT EXISTS，K-13）。
--
-- 本文件**必须**排在 0009 / 0010 之后：items 的盖戳触发器要写 `updated_at_ms`，
-- 而 time_records 那一套的语义（MAX(now, OLD+1)）要与它逐字一致，两处对不上
-- 会让「同一批变更」在两个表上有不同的新旧顺序。
-- =============================================================================

-- =============================================================================
-- ① items（事项）：树 + 分类 + 同步三件套
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_items_parent ON items(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_key) WHERE category_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_items_updated ON items(updated_at_ms);

CREATE UNIQUE INDEX IF NOT EXISTS uq_items_uid ON items(uid) WHERE uid IS NOT NULL;

-- uid 由库自己发：写入口有四个（设置页 / 待办起计时 / md 导入 / 恢复）。
-- 哨兵守卫同 time_records：device_id 还是 '' 时不发 `i::12` 这种半截身份。
CREATE TRIGGER IF NOT EXISTS trg_items_uid AFTER INSERT ON items
WHEN NEW.uid IS NULL AND TRIM(NEW.device_id) <> ''
BEGIN
  UPDATE items SET uid = 'i:' || NEW.device_id || ':' || NEW.id WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_items_touch_insert AFTER INSERT ON items
BEGIN
  UPDATE items
     SET updated_at_ms = MAX(CAST(strftime('%s','now') AS INTEGER) * 1000, 1)
   WHERE id = NEW.id AND updated_at_ms = 0;
END;

-- OF 列表里没有 updated_at（调用点自己维护的业务列）也没有 updated_at_ms（会自触发）。
-- MAX(now, OLD+1)：时钟回拨后纯 now 会让刚改的行看起来比旧行更旧 ⇒ 对端 LWW 判错。
CREATE TRIGGER IF NOT EXISTS trg_items_touch_update
AFTER UPDATE OF name, color, status, is_system, sort_order,
                remind_at, reminded_at, is_pinned, deleted_at,
                parent_id, depth, category_key
ON items
BEGIN
  UPDATE items
     SET updated_at_ms = MAX(CAST(strftime('%s','now') AS INTEGER) * 1000,
                              COALESCE(OLD.updated_at_ms, 0) + 1)
   WHERE id = NEW.id;
END;

-- =============================================================================
-- ② item_app（事项 ↔ 应用，多对多）
-- =============================================================================
-- 不带分类：分类解析只有一条入口（活动库 `attribution::category` 的 3 条规则）。
-- 在这里再放一个「本事项下的缺省分类」就有了第二套规则，两条规则打架时无人能判。

CREATE TABLE IF NOT EXISTS item_app (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  app_key    TEXT    NOT NULL,
  track      INTEGER NOT NULL DEFAULT 1 CHECK (track IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  device_id  TEXT    NOT NULL DEFAULT '',
  uid        TEXT,                         -- b:<device>:<id>
  updated_at_ms INTEGER NOT NULL DEFAULT 0,
  UNIQUE (item_id, app_key)
);

CREATE INDEX IF NOT EXISTS idx_item_app_app ON item_app(app_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_item_app_uid ON item_app(uid) WHERE uid IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_item_app_uid AFTER INSERT ON item_app
WHEN NEW.uid IS NULL AND TRIM(NEW.device_id) <> ''
BEGIN
  UPDATE item_app SET uid = 'b:' || NEW.device_id || ':' || NEW.id WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_item_app_touch_insert AFTER INSERT ON item_app
BEGIN
  UPDATE item_app
     SET updated_at_ms = MAX(CAST(strftime('%s','now') AS INTEGER) * 1000, 1)
   WHERE id = NEW.id AND updated_at_ms = 0;
END;

CREATE TRIGGER IF NOT EXISTS trg_item_app_touch_update
AFTER UPDATE OF item_id, app_key, track ON item_app
BEGIN
  UPDATE item_app
     SET updated_at_ms = MAX(CAST(strftime('%s','now') AS INTEGER) * 1000,
                              COALESCE(OLD.updated_at_ms, 0) + 1)
   WHERE id = NEW.id;
END;

-- =============================================================================
-- ③ timer_ops（计时操作日志，同步的真源）
-- =============================================================================
-- 为什么要有这张表：要求「PC 发起、手机结束」。若同步传状态，手机就得改 PC 那一行
-- ⇒ 推翻 P4 的支点「一行永远只有属主写」。传操作时，手机的 stop 是一条**属于手机**
-- 的新行，PC 的 start 一个字节都没被动过。
--
-- 事件**不可变**（append-only）：没有 UPDATE 触发器，`kind`/`at_ms` 也不在墓碑之外
-- 被改写。`drop` 是一条新事件，不是删除旧事件。

CREATE TABLE IF NOT EXISTS timer_ops (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_uid TEXT    NOT NULL,             -- 被操作的会话（start 造出来的 time_records.uid）
  item_uid    TEXT    NOT NULL,             -- 冗余：按事项取事件时不必先查会话
  kind        TEXT    NOT NULL
                      CHECK (kind IN ('start','pause','resume','stop','adjust','drop')),
  at_ms       INTEGER NOT NULL,             -- 语义时刻（按下按钮那一刻），不是写入时刻
  day_key     TEXT    NOT NULL              -- = start op 的本地日（分片按它落天）
                      CHECK (length(day_key) = 10),
  payload     TEXT,                         -- start 的 mode/target_sec、adjust 的新起点
  created_at  INTEGER NOT NULL,
  device_id   TEXT    NOT NULL DEFAULT '',
  uid         TEXT,                         -- p:<device>:<id>
  updated_at_ms INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_timer_ops_session ON timer_ops(session_uid, at_ms);
CREATE INDEX IF NOT EXISTS idx_timer_ops_day ON timer_ops(day_key);
CREATE INDEX IF NOT EXISTS idx_timer_ops_item ON timer_ops(item_uid, at_ms);
CREATE UNIQUE INDEX IF NOT EXISTS uq_timer_ops_uid ON timer_ops(uid) WHERE uid IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_timer_ops_uid AFTER INSERT ON timer_ops
WHEN NEW.uid IS NULL AND TRIM(NEW.device_id) <> ''
BEGIN
  UPDATE timer_ops SET uid = 'p:' || NEW.device_id || ':' || NEW.id WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_timer_ops_touch_insert AFTER INSERT ON timer_ops
BEGIN
  UPDATE timer_ops
     SET updated_at_ms = MAX(CAST(strftime('%s','now') AS INTEGER) * 1000, 1)
   WHERE id = NEW.id AND updated_at_ms = 0;
END;

-- =============================================================================
-- ④ 墓碑：items('i') / item_app('b') / timer_ops('p')
-- =============================================================================
-- 绑定的墓碑**要**记：用户单独解绑一个应用时，对端不会因此收到任何事项变更，
-- 只能靠这条墓碑把绑定的那一行删掉。
-- 反过来，删整个事项时**不**为它的绑定逐条记墓碑：对端收到 `i` 墓碑后会级联清掉
-- 该事项下的绑定（合并内核的逻辑），否则一次删事项会吐出几十条墓碑，分片不再稳定。

-- `trg_time_records_tombstone` 与 0010 guard 里的定义**逐字相同**，这里再写一遍是因为
-- `migrate::widen_tombstone_kinds` 重建墓碑表前必须先把它删掉（SQLite 的 DROP TABLE 会
-- 因悬空触发器引用而报错），而 0010 guard 已经在本文件之前跑过了，不会再补建。
CREATE TRIGGER IF NOT EXISTS trg_time_records_tombstone AFTER DELETE ON time_records
WHEN OLD.uid IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM sync_suppress WHERE uid = OLD.uid)
BEGIN
  INSERT INTO sync_tombstone(uid, kind, device_id, deleted_at_ms)
  VALUES (OLD.uid, 't', OLD.device_id,
          MAX(CAST(strftime('%s','now') AS INTEGER) * 1000,
              COALESCE(OLD.updated_at_ms, 0) + 1))
  ON CONFLICT(uid) DO UPDATE SET deleted_at_ms = excluded.deleted_at_ms;
END;

CREATE TRIGGER IF NOT EXISTS trg_items_tombstone AFTER DELETE ON items
WHEN OLD.uid IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM sync_suppress WHERE uid = OLD.uid)
BEGIN
  INSERT INTO sync_tombstone(uid, kind, device_id, deleted_at_ms)
  VALUES (OLD.uid, 'i', OLD.device_id,
          MAX(CAST(strftime('%s','now') AS INTEGER) * 1000,
              COALESCE(OLD.updated_at_ms, 0) + 1))
  ON CONFLICT(uid) DO UPDATE SET deleted_at_ms = excluded.deleted_at_ms;
END;

CREATE TRIGGER IF NOT EXISTS trg_item_app_tombstone AFTER DELETE ON item_app
WHEN OLD.uid IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM sync_suppress WHERE uid = OLD.uid)
BEGIN
  INSERT INTO sync_tombstone(uid, kind, device_id, deleted_at_ms)
  VALUES (OLD.uid, 'b', OLD.device_id,
          MAX(CAST(strftime('%s','now') AS INTEGER) * 1000,
              COALESCE(OLD.updated_at_ms, 0) + 1))
  ON CONFLICT(uid) DO UPDATE SET deleted_at_ms = excluded.deleted_at_ms;
END;

CREATE TRIGGER IF NOT EXISTS trg_timer_ops_tombstone AFTER DELETE ON timer_ops
WHEN OLD.uid IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM sync_suppress WHERE uid = OLD.uid)
BEGIN
  INSERT INTO sync_tombstone(uid, kind, device_id, deleted_at_ms)
  VALUES (OLD.uid, 'p', OLD.device_id,
          MAX(CAST(strftime('%s','now') AS INTEGER) * 1000,
              COALESCE(OLD.updated_at_ms, 0) + 1))
  ON CONFLICT(uid) DO UPDATE SET deleted_at_ms = excluded.deleted_at_ms;
END;

-- =============================================================================
-- ⑤ 回填（幂等：第二次启动命中 0 行）
-- =============================================================================
-- 既有事项用自身的 updated_at 近似；之后由触发器维护。
UPDATE items SET updated_at_ms = COALESCE(updated_at, created_at, 1)
 WHERE updated_at_ms = 0;

-- uid 的回填**不在这里**：`device_id` 此刻可能还是哨兵 ''，发不出合法 uid。
-- 由启动流程的 `services::device::startup_business_identity` → `adopt_business_rows`
-- 在认领 device_id 之后补（那里还要先查重，冲突时跳过并告警）。
