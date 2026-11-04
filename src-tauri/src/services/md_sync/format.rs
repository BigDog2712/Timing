//! Markdown 区块的纯格式化 / 解析（不碰文件、不碰数据库）。
//!
//! 本文件只放**计时**（Planner 兼容）与共享类型；便利贴表格在 `format/notes.rs`，
//! 待办清单在 `format/todos.rs`，时间解析 / 日界 / 计划时间在 `format/time.rs`
//! ——单文件 ≤300 行纪律，不是随意拆的。
//!
//! ## 计时区块
//!
//! ~~~text
//! - [ ] 事项名
//!   ```yaml
//!   planner:
//!     log:
//!       - start: 2026-10-14 00:30:51
//!         end: 2026-10-14 01:07:41
//!         duration: 36m50s
//!   ```
//! ~~~
//!
//! 这是用户往日日记里的既有格式（Obsidian Planner 插件可读）。解析时只认
//! `- [ ]` / `- [x]` 清单项与 `start:` / `end:` 两行，其余文字一律忽略——
//! 用户可以在区块里写注释，不会被当成数据。
//!
//! 「正在计时」的段会多一行 `ongoing: true`（见 `TimerInterval`），仍是合法 YAML，
//! Planner 照旧能读；宿主用它把实时段与真实数据区分开。
//!
//! `duration:` 是**只给人看的派生值**（Planner 忽略未知键）：`start`/`end` 是墙钟跨度，
//! 应用关闭或电脑休眠期间 TickBar 不累计（`timer::resolve_open` 的 R-2），两者会分叉
//! ——一段 `09:18 → 14:40` 可能只计到 46 分钟。见 `TimerInterval::duration_sec`。

pub mod notes;
mod time;
pub mod todos;

pub use notes::{parse_notes, render_notes};
pub use time::{
    day_bounds, floor_to_minute, format_duration, format_minute, format_ts, parse_duration,
    parse_planned, parse_ts,
};
pub use todos::{parse_todos, render_todos, TodoRow};

/// 一段计时（epoch ms）。
///
/// ## `ongoing` 为什么必须跟着数据走
///
/// 正在计时的记录也要出现在区块里（用户口径：进行中的计时要「开始时间 → 当前时间」
/// 实时可见），但它**还没有结束时刻**：导出时只能写一个近似值（渲染那一刻，对齐到整分钟）。
/// 若不加标记，这个近似值在导入路径上会被当成用户编辑，把假 `end` 写回数据库，
/// 改写 active 记录的时长（甚至插出一条重复的 saved 记录）。
///
/// 所以实时段自带 `ongoing: true`，导入侧见到它要判断「这是不是宿主写出的坐标」：
/// 命中就剔除，不命中（用户手写）就降级为普通段照常入库。判定逻辑在
/// `services::md_sync::import::timers`（`trusted_placeholders` / `drop_placeholders`），
/// 为什么按标记判断最稳：①只有宿主会写这个标记，用户手写的完成段不会带；②它与数据库
/// 里的 active 状态无关，所以「导出后用户刚好点了停止」这个竞态里仍然认得出来（按
/// active 状态判断会在这一刻失效）；③不依赖任何时间取值，跨分钟 / 跨时区都不会误判。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TimerInterval {
    pub start_ms: i64,
    pub end_ms: i64,
    /// `true` = 实时段：`end_ms` 是渲染时刻的近似值，不是数据库事实。
    pub ongoing: bool,
    /// 这段**真正计到的秒数**（数据库 `accumulated_sec`）。
    ///
    /// `None` = 调用方没提供（用户手写、或纯格式用例），此时不写 `duration:` 行。
    ///
    /// 为什么不能从 `end_ms - start_ms` 推：两者会分叉。应用关闭、电脑休眠期间
    /// TickBar 不累计（`timer::resolve_open` 的 R-2），所以墙钟跨度 `09:18 → 14:40`
    /// 的那段可能只计到 46 分钟。只写 start/end，读日记的人会把墙钟跨度当成工作时长。
    ///
    /// **它永远不参与导入**：`import::apply_timers` 一律先 `strip_durations`，
    /// 落库的 `accumulated_sec` 仍由 `(start, end)` 反推（既有语义，见该模块）。
    pub duration_sec: Option<i64>,
}

impl TimerInterval {
    /// 已保存的一段（库里的 `started_at` / `ended_at`）。
    pub fn saved(start_ms: i64, end_ms: i64) -> Self {
        Self {
            start_ms,
            end_ms,
            ongoing: false,
            duration_sec: None,
        }
    }

    /// 进行中的一段：`end_ms` 是渲染时刻的近似值，导入时会被跳过。
    pub fn live(start_ms: i64, end_ms: i64) -> Self {
        Self {
            start_ms,
            end_ms,
            ongoing: true,
            duration_sec: None,
        }
    }

    /// 附上真实累计秒数，渲染时多写一行 `duration:`（纯展示，不影响导入）。
    pub fn with_duration(self, sec: i64) -> Self {
        Self {
            duration_sec: Some(sec),
            ..self
        }
    }
}

/// 一个事项下的若干段计时（Planner 的一个清单项）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimerEntry {
    pub item: String,
    pub intervals: Vec<TimerInterval>,
}

impl TimerEntry {
    pub fn new(item: impl Into<String>) -> Self {
        Self {
            item: item.into(),
            intervals: Vec::new(),
        }
    }
}

/// 表格里的一行便利贴。`id=None` = Markdown 里新加的行。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteRow {
    pub id: Option<i64>,
    pub updated_ms: i64,
    pub item: Option<String>,
    pub content: String,
}

