-- =============================================================================
-- patina.db 迁移 28 · 设备维度（P1）
--
-- 由 `data/schema_registry.rs` 用 include_str! 引入；sqlx 的 Migrator 保证每个
-- version **只执行一次**，所以下面的 ADD COLUMN 天然幂等（不需要 IF NOT EXISTS）。
--
-- 顺序是硬约束，别重排：
--   ① 设备花名册 → ② 加列 → ③ 生成列 → ④ uid 触发器 → ⑤ 拆单活跃索引
--   → ⑥ 重建小时投影 → ⑦ 日级双口径表 → ⑧ 让投影与日表全量重建
-- 反了会在建索引时报 `no such column`。
--
-- ⚠️ 这里**不**回填 uid：`UPDATE … SET uid = 's:'||device_id||':'||id` 一旦遇到
--    「两条行算出同一个 uid」的历史脏数据，整个迁移会因 `uq_sessions_uid` 失败，
--    启动直接挂。改为由 `schema_core::adopt_local_rows` 先查重、有冲突只告警。
-- =============================================================================

-- ① 设备花名册 ---------------------------------------------------------------
-- is_self 唯一：本机身份即使 install_id.txt 丢了也能定位「哪一行是我」。
-- color 为空 = 由 install_id 的哈希从 8 色调色板派生（确定性派生，两台机器对同一台
-- 设备取到同一个颜色），因此颜色不需要同步。
CREATE TABLE IF NOT EXISTS devices (
  install_id    TEXT    PRIMARY KEY CHECK(TRIM(install_id) <> ''),
  label         TEXT    NOT NULL DEFAULT '',
  platform      TEXT    NOT NULL CHECK (platform IN ('windows','android','macos','linux')),
  color         TEXT    NOT NULL DEFAULT '',
  is_self       INTEGER NOT NULL DEFAULT 0 CHECK (is_self IN (0,1)),
  first_seen_ms INTEGER NOT NULL,
  last_seen_ms  INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_devices_self ON devices(is_self) WHERE is_self = 1;

-- ② sessions 加列 -----------------------------------------------------------
-- device_id 的 DEFAULT '' 是**迁移期哨兵**：由 schema_core::adopt_local_rows 在同一个
-- 启动流程里改写成真实 install_id。用 '' 而不是 'local'，是因为 'local' 会与
-- 「本机 id 就叫 local」混淆。任何读路径见到 '' 都是 bug。
--
-- updated_at_ms / synced_seq 属于同步簿记：P1 只落列（写入方 P4 才接），
-- 先落列的理由是把「迁移 28 已在所有机器上跑过」这件事一次性做完，
-- 否则 P4 还要再拆一次 13k 行的表。
ALTER TABLE sessions ADD COLUMN device_id TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN uid TEXT;
ALTER TABLE sessions ADD COLUMN updated_at_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN synced_seq INTEGER;

-- 既有行的写入时刻用「结束时刻，未结束则开始时刻」近似（迁移期一次性，之后由写入方维护）。
UPDATE sessions SET updated_at_ms = COALESCE(end_time, start_time) WHERE updated_at_ms = 0;

-- ③ app_key 生成列 -----------------------------------------------------------
-- 一份归一逻辑，替掉 9 个触发器里 12 处内联 CASE（裁决 C）。
-- 与 models/insight/activity_read_model.rs::normalize_app_key 逐字等价，
-- 由 T03 的等价用例双向断言。
-- VIRTUAL（不落盘）是 ALTER TABLE ADD COLUMN 唯一允许的生成列形态。
ALTER TABLE sessions ADD COLUMN app_key TEXT GENERATED ALWAYS AS (
  CASE
    WHEN TRIM(TRIM(exe_name), ' "') = '' THEN ''
    WHEN INSTR(LOWER(TRIM(TRIM(exe_name), ' "')), ':') > 0
      THEN LOWER(TRIM(TRIM(exe_name), ' "'))
    WHEN LOWER(TRIM(TRIM(exe_name), ' "')) LIKE '%.exe'
      THEN LOWER(TRIM(TRIM(exe_name), ' "'))
    ELSE LOWER(TRIM(TRIM(exe_name), ' "')) || '.exe'
  END
) VIRTUAL;

ALTER TABLE import_exact_sessions ADD COLUMN app_key TEXT GENERATED ALWAYS AS (
  CASE
    WHEN TRIM(TRIM(exe_name), ' "') = '' THEN ''
    WHEN INSTR(LOWER(TRIM(TRIM(exe_name), ' "')), ':') > 0
      THEN LOWER(TRIM(TRIM(exe_name), ' "'))
    WHEN LOWER(TRIM(TRIM(exe_name), ' "')) LIKE '%.exe'
      THEN LOWER(TRIM(TRIM(exe_name), ' "'))
    ELSE LOWER(TRIM(TRIM(exe_name), ' "')) || '.exe'
  END
) VIRTUAL;

ALTER TABLE import_time_buckets ADD COLUMN app_key TEXT GENERATED ALWAYS AS (
  CASE
    WHEN TRIM(TRIM(exe_name), ' "') = '' THEN ''
    WHEN INSTR(LOWER(TRIM(TRIM(exe_name), ' "')), ':') > 0
      THEN LOWER(TRIM(TRIM(exe_name), ' "'))
    WHEN LOWER(TRIM(TRIM(exe_name), ' "')) LIKE '%.exe'
      THEN LOWER(TRIM(TRIM(exe_name), ' "'))
    ELSE LOWER(TRIM(TRIM(exe_name), ' "')) || '.exe'
  END
) VIRTUAL;

-- ④ uid 由库自己发，写入方不许自己拼 -----------------------------------------
-- 放触发器而不是调用点：写入口有四个（Rust tracker / Kotlin / 导入 / 恢复），
-- 漏一个就会出现两种 uid 格式，P4 的分片合并直接失效。
-- 带表前缀 `s:`：否则 sessions.id=7 与 time_records.id=7 会撞同一个 uid。
-- 这条 UPDATE 不会递归触发脏区间（trg_read_model_sessions_update 的 AFTER UPDATE OF
-- 列表里没有 uid），也不会被 uq_sessions_uid 挡下（新值唯一）。
CREATE TRIGGER IF NOT EXISTS trg_sessions_uid AFTER INSERT ON sessions
WHEN NEW.uid IS NULL AND TRIM(NEW.device_id) <> ''
BEGIN
  UPDATE sessions SET uid = 's:' || NEW.device_id || ':' || NEW.id WHERE id = NEW.id;
END;

-- ⑤ 拆「全库单活跃」 --------------------------------------------------------
-- 旧索引 ON sessions((1)) WHERE end_time IS NULL 表达的是「全库只能有一条进行中」，
-- 多设备下它会让第二台设备报 TIMER_ALREADY_RUNNING —— 必须拆成「每设备一条」。
DROP INDEX IF EXISTS idx_sessions_single_active;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_open_per_device
  ON sessions(device_id) WHERE end_time IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_uid
  ON sessions(uid) WHERE uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_device_date
  ON sessions(device_id, start_time);
-- 待同步扫描：只扫 NULL，P4 的 push 直接用 partial index 取增量。
CREATE INDEX IF NOT EXISTS idx_sessions_pending
  ON sessions(updated_at_ms) WHERE synced_seq IS NULL;

-- ⑥ 小时投影按设备重建 -------------------------------------------------------
-- 纯缓存表：不迁数据。P1 只有一台设备，重建后的行数与总和逐位不变，
-- 因为主键多了一维而 device_id 只有一个取值。
DROP TABLE IF EXISTS activity_hourly_effective;

CREATE TABLE activity_hourly_effective (
  bucket_start_ms  INTEGER NOT NULL,
  bucket_end_ms    INTEGER NOT NULL,
  device_id        TEXT    NOT NULL CHECK(TRIM(device_id) <> ''),
  app_key          TEXT    NOT NULL CHECK(TRIM(app_key) <> ''),
  raw_exe_name     TEXT    NOT NULL CHECK(TRIM(raw_exe_name) <> ''),
  display_app_name TEXT    NOT NULL DEFAULT '',
  origin           TEXT    NOT NULL CHECK(origin IN ('native','import_exact','import_bucket')),
  source_id        TEXT    NOT NULL,
  effective_duration_ms INTEGER NOT NULL CHECK(effective_duration_ms > 0),
  computed_revision INTEGER NOT NULL CHECK(computed_revision >= 0),
  updated_at_ms    INTEGER NOT NULL DEFAULT 0 CHECK(updated_at_ms >= 0),
  PRIMARY KEY(bucket_start_ms, device_id, app_key, origin, source_id),
  CHECK(bucket_end_ms > bucket_start_ms),
  CHECK(effective_duration_ms <= bucket_end_ms - bucket_start_ms)
);

CREATE INDEX IF NOT EXISTS idx_activity_hourly_range
  ON activity_hourly_effective(bucket_start_ms, bucket_end_ms);
CREATE INDEX IF NOT EXISTS idx_activity_hourly_device_range
  ON activity_hourly_effective(device_id, bucket_start_ms);
CREATE INDEX IF NOT EXISTS idx_activity_hourly_app_range
  ON activity_hourly_effective(app_key, bucket_start_ms, effective_duration_ms);

-- ⑦ 日级双口径 --------------------------------------------------------------
-- 不变式：**只存完整的天**（day_end <= now）。今天由读命令现算 —— 今天的「现在」
-- 每 3 秒变一次，落表必然滞后且无法自证。
-- device_scope='*'        → 全设备并集(union_ms, ≤24h) / 各设备之和(device_sum_ms, 可 >24h)
-- device_scope=<install_id> → 该设备自己的墙钟，两列恒等（由 CHECK 钉住）
CREATE TABLE IF NOT EXISTS activity_daily_totals (
  day_key           TEXT    NOT NULL CHECK(length(day_key) = 10),
  device_scope      TEXT    NOT NULL CHECK(TRIM(device_scope) <> ''),
  union_ms          INTEGER NOT NULL CHECK(union_ms >= 0),
  device_sum_ms     INTEGER NOT NULL CHECK(device_sum_ms >= 0),
  device_count      INTEGER NOT NULL CHECK(device_count >= 0),
  computed_revision INTEGER NOT NULL CHECK(computed_revision >= 0),
  updated_at_ms     INTEGER NOT NULL DEFAULT 0 CHECK(updated_at_ms >= 0),
  PRIMARY KEY(day_key, device_scope),
  CHECK(device_scope = '*' OR union_ms = device_sum_ms)
);

CREATE INDEX IF NOT EXISTS idx_activity_daily_scope
  ON activity_daily_totals(device_scope, day_key);

-- ⑧ 让小时投影与日表全量重建 ------------------------------------------------
-- 表结构变了（主键多了 device_id），老投影行即使读得出来也不能再用。
-- 置 invalid + 清 coverage 是**唯一**能让 initialize_backfill 真的重算的写法：
-- 增量重算会以为覆盖还在，于是日级表算出空洞。
UPDATE read_model_state
   SET state = 'invalid', coverage_start_ms = NULL, coverage_end_ms = NULL,
       backfill_cursor_ms = NULL,
       updated_at_ms = CAST(strftime('%s','now') AS INTEGER) * 1000
 WHERE model_name = 'activity_hourly';
