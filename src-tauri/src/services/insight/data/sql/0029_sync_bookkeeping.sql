-- =============================================================================
-- patina.db 迁移 29 · 同步簿记（P4 · T11）
--
-- 由 `data/schema_registry.rs` 用 include_str! 引入。sqlx 的 Migrator 保证每个
-- version **只执行一次**，所以下面不需要 `IF NOT EXISTS` 来兜「重复执行」，
-- 保留它只是为了让正文与「空库手建」的路径共用一份文本。
--
-- 顺序是硬约束：建表 → 墓碑表 → 抑制表 → 触发器。触发器正文引用的表必须先存在
-- （SQLite 建触发器时会解析表名，但**不解析**列名；这正是不必把 sessions 的列
-- 提前到本文件来的原因）。
--
-- ## 为什么簿记放在活动库的迁移里，而不是「等 P4 再说」
--
-- 迁移 28 已经把 `sessions.updated_at_ms / synced_seq` 两列落下（当时刻意提前，
-- 省掉日后在 13k 行表上再拆一次）。本文件补齐**行为**：谁在什么时候盖这个戳。
-- 只落列不落触发器 = 那一列永远 0 = 同步永远认为「没有一天是脏的」，
-- 这是最坏的一类静默失败（同步跑得绿、数据不动）。
-- =============================================================================

-- ① updated_at_ms 的扫描索引 ------------------------------------------------
-- 28 建的 idx_sessions_pending 是 partial（WHERE synced_seq IS NULL），只服务
-- 「还有哪些行没推过」。推送/导出要按「某一天变过」取，需要一条不走 partial 的。
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at_ms);

-- ② 盖戳触发器：新行 --------------------------------------------------------
-- 写成触发器而不是让写入方赋值：写入口有四个（Rust tracker / Kotlin / 导入 / 恢复），
-- 漏一个 ⇒ 那批行永远 updated_at_ms = 0 ⇒ 永远不会被导出，且**没有任何报错**。
-- `MAX(now, 1)`：0 是「没盖过戳」的哨兵，不能被 now 的 0 混淆（时钟被设成 1970 也不该）。
CREATE TRIGGER IF NOT EXISTS trg_sessions_touch_insert AFTER INSERT ON sessions
BEGIN
  UPDATE sessions
     SET updated_at_ms = MAX(CAST(strftime('%s','now') AS INTEGER) * 1000, 1)
   WHERE id = NEW.id AND updated_at_ms = 0;
END;

-- ③ 盖戳触发器：修改行 ------------------------------------------------------
-- `AFTER UPDATE OF` 的列表里**没有** updated_at_ms，所以下面那条 UPDATE 不会再
-- 触发自己（与既有 9 个脏区间触发器同一个技巧，不是新发明）。
-- 列表必须与 trg_read_model_sessions_update 的 OF 列表逐字一致：两者都是
-- 「哪些列算内容变了」的权威定义，一个改一个不改就会出现「投影重算了但不导出」。
--
-- `MAX(now, OLD+1)` 而不是纯 now：用户时钟会被 NTP 回拨、也会被手工改。
-- 纯 now 会让「刚写的一行」看起来比旧行更旧 ⇒ 接收方 LWW 判错 ⇒ 新数据被旧数据覆盖。
-- 跨行不要求单调（不需要：uid 里含属主 device_id，一行永远只有属主写）。
CREATE TRIGGER IF NOT EXISTS trg_sessions_touch_update
AFTER UPDATE OF app_name, exe_name, window_title, start_time, end_time, duration ON sessions
BEGIN
  UPDATE sessions
     SET updated_at_ms = MAX(CAST(strftime('%s','now') AS INTEGER) * 1000,
                              COALESCE(OLD.updated_at_ms, 0) + 1)
   WHERE id = NEW.id;
END;

-- ④ 对端设备花名册 ----------------------------------------------------------
-- 只在本地维护，**不**从远端 state.json 反推「我认识谁」：没有 PROPFIND 就无法验证，
-- 而两台设备互相写同一份文件必然互相覆盖。对端只能靠人配对一次引入（P4 文档 §2.2）。
CREATE TABLE IF NOT EXISTS sync_peer (
  peer_id         TEXT    PRIMARY KEY CHECK(length(peer_id) = 12),
  label           TEXT    NOT NULL DEFAULT '',
  platform        TEXT    NOT NULL DEFAULT '',
  paired_at_ms    INTEGER NOT NULL,
  last_seen_ms    INTEGER,
  last_pull_ms    INTEGER,
  last_push_ms    INTEGER,
  failed_day      TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT
);

