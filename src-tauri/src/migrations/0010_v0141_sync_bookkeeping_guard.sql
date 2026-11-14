-- =============================================================================
-- Timing 业务库迁移 0010（0.12.2 · 同步簿记）—— **幂等抵消段**（每次启动无条件执行）
--
-- 与 0009 的 guard 同一个处置理由：`infra/migrate.rs` 每次启动都重跑 0001–0006，
-- 任何「只建一次」的东西都不能靠版本门，而本文件的每条语句本身就幂等
-- （DROP/CREATE IF NOT EXISTS、UPDATE … WHERE 命中 0 行），所以放在这里最安全。
--
-- 列（`time_records.updated_at_ms`）由 `MIGRATE_COLUMNS_V10` 的 `ensure_column` 补，
-- 不能写成裸 ALTER：SQLite 没有 `ADD COLUMN IF NOT EXISTS`（K-13）。
--
-- ⚠️ 本轮**不同步** `time_records`（`items` 未同步 ⇒ `item_id` 跨设备悬空）。
--    列与触发器先建好，日后切开只差 T12 的一个常量（P4 文档 §3.2.1）。
--    先建的理由：省掉日后在真实数据上再拆一次表。
-- =============================================================================

-- ① 扫描索引 ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_records_updated ON time_records(updated_at_ms);

-- ② 盖戳：新行 --------------------------------------------------------------
-- 由触发器盖章而不是让调用点写：写入口有四个（计时落库 / 手改 / md 导入 / 恢复），
-- 漏一个 ⇒ 那批行永远 updated_at_ms = 0 ⇒ 永远不会被导出，且没有任何报错。
-- `MAX(now, 1)`：0 是「没盖过戳」的哨兵，时钟被设成 1970 时也不能盖成 0。
CREATE TRIGGER IF NOT EXISTS trg_time_records_touch_insert AFTER INSERT ON time_records
BEGIN
  UPDATE time_records
     SET updated_at_ms = MAX(CAST(strftime('%s','now') AS INTEGER) * 1000, 1)
   WHERE id = NEW.id AND updated_at_ms = 0;
END;

-- ③ 盖戳：修改行 ------------------------------------------------------------
-- OF 列表里**没有** updated_at_ms，所以下面那条 UPDATE 不会再触发自己。
-- 也没有 updated_at：那是调用点自己维护的列，把它算进「内容变了」会让每次
-- 例行写都多盖一次戳（不影响正确性，但会让「哪一天脏了」的判断变糊）。
-- `MAX(now, OLD+1)`：用户时钟会被 NTP 回拨、也会被手工改；纯 now 会让刚写的行
-- 看起来比旧行更旧 ⇒ 接收方 LWW 判错 ⇒ 新数据被旧数据覆盖。
CREATE TRIGGER IF NOT EXISTS trg_time_records_touch_update
AFTER UPDATE OF item_id, status, started_at, ended_at, accumulated_sec, running_since, note, deleted_at
ON time_records
BEGIN
  UPDATE time_records
     SET updated_at_ms = MAX(CAST(strftime('%s','now') AS INTEGER) * 1000,
                              COALESCE(OLD.updated_at_ms, 0) + 1)
   WHERE id = NEW.id;
END;

-- ④ 墓碑 --------------------------------------------------------------------
-- kind='t' 与活动库的 kind='s' 同一张表结构（各自库内独立）。字段集合封闭，
-- 禁止加内容字段——永久保留的前提就是这一行（P4 文档 §8.3）。
CREATE TABLE IF NOT EXISTS sync_tombstone (
  uid           TEXT    PRIMARY KEY,
  kind          TEXT    NOT NULL CHECK (kind IN ('s','t')),
  device_id     TEXT    NOT NULL,
  deleted_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_time_records_tombstone_time
  ON sync_tombstone(deleted_at_ms);

-- 抑制表与活动库同构：合并期间写它，触发器跳过，避免「继承对端墓碑」变成
-- 「本机重发一个新墓碑」（时间戳换成 now ⇒ 分片永不稳定 ⇒ 无限重推）。
CREATE TABLE IF NOT EXISTS sync_suppress (uid TEXT PRIMARY KEY);

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

-- ⑤ 回填（幂等：第二次启动命中 0 行）---------------------------------------
-- 既有行用「结束时刻，未结束则开始时刻，再兜底创建时刻」近似；之后由触发器维护。
UPDATE time_records
   SET updated_at_ms = COALESCE(ended_at, started_at, created_at)
 WHERE updated_at_ms = 0;
