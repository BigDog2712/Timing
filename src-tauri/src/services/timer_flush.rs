//! 周期落盘（每 15s）：把运行中会话的已计秒数折入 `accumulated_sec`。
//!
//! 从 `services/timer.rs` 拆出（单文件 ≤300 行，ADR-017）。这是**唯一会改时长**的后台写，
//! 口径必须单独讲清楚，所以连同「什么时候必须让路」一起搬到这里。
//!
//! 折账用**单调**差值（锚点存在时），所以系统时钟前跳不会被算进时长；折完把
//! `running_since` 推到当前墙钟并**重新锚定**，保证下一段继续单调计量。

use sqlx::SqlitePool;

use crate::error::AppResult;
use crate::models::constants::FLUSH_INTERVAL_SECS;
use crate::platform::clock;
use crate::repositories::record_session as session;
use crate::services::timer_time::{elapsed_ms, floor_sec};

/// 周期落盘：把已计秒数折入 `accumulated_sec` 并推进 `running_since`。
pub async fn flush_active(pool: &SqlitePool) -> AppResult<()> {
    let Some(active) = session::find_active(pool).await? else {
        // 无 active 会话：锚点表里不应再有任何有效起点。
        clock::clear_all_anchors();
        return Ok(());
    };
    let Some(running_since) = active.running_since else {
        return Ok(());
    };
    let now = clock::now_ms();
    if should_defer(running_since, now) {
        crate::log_info!("flush_active deferred: cross-process session");
        return Ok(());
    }
    let delta = floor_sec(elapsed_ms(running_since, now));
    if delta <= 0 {
        return Ok(());
    }
    session::set_accum_and_running(
        pool,
        active.id,
        active.accumulated_sec + delta,
        Some(now),
        now,
    )
    .await?;
    clock::anchor(now);
    Ok(())
}

/// 本次折账是否必须让路（跨进程遗留的会话）。
///
/// [V0.11.2] 这是「恢复对话框还没点，离线时长已经进了累计」的根因：
/// 进程刚重启时锚点表是空的，`elapsed_ms` 只能退回**墙钟差**——而那段差值恰好是
/// 「应用关着的时间」。折不折是用户在恢复对话框里的决定（R-2「应用关着就停表」），
/// flusher 抢先折账会让「不计入退出期间」直接变成空话：累计被写进十几小时，
/// 而 `gap_sec` 又从被推进过的 `running_since` 起算，返回 0。
///
/// 正常运行时每 15s 折一次，`delta` 不会超过两个周期，所以这个判据只命中重启场景。
fn should_defer(running_since: i64, now: i64) -> bool {
    const FLUSH_GUARD_SECS: i64 = 2 * FLUSH_INTERVAL_SECS as i64;
    clock::anchored_elapsed_ms(running_since).is_none()
        && now.saturating_sub(running_since) / 1000 > FLUSH_GUARD_SECS
}

#[cfg(test)]
mod tests {
    use super::should_defer;

    #[test]
    fn fresh_session_without_anchor_is_not_deferred() {
        /* 启动后 3s 就 resolve 了（或测试手工构造）：跨度小，照常折账 */
        assert!(!should_defer(1_000_000, 1_000_000 + 3_000));
    }

    #[test]
    fn cross_process_session_is_deferred() {
        /* 上个进程留下的 running_since，隔了 15 小时：绝不能由 flusher 折账 */
        assert!(should_defer(1_000_000, 1_000_000 + 15 * 3600 * 1000));
    }
}