/// 把计时分组渲染成 Planner 能读的区块内容（不含标题行）。
pub fn render_timers(entries: &[TimerEntry]) -> String {
    let mut sorted: Vec<TimerEntry> = entries
        .iter()
        .filter(|entry| !entry.intervals.is_empty())
        .cloned()
        .collect();
    sorted.sort_by_key(|entry| {
        entry
            .intervals
            .iter()
            .map(|interval| interval.start_ms)
            .min()
            .unwrap_or(i64::MAX)
    });

    let mut out = String::new();
    for entry in &sorted {
        out.push_str(&format!("- [ ] {}\n", sanitize_name(&entry.item)));
        out.push_str("  ```yaml\n");
        out.push_str("  planner:\n");
        out.push_str("    log:\n");
        let mut intervals = entry.intervals.clone();
        intervals.sort_by_key(|interval| interval.start_ms);
        for interval in intervals {
            out.push_str(&format!(
                "      - start: {}\n        end: {}\n",
                format_ts(interval.start_ms),
                format_ts(interval.end_ms)
            ));
            /* 真实累计时长：Planner 忽略这一行，人读的时候能看出「墙钟跨度 ≠ 工作时长」。 */
            if let Some(sec) = interval.duration_sec {
                out.push_str(&format!("        duration: {}\n", format_duration(sec)));
            }
            /* 实时段的标记：只增一行，不改变 Planner 能读的结构。 */
            if interval.ongoing {
                out.push_str("        ongoing: true\n");
            }
        }
        out.push_str("  ```\n");
    }
    out.trim_end().to_string()
}

/// 解析计时区块。没有有效 `start` / `end` 的清单项会被丢弃。
///
/// `ongoing: true`（宿主编写的实时段标记）原样读回，供导入路径识别并跳过。
pub fn parse_timers(body: &str) -> Vec<TimerEntry> {
    let mut entries: Vec<TimerEntry> = Vec::new();
    let mut current: Option<usize> = None;
    let mut pending_start: Option<i64> = None;
    /* 刚压入的那一段在 `intervals` 里的下标：`ongoing:` 只紧跟它自己的 `end:`。 */
    let mut pending_index: Option<usize> = None;

    for raw in body.lines() {
        let line = raw.trim();
        if line.starts_with('#') {
            current = None;
            pending_start = None;
            pending_index = None;
            continue;
        }
        if let Some(name) = checkbox_name(line) {
            let name = sanitize_name(name);
            if name.is_empty() {
                current = None;
                continue;
            }
            let index = match entries.iter().position(|entry| entry.item == name) {
                Some(index) => index,
                None => {
                    entries.push(TimerEntry::new(name));
                    entries.len() - 1
                }
            };
            current = Some(index);
            pending_start = None;
            pending_index = None;
            continue;
        }
        let Some(index) = current else { continue };
        if let Some(value) = yaml_value(line, "start:") {
            pending_start = parse_ts(value);
            pending_index = None;
        } else if let Some(value) = yaml_value(line, "end:") {
            let Some(start_ms) = pending_start.take() else {
                continue;
            };
            let Some(end_ms) = parse_ts(value) else {
                continue;
            };
            if end_ms > start_ms {
                entries[index]
                    .intervals
                    .push(TimerInterval::saved(start_ms, end_ms));
                pending_index = Some(entries[index].intervals.len() - 1);
            }
        } else if let Some(value) = yaml_value(line, "duration:") {
            /* 只认紧跟在 `end:` 之后的那一段；不 take `pending_index`，
            因为同一段后面可能还有 `ongoing:`。 */
            if let Some(position) = pending_index {
                entries[index].intervals[position].duration_sec = parse_duration(value);
            }
        } else if let Some(value) = yaml_value(line, "ongoing:") {
            /* 只认紧跟在 `end:` 之后的那一行，散文里的同形文字不会被误判。 */
            if let Some(position) = pending_index.take() {
                if matches!(value.trim(), "true" | "yes" | "1") {
                    entries[index].intervals[position].ongoing = true;
                }
            }
        }
    }

    entries.retain(|entry| !entry.intervals.is_empty());
    for entry in &mut entries {
        entry.intervals.sort_by_key(|interval| interval.start_ms);
    }
    entries.sort_by_key(|entry| {
        entry
            .intervals
            .first()
            .map(|interval| interval.start_ms)
            .unwrap_or(i64::MAX)
    });
    entries
}

/// 清掉所有 `duration_sec`（**导入路径专用**）。
///
/// 导入只认 `(start, end)`：`duration` 是渲染时算出来的派生值，不参与落库。
/// 不清掉会有两个后果：①用户手改了 `duration` 行 → `old != new` 成了假差异，白跑一遍
/// 导入流程；②`old == new` 的早退在此之前就把「文件其实没变」判成「变了」，
/// 连带触发不必要的比价与写盘判定。
pub fn strip_durations(entries: &mut [TimerEntry]) {
    for entry in entries.iter_mut() {
        for interval in &mut entry.intervals {
            interval.duration_sec = None;
        }
    }
}

/// 取 `key:` 后面的值；允许 YAML 序列前缀 `- key:`。
fn yaml_value<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let rest = line.strip_prefix("- ").unwrap_or(line);
    rest.strip_prefix(key)
}

fn checkbox_name(line: &str) -> Option<&str> {
    for prefix in ["- [ ]", "- [x]", "- [X]", "* [ ]", "* [x]", "* [X]"] {
        if let Some(rest) = line.strip_prefix(prefix) {
            return Some(rest);
        }
    }
    None
}

fn sanitize_name(raw: &str) -> String {
    raw.replace(['\n', '\r'], " ").trim().to_string()
}
