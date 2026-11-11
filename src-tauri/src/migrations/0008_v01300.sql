-- =============================================================================
-- Timing 数据库迁移 0008（0.13.0 · 安卓应用使用统计）
-- 变更：新增 app_usage —— 按「包名 + 本地日」聚合的前台时长。
--
-- 为什么落库而不是每次问系统要（方案书 §2②）：
--   1. UsageStatsManager 只保留最近几天的明细事件（各 ROM 常见 7 天），更早的历史只能靠
--      我们自己记；不落库就永远只有「今天」。
--   2. 趋势图 / 昨日对比要跨天，系统接口给不了跨窗口聚合。
--
-- 只存事实：包名 + 秒 + 首末见时刻。**不存**应用显示名与分类 —— 那两样会变
-- （改名、用户改分类），存进来就成了过期副本，排在读取时现查/现算。
--
-- foreground_sec 语义：**当天累计的前台秒数**（同一包当天多次进入前台会累加）。
-- 重复上报同一天时取 MAX（系统给的是权威值，重扫只会更准，不该被更小的值覆盖）。
-- =============================================================================

CREATE TABLE IF NOT EXISTS app_usage (
  package_name   TEXT    NOT NULL,             -- Android 包名，如 com.tencent.mm
  local_date     TEXT    NOT NULL,             -- yyyy-MM-dd（本地时区，与 md 同步同口径）
  foreground_sec INTEGER NOT NULL DEFAULT 0,   -- 当天累计前台秒数
  first_seen_at  INTEGER NOT NULL DEFAULT 0,   -- 当天第一次进入前台的毫秒时刻
  last_seen_at   INTEGER NOT NULL DEFAULT 0,   -- 当天最后一次离开前台的毫秒时刻
  updated_at     INTEGER NOT NULL DEFAULT 0,   -- 本行最后写入时刻
  PRIMARY KEY (package_name, local_date)
);

-- 读法只有一种：「某一天的全部包，按时长降序」。索引跟着读法走。
CREATE INDEX IF NOT EXISTS idx_app_usage_date ON app_usage (local_date, foreground_sec DESC);

-- 版本推进：schema.version = 8
-- 与 0006 / 0007 同一写法（版本号写在 SQL 里，不靠 Rust 侧再补一次）。
UPDATE settings SET value = '8', updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'schema.version';
