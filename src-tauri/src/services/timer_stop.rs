//! 手动结束计时（`stop_timer` / 托盘「结束」）：V0.3.4 起带「最短记录时长」判定。
//!
//! 从 `timer.rs` 拆出（单文件 ≤300 行纪律，同 `timer_time.rs` 的做法）：
//! `services::timer::stop` 在此 re-export，调用点写法不变。
//!
//! 阈值判定的**唯一入口**是本文件的 `should_ignore`：手动结束与「切换事项分段」
//! 共用它，口径见 ADR-023。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::models::enums::record_status;
use crate::models::record::TimeRecord;
use crate::models::timer::StopResult;
use crate::platform::clock;
use crate::repositories::record_session as session;
use crate::services::settings;
use crate::services::timer_time::live_duration;

/// 「这段会话短到不该被记录吗」——阈值判定的唯一入口。
///
/// 只有**非显式保存**的会话才过这道闸：手动结束（本文件）与切换事项产生的分段
/// （`services::timer::switch` 的 `EndAndStart`）。显式声明要保存的两条路径不受限——
/// 倒计时到点、崩溃恢复的「结束并保存」（ADR-023）。
///
/// 读设置失败时**放行**（返回 `false`）：宁可按用户既有口径记一条，也不要因为
/// 一次读设置失败就把真实记录悄悄丢掉。
pub async fn should_ignore(pool: &SqlitePool, accumulated_sec: i64) -> bool {
    settings::get_reference(pool)
        .await
        .map(|rs| accumulated_sec < rs.min_record_seconds)
        .unwrap_or(false)
}

/// 结束并保存（右键单击）：直接置 saved。
///
/// [V0.3.4] 先看「最短记录时长」（`ReferenceSettings.min_record_seconds`，默认 30s）：
/// `accumulated < threshold` 时**不保存**——会话按软删处理并回 `discarded = true`，
/// 前端因此既不展示撤销条也不进记录列表（ADR-023）。
///
/// **例外**（两条路径不看阈值）：倒计时到点（`services::countdown::tick` 直接 finalize）
/// 与崩溃恢复的「结束并保存」（`resolve_open` 的 `Close`）——两者都是用户显式声明
/// 「这段要留下」，把它丢掉比多记一条十几秒的记录更糟。
pub async fn stop(pool: &SqlitePool) -> AppResult<StopResult> {
    let active = session::find_active(pool)
        .await?
        .ok_or_else(AppError::timer_not_running)?;
    let now = clock::now_ms();
    if now < active.started_at {
        return Err(AppError::invalid_duration());
    }
    let accumulated = live_duration(&active, now);
    // 与切换分段同一口径，判定逻辑只在 `should_ignore` 里写一遍（ADR-023）。
    if should_ignore(pool, accumulated).await {
        session::discard(pool, active.id, accumulated, now, now).await?;
        if let Some(rs) = active.running_since {
            clock::clear_anchor(rs);
        }
        /* [V0.4.1] 「我明明计了却没记上」是最难自证的一类反馈：把「低于阈值被忽略」
        写进日志，用户报障时能直接对上是哪一段、只有几秒。 */
        crate::log_info!(
            "timer stop: discarded id={} accumulated={accumulated}s",
            active.id
        );
        // 记录已被软删，`find_by_id` 查不到了：直接以内存快照作为返回值（前端只用来判断
        // `discarded`，不展示这条记录）。
        let record = TimeRecord {
            status: record_status::SAVED.to_string(),
            ended_at: Some(now),
            accumulated_sec: accumulated,
            running_since: None,
            ..active
        };
        return Ok(StopResult {
            record,
            discarded: true,
        });
    }
    session::finalize(pool, active.id, accumulated, now, now).await?;
    if let Some(rs) = active.running_since {
        clock::clear_anchor(rs);
    }
    let record = crate::services::timer::reload(pool, active.id).await?;
    crate::log_info!(
        "timer stop: saved id={} item={} accumulated={accumulated}s",
        record.id,
        record.item_id
    );
    // [V0.3.12] 「当前事项结束后自动开始」（ADR-030）：有用户应允过的待办就顶上。
    crate::services::todo_start::after_stop(pool).await;
    Ok(StopResult {
        record,
        discarded: false,
    })
}
