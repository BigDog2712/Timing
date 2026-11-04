//! 插件面板的**宿主能力**：数据源查询 + 内置动作执行。
//!
//! 插件只能按名字调用这里的东西，名字来自 `models::plugin_panel` 的白名单，
//! 且在清单加载阶段就校验过。所以这里不再做「这是不是已知名字」的兜底判断——
//! 真走到未知分支说明有人绕过了校验，记一条 warn 并空返回，比 panic 好。
//!
//! ## 为什么数据源不用 SQL / 动作不用脚本
//!
//! 一旦允许插件传 SQL 或代码，宿主要做的就不再是「渲染一块界面」，而是「沙箱 + 权限
//! 模型 + 崩溃隔离」——那是另一个量级的工程，且收益是让一个个人应用承担任意代码执行
//! 的风险。白名单能力能覆盖绝大多数真实需求（看统计、加点东西、起个计时），
//! 而越界的需求应该由宿主新增一个能力，不是由插件绕过去。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::models::note::NoteGeometry;
use crate::models::plugin_panel::{ActionParams, QueryParams};
use crate::models::todo::TodoListParams;
use crate::platform::clock::now_ms;
use crate::repositories::{note as note_repo, record as record_repo, todo as todo_repo};
use crate::services;

/// 默认统计天数（`records.byItem` 不填 `days` 时）。
const DEFAULT_DAYS: u32 = 7;
/// 默认待办条数（`todos.pending` 不填 `limit` 时）。
const DEFAULT_LIMIT: u32 = 8;
/// 新便利贴的默认尺寸（与便利贴窗的初值一致）。
const NEW_NOTE_W: f64 = 320.0;
const NEW_NOTE_H: f64 = 260.0;

/// 数据源返回的一行。前端按块类型决定怎么画（`stats` 用 `ratio` 画条，`list` 只用文本）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelRow {
    pub label: String,
    pub detail: String,
    /// 0..=1 的相对占比；`None` = 这行不该画条。
    pub ratio: Option<f64>,
}

/// 动作执行结果（一句话回执，直接显示在面板底部）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelActionOutcome {
    pub message: String,
}

/// 按白名单数据源查询。
pub async fn query(
    pool: &SqlitePool,
    source: &str,
    params: &QueryParams,
) -> AppResult<Vec<PanelRow>> {
    match source {
        "records.byItem" => records_by_item(pool, params).await,
        "todos.pending" => todos_pending(pool, params).await,
        other => {
            crate::log_warn!("unknown panel source: {other}");
            Ok(Vec::new())
        }
    }
}

/// 最近 N 天各事项时长，降序。`detail` 是格式化后的时长。
async fn records_by_item(pool: &SqlitePool, params: &QueryParams) -> AppResult<Vec<PanelRow>> {
    let days = i64::from(params.days.unwrap_or(DEFAULT_DAYS).clamp(1, 365));
    let now = now_ms();
    let from = now - days * 24 * 60 * 60 * 1000;
    let rows = record_repo::stats_by_item_named(pool, Some(from), None).await?;
    /* 占比按**最大值**归一，不按总和：一个事项占满全周时，按总和算会让其他行都变成
    看不见的细线，看不出相对差距。 */
    let max = rows.iter().map(|(_, sec)| *sec).max().unwrap_or(0);
    Ok(rows
        .into_iter()
        .filter(|(_, sec)| *sec > 0)
        .map(|(name, sec)| PanelRow {
            label: name,
            detail: format_duration(sec),
            ratio: (max > 0)
                .then(|| f64::from(i32::try_from(sec * 1000 / max).unwrap_or(1000)) / 1000.0),
        })
        .collect())
}

/// 未完成待办（按计划时间升序，未排期的排最后）。
async fn todos_pending(pool: &SqlitePool, params: &QueryParams) -> AppResult<Vec<PanelRow>> {
    let limit = usize::try_from(params.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, 50)).unwrap_or(8);
    let all = todo_repo::list(
        pool,
        &TodoListParams {
            include_done: false,
            from: None,
            to: None,
        },
    )
    .await?;
    Ok(all
        .into_iter()
        .take(limit)
        .map(|todo| PanelRow {
            label: todo.title,
            detail: todo
                .planned_at
                .map(|at| format_day(at, now_ms()))
                .unwrap_or_else(|| "未排期".into()),
            ratio: None,
        })
        .collect())
}