-- ⑤ 拉取判据：「对端的哪一天，我按哪个内容哈希应用过一次」--------------------
-- 用哈希而不是游标：state.json 本身可能被撕成半个（§4.2），游标一旦跳号就永久丢一段；
-- 哈希对不上就重拉，天然自愈。
CREATE TABLE IF NOT EXISTS sync_pull_state (
  peer_id       TEXT    NOT NULL,
  day_key       TEXT    NOT NULL,
  applied_hash  TEXT    NOT NULL,
  applied_at_ms INTEGER NOT NULL,
  rows          INTEGER NOT NULL,
  PRIMARY KEY (peer_id, day_key)
);

-- ⑥ 推送判据：「我的哪一天，我以哪个哈希推上去过」----------------------------
CREATE TABLE IF NOT EXISTS sync_push_state (
  day_key      TEXT    PRIMARY KEY,
  pushed_hash  TEXT    NOT NULL,
  pushed_at_ms INTEGER NOT NULL,
  bytes        INTEGER NOT NULL
);

-- ⑦ 通道开关（url / user / password 复用 remote_backup_settings，不重复存）---
-- 两套 WebDAV 配置必然有一套填错；`remote_dir` 空 = `<backup.remote_dir>/timing-sync`。
-- 副作用要在界面上说清：关掉备份不影响同步，但**删掉备份配置会让同步不可用**。
CREATE TABLE IF NOT EXISTS sync_channel (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  enabled       INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  remote_dir    TEXT    NOT NULL DEFAULT '',
  last_round_ms INTEGER,
  last_error    TEXT
);

-- ⑧ 墓碑 --------------------------------------------------------------------
-- 为什么不做软删除（`sessions.deleted_at_ms`）：会让几十条 `FROM sessions` 查询与
-- 9 个读模型触发器全部失效，漏一处就是静默算错。独立表只被同步路径读。
--
-- 字段集合封闭：uid/kind/device_id/deleted_at_ms。
-- 禁止加任何内容字段（标题/窗口名/应用名）——永久保留（§8.3）的全部前提就是这一行：
-- 表里只有「哪个 uid 什么时候没了」，没有任何可读内容。
CREATE TABLE IF NOT EXISTS sync_tombstone (
  uid           TEXT    PRIMARY KEY,
  kind          TEXT    NOT NULL CHECK (kind IN ('s','t')),
  device_id     TEXT    NOT NULL,
  deleted_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_tombstone_time ON sync_tombstone(deleted_at_ms);

-- ⑨ 抑制表 + 删除触发器：继承对端墓碑，不重发 --------------------------------
-- 朴素做法（收到墓碑 → 本地 DELETE → AFTER DELETE 又造一个新墓碑）会出事：新墓碑的
-- 时间戳是**本机 now**、不是对端那个值 ⇒ 该天的分片内容每轮都变 ⇒ 三台设备链式
-- 传播时每一跳刷新一次时间戳 ⇒ 分片永远不稳定、无限重推，applied_hash 永远对不上。
--
-- 所以：合并期间先往 sync_suppress 写一条，触发器看到就跳过；合并结束**必须**清掉
-- （同事务、哪怕 DELETE 影响 0 行）。漏了它，本机日后真删同一个 uid 时不会记墓碑
-- ⇒ 第三台设备上那条永不消失。
CREATE TABLE IF NOT EXISTS sync_suppress (
  uid TEXT PRIMARY KEY
);

CREATE TRIGGER IF NOT EXISTS trg_sessions_tombstone AFTER DELETE ON sessions
WHEN OLD.uid IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM sync_suppress WHERE uid = OLD.uid)
BEGIN
  INSERT INTO sync_tombstone(uid, kind, device_id, deleted_at_ms)
  VALUES (OLD.uid, 's', OLD.device_id,
          MAX(CAST(strftime('%s','now') AS INTEGER) * 1000,
              COALESCE(OLD.updated_at_ms, 0) + 1))
  ON CONFLICT(uid) DO UPDATE SET deleted_at_ms = excluded.deleted_at_ms;
END;
