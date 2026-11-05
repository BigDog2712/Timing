//! 时钟：持久化口径用墙钟（UTC 毫秒），进程内增量用单调时钟。
//!
//! 为什么必须两种都有：
//! - **墙钟**是唯一能跨进程重启对齐的口径（`started_at` / `ended_at` / `reminded_at` 落库都是它）；
//! - 但墙钟会被 NTP 校时、手动改时、时区/夏令时拉走。若只用墙钟算「本次运行了多久」，
//!   一次校时就能让读数前跳或回拨（回拨还会被 `delta <= 0` 静默吞掉一段时长）。
//! - **单调时钟**（`std::time::Instant`）不受校时影响，适合算「进程内流逝了多少」。
//!
//! 落地方式见 `services::timer::live_duration`：以 `Instant` 锚点为基准推进，
//! 墙钟只在落库与跨重启时使用。`WallAnchor` 就是那个锚点。

use std::sync::Mutex;
use std::time::Instant;

/// 当前 UTC epoch 毫秒（持久化口径）。
pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// 本地时区「今天 00:00」的 epoch 毫秒。
///
/// 待办的三条今日口径共用它：只显示今天 / 过期淡化 / 跨天清理（ADR-032）。
/// 夏令时缺口（极少数时区的 00:00 不存在）取该日的**最早**有效时刻，取不到就退回当前时刻
/// —— 宁可少清一轮，也不要在时钟异常时把整天当作「过去」批量删光。
pub fn start_of_today_ms() -> i64 {
    use chrono::Local;
    let now = Local::now();
    match now.date_naive().and_hms_opt(0, 0, 0) {
        Some(midnight) => midnight
            .and_local_timezone(Local)
            .earliest()
            .map(|dt| dt.timestamp_millis())
            .unwrap_or_else(|| now.timestamp_millis()),
        None => now.timestamp_millis(),
    }
}

/// 本地日期 `date` 的 `[当天 00:00, 次日 00:00)` epoch 毫秒。
///
/// 三个地方共用同一条日界：Markdown 按天取数、跨零点分段、待办的「今天」口径。
/// 放在 `platform` 而不是某个 service 里，是因为它只依赖时区，与业务无关。
///
/// 夏令时缺口（极少数时区的 00:00 不存在）按 30 分钟粒度向后摸索到第一个真实存在的
/// 时刻（最多 1.5 小时，覆盖所有已知 DST 跳变量），彻底失败了才退回同刻 UTC——
/// **绝不返回 0**：`unwrap_or(0)` 会让「当天」变成 1970，一次同步就能把全部历史灌进来
/// （V0.11.2 修的那个 bug）。
pub fn day_bounds(date: chrono::NaiveDate) -> (i64, i64) {
    use chrono::{Local, NaiveDateTime, TimeZone};

    let start = date.and_hms_opt(0, 0, 0).expect("合法日期");
    let next = date
        .succ_opt()
        .unwrap_or(date)
        .and_hms_opt(0, 0, 0)
        .expect("合法日期");
    let to_ms = |naive: NaiveDateTime| {
        for step in 0..=3u32 {
            let probe = naive + chrono::Duration::minutes(i64::from(step) * 30);
            if let Some(dt) = Local.from_local_datetime(&probe).earliest() {
                return dt.timestamp_millis();
            }
        }
        naive.and_utc().timestamp_millis()
    };
    (to_ms(start), to_ms(next))
}

/// 墙钟锚点：记录「某个墙钟时刻对应哪个单调时刻」。
///
/// 用法：会话开始时把 `running_since`（墙钟）与 `Instant::now()` 一起记下；
/// 之后用 `elapsed_since_anchor()` 取进程内的真实流逝，**完全绕开墙钟**。
#[derive(Debug)]
pub struct WallAnchor {
    /// 锚点的墙钟毫秒（对应 `running_since`）
    pub wall_ms: i64,
    /// 锚点的单调时刻
    pub mono: Instant,
}

impl WallAnchor {
    pub fn new(wall_ms: i64) -> Self {
        Self {
            wall_ms,
            mono: Instant::now(),
        }
    }

    /// 自锚点以来经过的毫秒数（单调，不受校时影响）。
    pub fn elapsed_ms(&self) -> i64 {
        self.mono.elapsed().as_millis().min(i64::MAX as u128) as i64
    }
}

/// 进程级锚点表：`wall_ms -> 单调时刻`。
///
/// 为什么是表而不是单槽：Timing 同一时刻只有一个 active 会话，但**测试与恢复流程**
/// 会短时并存多个墙钟起点；单槽会让「后锚定的把先锚定的顶掉」，表现为随机失败。
/// 按墙钟键控后，查询只认自己那个起点，互不串账。容量上限 8（超出丢最旧），
/// 只用于防泄漏——正常运行时同时最多 1 条。
static ANCHORS: Mutex<Vec<WallAnchor>> = Mutex::new(Vec::new());
const MAX_ANCHORS: usize = 8;

/// 设置锚点（会话开始 / 恢复 / 折账后重新锚定时调用）。
pub fn anchor(wall_ms: i64) {
    if let Ok(mut anchors) = ANCHORS.lock() {
        anchors.retain(|a| a.wall_ms != wall_ms);
        anchors.push(WallAnchor::new(wall_ms));
        if anchors.len() > MAX_ANCHORS {
            anchors.remove(0);
        }
    }
}

/// 移除指定起点对应的锚点（暂停 / 结束 / 丢弃时调用）。
///
/// 只删自己那条：并发调用不会误伤别的会话（这是单槽版本的真实 bug）。
pub fn clear_anchor(wall_ms: i64) {
    if let Ok(mut anchors) = ANCHORS.lock() {
        anchors.retain(|a| a.wall_ms != wall_ms);
    }
}

/// 清空所有锚点（进程退出 / 测试隔离用）。
pub fn clear_all_anchors() {
    if let Ok(mut anchors) = ANCHORS.lock() {
        anchors.clear();
    }
}

/// 自锚点以来的单调毫秒；找不到对应起点返回 `None`
/// （说明锚点缺失：进程刚重启或该记录由测试直接构造，调用方应回落到墙钟差值）。
pub fn anchored_elapsed_ms(running_since: i64) -> Option<i64> {
    let anchors = ANCHORS.lock().ok()?;
    anchors
        .iter()
        .find(|a| a.wall_ms == running_since)
        .map(|a| a.elapsed_ms())
}