/// 执行一个内置动作。
pub async fn run_action(
    pool: &SqlitePool,
    action: &str,
    params: &ActionParams,
) -> AppResult<PanelActionOutcome> {
    match action {
        "timer.start" => start_timer(pool, params).await,
        "timer.pause" => pause_timer(pool).await,
        "todo.add" => add_todo(pool, params).await,
        "note.create" => create_note(pool, params).await,
        other => Ok(PanelActionOutcome {
            message: format!("未知动作：{other}"),
        }),
    }
}

/// 按事项名开始计时；事项不存在则新建（与快捷计时同一套语义）。
async fn start_timer(pool: &SqlitePool, params: &ActionParams) -> AppResult<PanelActionOutcome> {
    let name = require(&params.item, "timer.start 缺少事项名")?;
    let items = services::item::list(pool, false).await?;
    let item_id = match items.iter().find(|item| item.name == name) {
        Some(found) => found.id,
        None => services::item::create(pool, &name, None).await?.id,
    };
    services::timer::start(pool, Some(item_id)).await?;
    Ok(PanelActionOutcome {
        message: format!("已开始：{name}"),
    })
}

async fn pause_timer(pool: &SqlitePool) -> AppResult<PanelActionOutcome> {
    let record = services::timer::pause(pool).await?;
    Ok(PanelActionOutcome {
        message: format!("已暂停，累计 {} 分钟", record.accumulated_sec / 60),
    })
}

async fn add_todo(pool: &SqlitePool, params: &ActionParams) -> AppResult<PanelActionOutcome> {
    let title = require(&params.title, "todo.add 缺少标题")?;
    todo_repo::insert(pool, &title, None, None, 0, now_ms()).await?;
    Ok(PanelActionOutcome {
        message: format!("已加入待办：{title}"),
    })
}

async fn create_note(pool: &SqlitePool, params: &ActionParams) -> AppResult<PanelActionOutcome> {
    let content = require(&params.content, "note.create 缺少正文")?;
    /* 新便利贴落在屏幕右上角附近，不叠在已有窗口正中；落位由用户自己拖。 */
    let geom = NoteGeometry {
        pos_x: 120.0,
        pos_y: 120.0,
        width: NEW_NOTE_W,
        height: NEW_NOTE_H,
    };
    note_repo::insert(pool, None, &content, geom, now_ms()).await?;
    Ok(PanelActionOutcome {
        message: "便利贴已创建".into(),
    })
}

/// 取必需文本参数（校验层已挡过一次，这里是运行期兜底）。
fn require(value: &Option<String>, message: &str) -> AppResult<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
        .ok_or_else(|| AppError::io(message))
}

/// 秒 → `3 小时 20 分` / `42 分` / `不到 1 分`。
fn format_duration(sec: i64) -> String {
    if sec < 60 {
        return "不到 1 分".into();
    }
    let minutes = sec / 60;
    let (hours, rest) = (minutes / 60, minutes % 60);
    if hours == 0 {
        return format!("{rest} 分");
    }
    if rest == 0 {
        return format!("{hours} 小时");
    }
    format!("{hours} 小时 {rest} 分")
}

/// 时间戳 → `今天` / `明天` / `M 月 D 日`。
fn format_day(at: i64, now: i64) -> String {
    use chrono::{Local, TimeZone};
    let (Some(day), Some(today)) = (
        Local.timestamp_millis_opt(at).single(),
        Local.timestamp_millis_opt(now).single(),
    ) else {
        return "未排期".into();
    };
    let delta = (day.date_naive() - today.date_naive()).num_days();
    match delta {
        0 => "今天".into(),
        1 => "明天".into(),
        -1 => "昨天".into(),
        _ => day.format("%-m 月 %-d 日").to_string(),
    }
}

#[cfg(test)]
#[path = "plugin_panel_test.rs"]
mod tests;
