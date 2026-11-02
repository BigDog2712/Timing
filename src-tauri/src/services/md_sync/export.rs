//! SQL → Markdown：按天取数并渲染成区块内容。
//!
//! ## 三种落点各自「属于哪一天」
//!
//! | 种类 | 归属规则 | 理由 |
//! |---|---|---|
//! | 事项计时 | `started_at` 落在当天 | 记录天然有那一天 |
//! | 便利贴 | 当天创建或当天改过 | 便签按「动过的时间」归日 |
//! | 待办事项 | 未完成、且计划时间**不在**当天 | 区块表达「计划在未来完成的内容」 |
//!
//! 之所以强调这些边界：日记是「那一天的记录」。把跨天的对象全量写进每一天，
//! 换一篇日记就换一份副本，读者分不清哪份是真的。
//!
//! ## 进行中的记录也要上屏（V0.4.1）
//!
//! 用户口径：「正在计时的记录不会出现在日记的事项计时区块里」。修复分两处：
//!
//! 1. 取数不再只认 `status='saved'`（`repo::active_record_in_day`）；
//! 2. 实时段按「开始时刻 → 当前时刻」渲染并打上 `ongoing: true`，导入路径据此跳过它
//!    ——为什么这样最安全写在 `format::TimerInterval` 的注释里。
//!
//! ## 跨天的进行中会话（已知限制）
//!
//! 所有按天取数都按 `started_at` 归日，所以昨天 23:00 开始、现在还在跑的会话出现在
//! **昨天**的文件里，今天的区块不会画它。做成「今天也画一段」需要把 start 裁到今天
//! 0 点，代价是：这条会话一旦停止，它就带着昨天的 `started_at` 落库、从今天的区块里
//! 消失——用户会以为「刚停就丢了」，比看不到更糟。权衡后保留现状。

use chrono::NaiveDate;
use sqlx::SqlitePool;

use crate::error::AppResult;
use crate::models::md_sync::MdSyncKind;
use crate::platform::clock::now_ms;
use crate::repositories::md_sync as repo;
use crate::repositories::md_sync_todo as repo_todo;

use super::format::{self, NoteRow, TimerEntry, TimerInterval, TodoRow};

/// 渲染结果 + 该范围内的最大更新时间（冲突判定用）。
pub struct Exported {
    pub body: String,
    pub latest_update: i64,
}

/// 某天的计时区块（进行中的段用系统当前时刻渲染）。
pub async fn timers(pool: &SqlitePool, date: NaiveDate) -> AppResult<Exported> {
    timers_at(pool, date, now_ms()).await
}

/// `now` 显式传入的版本：渲染结果只由「数据库 + now」决定，用例因此能断言到秒。
pub async fn timers_at(pool: &SqlitePool, date: NaiveDate, now: i64) -> AppResult<Exported> {
    let (from, to) = format::day_bounds(date);
    let rows = repo::records_for_day(pool, from, to).await?;
    let mut entries: Vec<TimerEntry> = Vec::new();

    for row in &rows {
        let Some(end_ms) = row.ended_at else {
            continue;
        };
        if end_ms <= row.started_at {
            continue;
        }
        push_interval(
            &mut entries,
            &row.item_name,
            /* `duration` 用库里的真实累计，而不是 `end - start`：应用关闭 / 电脑休眠
            期间不累计，墙钟跨度会远大于实际工作时长。 */
            TimerInterval::saved(row.started_at, end_ms).with_duration(row.accumulated_sec),
        );
    }

    if let Some(active) = repo::active_record_in_day(pool, from, to).await? {
        if let Some(interval) = live_interval(&active, now) {
            push_interval(&mut entries, &active.item_name, interval);
        }
    }

    Ok(Exported {
        body: format::render_timers(&entries),
        /* 只统计 saved 行的 `updated_at`：active 行每 15s 被 `flush_active` 推进一次，
        若把它算进来，`latest_update` 会永远「刚刚更新」，冲突判定就总判给数据库侧，
        把用户刚写进文件的内容覆盖掉。 */
        latest_update: repo::latest_record_update(pool, from, to).await?,
    })
}

/// 把一段计时挂到事项名下（还没出现过的事项先建一个清单项）。
fn push_interval(entries: &mut Vec<TimerEntry>, item_name: &str, interval: TimerInterval) {
    let index = match entries.iter().position(|entry| entry.item == item_name) {
        Some(index) => index,
        None => {
            entries.push(TimerEntry::new(item_name));
            entries.len() - 1
        }
    };
    entries[index].intervals.push(interval);
}

