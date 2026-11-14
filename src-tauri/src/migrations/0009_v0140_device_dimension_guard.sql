-- =============================================================================
-- Timing 业务库迁移 0009 —— **幂等抵消段**（每次启动无条件执行）
--
-- ⚠️ 这个文件不能并进上面那个「一次性段」，也不能加版本门。原因是一条已核实的
-- 顺序事实：
--
--   `infra/migrate.rs` 启动时**无条件**重跑 `0001`–`0006`（它们全是 IF NOT EXISTS，
--   天然幂等），而 `0002_v020.sql` 里有：
--
--     CREATE UNIQUE INDEX IF NOT EXISTS uq_records_open
--       ON time_records(status) WHERE status = 'active';
--
--   即「全库只能有一条进行中」的旧索引**每次启动都会复活**。
--   所以下面的 DROP 是唯一的抵消点：它必须排在 0002 之后、每次启动都跑。
--   漏掉它 = 第一次启动自测全绿、第二次启动多设备计时退化（第二台设备报
--   TIMER_ALREADY_RUNNING），而且报错指向的索引名会把人带向错误的方向。
--
-- 本文件里的每条语句都幂等（DROP IF EXISTS / CREATE IF NOT EXISTS / CREATE TRIGGER
-- IF NOT EXISTS），重复执行无副作用，这是它能「每次启动跑」的前提。
-- =============================================================================

-- 拆「全库单活跃」→「每设备单活跃」。
DROP INDEX IF EXISTS uq_records_open;

-- 注意：既有行与新建行的 device_id 都是 DEFAULT ''（迁移期哨兵），此时本索引等价于
-- 「全库一条活跃」，也就是 P1 单设备形态下与旧索引完全一致的行为。
CREATE UNIQUE INDEX IF NOT EXISTS uq_records_open_per_device
  ON time_records(device_id) WHERE status = 'active';

-- 同步身份。带表前缀 `t:`：否则 time_records.id=7 与 sessions.id=7 会撞同一个 uid。
CREATE UNIQUE INDEX IF NOT EXISTS uq_time_records_uid
  ON time_records(uid) WHERE uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_records_device_started
  ON time_records(device_id, started_at);

-- uid 由库自己发（写入口不止一个：计时落库 / 手改 / md 导入 / 恢复）。
-- `TRIM(NEW.device_id) <> ''` 是哨兵守卫：device_id 还是 '' 时不生成 uid，
-- 否则会写出一批 `t::12` 这种半截身份，而 uid 一旦落库就不再重算。
CREATE TRIGGER IF NOT EXISTS trg_time_records_uid AFTER INSERT ON time_records
WHEN NEW.uid IS NULL AND TRIM(NEW.device_id) <> ''
BEGIN
  UPDATE time_records SET uid = 't:' || NEW.device_id || ':' || NEW.id WHERE id = NEW.id;
END;
