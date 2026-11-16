-- =============================================================================
-- Timing 业务库迁移 0014（0.14.x · 同步事件流基础设施）
-- 变更：新增两张**纯新表**
--   · sync_event_cursor —— 事件流下载游标（「从对端设备读到哪」，§1.2）
--   · md_decision_audit  —— md 覆盖提醒的决策审计（只 append，§1.4）
-- 版本：schema.version = 14
--
-- 为什么编号是 0014：0.12.5 的 `app_usage_span`（v12）与 0.12.8 的碎段清理（v13）先落地了。
-- 两条线并行开发时这里是 0012，合流时必须改号——版本门是 `if schema_version < 14`，
-- 而存量库在合流后已经是 13，同一版本号的两份迁移只能有一份真的跑。
--
-- 为什么是「只建新表 + 推进版本」的简单单文件（与 0006 / 0008 同型）：
-- 两张表在旧库里都不存在，没有「补列」、没有触发器、没有重建 —— 既不撞 K-13
-- （SQLite 无 `ADD COLUMN IF NOT EXISTS`），也没有「只许跑一次」的语义。
--
-- 为什么版本推进必须由 Rust 侧版本门包住（infra/migrate.rs `if schema_version < 14`）：
-- `UPDATE settings SET value='14'` 本身幂等，但它**会把更高的版本号改写回 14**。
-- 将来 0015 落地后，若本文件每次启动都跑，就会把 15 打回 14，让 0015 永远重跑。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- sync_event_cursor：事件流下载游标（§1.2 / §3 EventCursor）
--
--   device_id   对端设备 id（12 位小写 hex，identity.rs INSTALL_ID_LEN=12）。
--               每台对端设备一行；本机不给自己记游标（自己不 pull 自己）。
--   last_op_id  已读到的最新 op_id（timer_ops.op_id 单调递增，天然是进度上界）。
--   last_seq    已读到的最新分段序号（sync/events/<device_id>/<seq>.jsonl）。
--
-- 下载 = 读「op_id > last_op_id」的行，uid 唯一索引 upsert 去重（重复同步安全）。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_event_cursor (
  device_id  TEXT    PRIMARY KEY,          -- 对端设备 id（12 位小写 hex）
  last_op_id INTEGER NOT NULL DEFAULT 0,   -- 已读到的最新 op_id
  last_seq   INTEGER NOT NULL DEFAULT 0    -- 已读到的最新分段序号
);

-- -----------------------------------------------------------------------------
-- md_decision_audit：md 覆盖提醒的决策审计（§1.4 / §3 MdDecisionAudit）
--
--   只 append、永不读回改行为（§7 team-lead 决策 #3：审计供后查，不影响后续默认）。
--   at_ms      用户按下选择那刻的毫秒时刻（语义时刻，不是写库时刻）。
--   kind       MdSyncKind::as_str()（timers / notes / todos / app_usage / items）。
--   heading    冲突区块的标题行（含 # 前缀，如 "#### 事项计时"）。
--   direction  决策方向，词汇表见下。**刻意不加 CHECK** —— 见坑 1 的说明。
--
-- direction 词汇（T03 决策状态机落地前先用 TEXT 表达，不把词汇钉死成两态）：
--   overwrite_timing  A：md → SQL（用户选「覆盖 Timing」）
--   keep_timing       B：SQL → md（用户选「保留 Timing」）
--   deferred          C：暂不处理（挂回 PendingDecision）
--
-- 坑 1（§8.1）预留：「md → SQL 且合成等价 timer_ops 事件」这条语义必须可表达，
-- 不能只两态。若 T03 落地时选择合成事件的方案，在 overwrite_timing 之外另立一个
-- 方向值（如 overwrite_timing_synth），而不是靠加列或改 CHECK —— 本列不加 CHECK
-- 正是为了不把词汇表在 schema 层钉死。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS md_decision_audit (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,  -- 稳定 append 顺序（at_ms 可能同刻碰撞）
  at_ms     INTEGER NOT NULL,                   -- 决策时刻（毫秒）
  kind      TEXT    NOT NULL,                   -- MdSyncKind::as_str()
  heading   TEXT    NOT NULL,                   -- 冲突区块标题行
  direction TEXT    NOT NULL                    -- 决策方向（见上词汇表，不加 CHECK）
);

-- 版本推进：schema.version = 14
UPDATE settings SET value = '14', updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'schema.version';