/// 进行中的那一段怎么画——**渲染策略的唯一定义处**，改之前先读完取舍。
///
/// - **正在跑**（`running_since` 非空）：`开始时刻 → 当前时刻`，`end` 对齐到**整分钟**。
///   不对齐到秒，是因为轮询每 2s 一轮：秒级 `end` 意味着每 2 秒重写整篇日记，Obsidian
///   会不停重载、OneDrive 会反复上传。对齐到分钟后，同一分钟内渲染文本完全一致，
///   `sync_binding` 的正文比较就不会触发写盘；肉眼仍是「实时」（最多落后 59 秒）。
/// - **暂停中**（`running_since` 为空）：用「已计到的位置」`started_at + accumulated_sec`
///   当 end，冻结不动（同样对齐到整分钟，且不超过当前时刻）。暂停期间没有流逝，写
///   「当前时刻」会让没在计的段越画越长；而完全不画，又会让用户在区块里找不到这条
///   还在的会话——正是这次要修的「以为同步坏了」。
/// - **不足一分钟**（对齐后的 end 不晚于 start）先不画：既避免写出**未来时刻**，
///   也避免出现零长度段（`parse_timers` 要求 end > start，零长度段会破坏
///   「渲染出来的一定能解析回去」这条不变式）。下一分钟边界自然出现。
fn live_interval(active: &repo::RecordWithItem, now: i64) -> Option<TimerInterval> {
    let start_ms = active.started_at;
    let end_ms = match active.running_since {
        Some(_) => format::floor_to_minute(now),
        None => format::floor_to_minute(
            start_ms
                .saturating_add(active.accumulated_sec.saturating_mul(1000))
                .min(now),
        ),
    };
    (end_ms > start_ms).then(|| {
        TimerInterval::live(start_ms, end_ms).with_duration(live_duration_sec(active, now))
    })
}

/// 实时段的真实累计秒数，**对齐到整分钟**。
///
/// 不对齐会让 `duration:` 每 15 秒（`flush_active` 折一次账）就变一个值，把
/// 「同一分钟内渲染文本不变 → 不写盘」这条保证打掉——`end` 既然已对齐到分钟，
/// `duration` 必须跟着对齐，否则等于白对齐。
///
/// 暂停中 `running_since` 为空，只取已折入的 `accumulated_sec`，冻结不动。
fn live_duration_sec(active: &repo::RecordWithItem, now: i64) -> i64 {
    let recorded = active.accumulated_sec.saturating_mul(1000);
    let running = active
        .running_since
        .map(|since| (now - since).max(0))
        .unwrap_or(0);
    format::floor_to_minute(recorded.saturating_add(running)) / 1000
}

/// 便利贴区块：只写**当天相关**（当天创建或当天改过）的便利贴。
///
/// 旧实现把全部便利贴写进每一天的文件，昨天贴的便条会天天跟着出现。日记是「那一天
/// 的记录」，今天的日记只承载今天动过的便利贴；没动过的留在它自己那天的文件里。
/// 代价写在 `repo::notes_in_day` 的注释与 `docs/plugin-spec.md` 里。
pub async fn notes(pool: &SqlitePool, date: NaiveDate) -> AppResult<Exported> {
    let (from, to) = format::day_bounds(date);
    let rows = repo::notes_in_day(pool, from, to).await?;
    let mut latest = 0;
    let mut note_rows = Vec::new();
    for row in rows {
        latest = latest.max(row.updated_at);
        note_rows.push(NoteRow {
            id: Some(row.id),
            updated_ms: row.updated_at,
            item: row.item_name,
            content: row.content,
        });
    }

    Ok(Exported {
        body: format::render_notes(&note_rows),
        latest_update: latest,
    })
}

/// 待办区块：只写**未完成**、且**计划时间不在当天**的待办。
///
/// 为什么排除今天：区块表达「计划在未来完成的内容」，今天要执行的事属于当天日程，
/// 用户会在计时区块里体现它的结果。昨天没做完、计划时间已经过去的仍列在这里
/// （渲染成「逾期」），未排期的也列在最后——它们都还没有「完成」。
///
/// 为什么不按 `{date}` 归属：待办是**跨天的池子**，不像计时记录有天然的那一天。
/// 每天的文件写同一份「未来清单」，读到哪天的日记都能看见手上还有什么。
pub async fn todos(pool: &SqlitePool, date: NaiveDate) -> AppResult<Exported> {
    let (from, to) = format::day_bounds(date);
    let rows = repo_todo::todos_for_block(pool, from, to).await?;
    let todo_rows: Vec<TodoRow> = rows
        .iter()
        .map(|row| TodoRow {
            id: Some(row.id),
            title: row.title.clone(),
            planned_ms: row.planned_at,
            done: false,
        })
        .collect();

    Ok(Exported {
        body: format::render_todos(&todo_rows, date),
        latest_update: repo_todo::latest_todo_update(pool, from, to).await?,
    })
}

/// 按数据种类分发（`mod.rs` 只调这里，避免它自己长出一串 match、越过 300 行）。
pub async fn by_kind(pool: &SqlitePool, kind: MdSyncKind, date: NaiveDate) -> AppResult<Exported> {
    match kind {
        MdSyncKind::Timers => timers(pool, date).await,
        MdSyncKind::Notes => notes(pool, date).await,
        MdSyncKind::Todos => todos(pool, date).await,
    }
}
