//! 崩溃恢复与退出收尾（批 2 · V0.11.24，PRD §13.5）。
//!
//! 从 `services/timer.rs` 拆出（单文件 ≤300 行，ADR-017）：`resolve_open` 是启动时
//! 「上次进程没记退出」的唯一处置入口；`close_active_for_quit` 是托盘退出 ② 位
//! （`app/tray_quit.rs`）的收尾入口。两者共用「按关闭时间结束」的口径：
//! **关闭时间 = `running_since`**（最后一次落盘锚点，误差 ≤30s，界面只称「关闭」）；
//! `running_since` 缺失（上次是暂停态）→ **不编造**关闭时刻（PRD H-C8）：
//! `ended_at` 取 now、累计保持最后落盘值——暂停后没有流逝，关闭时刻对结果无影响。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::models::enums::ResolveAction;
use crate::models::record::TimeRecord;
use crate::platform::clock;
use crate::repositories::record as repo;
use crate::repositories::record_session as session;
use crate::services::timer_split;
use crate::services::timer_time::gap_sec;

/// 崩溃恢复：处理启动时发现的 active 会话。
///
/// ## 边界②（多条 active 脏数据）
///
/// 唯一索引理论上只允许 1 条 active，但历史脏数据可能更多。只对 `started_at`
/// **最早**的一条执行用户的选择；其余一律按关闭时间收尾（不弹第二次框、不并列显示），
/// 每条落 `log_warn`。函数返回时库里 active 必须为 0（判据 H5）。
///
/// ## 三个动作的数据语义（与对话框三元素一一对应）
///
/// - `resume`（选项 A「一直算到现在」）：`include_gap` 为真时把「`running_since` → now」
///   的空档并入累计并继续计时；`ended_at` 保持为空（H2）。
/// - `close`（选项 B「结束在 HH:MM」）：`ended_at = end_at`（前端传关闭时间；缺省 now）；
///   累计以最后落盘值为准（`include_gap` 才补空档，R-2）；跨零点按 `timer_split`
///   的规则拆天——`ended_at` 落关闭那一天（H3 / ADR-043）。
/// - `discard`（「丢弃这段」）：软删除，释放 `uq_records_open` 唯一槽（R-5）。
pub async fn resolve_open(
    pool: &SqlitePool,
    action: ResolveAction,
    end_at: Option<i64>,
    include_gap: bool,
) -> AppResult<Option<TimeRecord>> {
    let actives = session::find_all_active(pool).await?;
    let Some(active) = actives.first().cloned() else {
        return Ok(None);
    };
    /* 边界②：先把最早之外的多余 active 按关闭时间收尾，选完 active 必为 0（H5）。 */
    close_extras_at_close_time(pool, &actives[1..]).await?;

    let now = clock::now_ms();
    match action {
        ResolveAction::Resume => {
            // 空档并入（include_gap）后 running_since 重置为 now：继续计时不重复计停机段。
            let base = active.accumulated_sec + gap_sec(&active, now, include_gap);
            session::set_accum_and_running(pool, active.id, base, Some(now), now).await?;
            clock::anchor(now);
            repo::find_by_id(pool, active.id).await
        }
        ResolveAction::Close => {
            let ended = end_at.unwrap_or(now);
            if ended < active.started_at {
                return Err(AppError::invalid_duration());
            }
            // 以最后落盘 accumulated_sec 为准；include_gap 才补算停机间隙（R-2）。
            let base = active.accumulated_sec + gap_sec(&active, ended, include_gap);
            // 跨零点分段：崩溃跨夜的会话常常是昨天开始、今天才收尾（V0.11.3）。
            timer_split::finalize(pool, &active, base, ended, now).await?;
            if let Some(rs) = active.running_since {
                clock::clear_anchor(rs);
            }
            repo::find_by_id(pool, active.id).await
        }
        ResolveAction::Discard => {
            // 必须置 saved + 软删除，释放 uq_records_open 唯一槽（R-5）。
            // 累计以最后落盘值为准（不补崩溃间隙，R-2）；记录都不要了，gap 更无从谈起。
            session::discard(pool, active.id, active.accumulated_sec, now, now).await?;
            if let Some(rs) = active.running_since {
                clock::clear_anchor(rs);
            }
            Ok(None)
        }
    }
}

/// 按「关闭时间」结束一条 active 会话：`ended_at = running_since`（缺失则 now），
/// 累计保持最后落盘值（空档不并入，R-2）。
///
/// 墙钟回拨可能让 `running_since < started_at`；抬到 `started_at` 兜底，
/// 避免撞上 DB CHECK（`ended_at >= started_at`）让整次收尾失败。
async fn close_at_close_time(pool: &SqlitePool, record: &TimeRecord, now: i64) -> AppResult<()> {
    let ended = record.running_since.unwrap_or(now).max(record.started_at);
    timer_split::finalize(pool, record, record.accumulated_sec, ended, now).await?;
    if let Some(rs) = record.running_since {
        clock::clear_anchor(rs);
    }
    Ok(())
}

/// 边界②：最早之外的多余 active 一律按关闭时间收尾，每条落 `log_warn`（H5）。
async fn close_extras_at_close_time(pool: &SqlitePool, extras: &[TimeRecord]) -> AppResult<()> {
    for extra in extras {
        crate::log_warn!(
            "recover: extra active record id={} closed at close time",
            extra.id
        );
        close_at_close_time(pool, extra, clock::now_ms()).await?;
    }
    Ok(())
}

/// 托盘退出 ② 位（`app/tray_quit.rs`）：把所有 active 会话按关闭时间收尾。
///
/// 必须发生在退出前那一轮同步（③）**之前**：顺序反过来，③ 导出的是「少了最后一段」
/// 的版本，`last_hash` 把它记成已同步后，那一段就永远补不回来（见 tray_quit.rs ② 注释）。
/// 返回收尾条数（0 = 没有 active，调用方无事可做）。暂停中的会话没有「关闭时刻」
/// 可言：`ended_at` 取 now、累计保持最后落盘值——与 H-C8「不编造关闭时刻」同一口径。
pub async fn close_active_for_quit(pool: &SqlitePool) -> AppResult<usize> {
    let actives = session::find_all_active(pool).await?;
    let count = actives.len();
    for record in &actives {
        close_at_close_time(pool, record, clock::now_ms()).await?;
    }
    if count > 1 {
        crate::log_warn!("quit close-out: {count} active records closed at close time");
    }
    Ok(count)
}
