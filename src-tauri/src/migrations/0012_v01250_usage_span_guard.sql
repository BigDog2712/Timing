-- =============================================================================
-- Timing 业务库迁移 0012（0.12.5 · 应用使用的具体时段）—— **幂等段**（每次启动无条件执行）
--
-- 与 0009 / 0010 / 0011 的 guard 同一个处置理由：`infra/migrate.rs` 每次启动都重跑
-- 0001–0006，任何「只建一次」的东西都不能靠版本门；本文件每条语句本身幂等
-- （CREATE ... IF NOT EXISTS），所以每次跑都安全。
--
-- ## 为什么要这张表
-- `app_usage` 只记「某天某应用一共用了多久」，回答不了「9:00-9:30、10:00-10:10」这种
-- 「分几次用的」。而**系统只留约 7 天明细**（`UsageStatsManager.queryEvents`），
-- 不落库的话第 8 天起这段历史就永久消失 —— 与 `app_usage` 存在的理由完全同源
-- （见 0008 的「为什么不每次问系统要」）。
--
-- ## 只存配对后的区间，不存原始事件
-- 一次 `ACTIVITY_RESUMED` + 一次 `ACTIVITY_PAUSED` 才折成一条 `[start_ms, end_ms)`。
-- 原始事件里的 `SCREEN_NON_INTERACTIVE` / `KEYGUARD_SHOWN` 只参与配对、不该露脸，
-- 存进来只会让表大一倍且无法解释。
--
-- ## 与 `app_usage` 的关系
-- 同一天同一包的两份视图，**不是**父子：`app_usage.foreground_sec` 是秒级汇总
-- （跨次累加），本表是区间明细。两者都由同一次桥回值写入，彼此不校验 ——
-- 校验会让「系统回收了明细但汇总还在」这种正常情况变成一条写不进去的错误。
--
-- ## 为什么主键含 `start_ms`
-- 重复上报同一天只会更完整，不会变小（与 0008 的 MAX 同一条纪律）。主键取
-- `(package_name, local_date, start_ms)`，同一段重扫就 UPDATE `end_ms = MAX(...)`；
-- 万一同一个起点出现了更短的段（明细被裁剪过），也只会被更长的那个覆盖，不会变短。
-- 一天里断成多段时起点各不相同，天然多行。
-- =============================================================================

CREATE TABLE IF NOT EXISTS app_usage_span (
  package_name TEXT    NOT NULL,             -- Android 包名，如 com.tencent.mm
  local_date   TEXT    NOT NULL,             -- yyyy-MM-dd（本地时区，与 app_usage 同口径）
  start_ms     INTEGER NOT NULL,             -- 进入前台的毫秒时刻（含）
  end_ms       INTEGER NOT NULL,             -- 离开前台的毫秒时刻（不含）
  updated_at   INTEGER NOT NULL DEFAULT 0,   -- 本行最后写入时刻
  PRIMARY KEY (package_name, local_date, start_ms)
);

-- 读法只有一种：「某一天的全部段，按包、按时间」。索引跟着读法走。
CREATE INDEX IF NOT EXISTS idx_app_usage_span_date
  ON app_usage_span (local_date, package_name, start_ms);
