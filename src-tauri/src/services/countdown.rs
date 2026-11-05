//! 倒计时业务（ADR-011）：作为计时状态机的「模式扩展」，到点判定归 Rust。
//!
//! 数据：`time_records.mode='countdown'` + `target_sec`；状态机仍是 idle|running|paused 三态。
//! 到点行为：[V0.3.4] 起**一律结束并保存**（原「自动结束」开关已下架，ADR-023）——
//! 目标时长是用户自己设的，到点就该落一条记录，没有第二种语义。

use sqlx::SqlitePool;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::error::{AppError, AppResult};
use crate::models::constants::{MAX_COUNTDOWN_SEC, SYSTEM_ITEM_ID};
use crate::models::enums::timer_mode;
use crate::models::record::TimeRecord;
use crate::models::timer::CountdownFired;
use crate::platform::clock::{self, now_ms};
use crate::repositories::item as item_repo;
use crate::repositories::record_session as session;
use crate::services::settings;
use crate::services::timer;

/// 进程内提示位：当前是否存在倒计时会话。
///
/// 只用于减少空闲时的 SQL（1s watcher 每次 `find_active` 一次查询，空闲一天就是
/// 8.6 万次无意义查询）。**它不是事实来源**：watcher 每 15s 必做一次权威校验，
/// 因此提示位即使漂移，最坏 15s 自愈。真值始终在 `time_records` 里。
static COUNTDOWN_ACTIVE: AtomicBool = AtomicBool::new(false);

/// 当前是否「可能有」倒计时在跑（watcher 用来跳过空闲 tick）。
pub fn active_hint() -> bool {
    COUNTDOWN_ACTIVE.load(Ordering::Relaxed)
}

fn set_hint(active: bool) {
    COUNTDOWN_ACTIVE.store(active, Ordering::Relaxed);
}

/// 开始倒计时会话。非法 `target_sec`（≤0 或 >24h）→ `INVALID_TARGET_SEC`。
pub async fn start(
    pool: &SqlitePool,
    item_id: Option<i64>,
    target_sec: i64,
) -> AppResult<TimeRecord> {
    if target_sec <= 0 || target_sec > MAX_COUNTDOWN_SEC {
        return Err(AppError::invalid_target_sec());
    }
    if session::find_active(pool).await?.is_some() {
        return Err(AppError::timer_already_running());
    }
    let item_id = item_id.unwrap_or(SYSTEM_ITEM_ID);
    if item_repo::find_by_id(pool, item_id).await?.is_none() {
        return Err(AppError::item_not_found());
    }
    let now = now_ms();
    let id = session::insert_active_countdown(pool, item_id, target_sec, now).await?;
    set_hint(true);
    settings::set_last_item_id(pool, item_id).await?;
    timer::reload(pool, id).await
}

/// 1s watcher 调用：若存在「已到点」的倒计时会话则返回其快照（否则 `None`）。
///
/// 到点**一律结束并保存**（V0.3.4 起无开关，ADR-023）：会话转 `saved`，
/// `accumulated_sec` 钳到 target，`ended_at = started_at + target_sec * 1000`。
///
/// 这里**不**套「最短记录时长」阈值：倒计时时长是用户显式设定的目标（最少 1 秒也是
/// 用户的意思），到点即应落库；阈值只作用于手动停止（见 `services::timer::stop`）。
pub async fn tick(pool: &SqlitePool) -> AppResult<Option<CountdownFired>> {
    let Some(active) = session::find_active(pool).await? else {
        set_hint(false);
        return Ok(None);
    };
    if active.mode != timer_mode::COUNTDOWN {
        set_hint(false);
        return Ok(None);
    }
    let Some(target_sec) = active.target_sec else {
        set_hint(false);
        return Ok(None);
    };
    // 走到这里说明确有倒计时在跑：置位让 watcher 恢复 1s 节拍（含「尚未到点」的常态）。
    set_hint(true);
    let now = now_ms();
    if timer::live_duration(&active, now) < target_sec {
        return Ok(None);
    }
    let item_name = item_repo::find_by_id(pool, active.item_id)
        .await?
        .map(|item| item.name)
        .unwrap_or_default();
    let ended_at = active.started_at + target_sec * 1000;
    session::finalize(pool, active.id, target_sec, ended_at, now).await?;
    /* [V0.11.2] 到点与手动停止必须同收尾：①清锚点（与 `timer_stop` 一致，
    否则锚点表只增不减，攒满 8 条会把正在用的起点挤掉）；②跑「结束后自动开始」
    （`after_stop`），否则用户答应的「这条结束后开始下一条」只在手动停止时生效。 */
    if let Some(rs) = active.running_since {
        clock::clear_anchor(rs);
    }
    crate::services::todo_start::after_stop(pool).await;
    let record = timer::reload(pool, active.id).await?;
    Ok(Some(CountdownFired {
        record,
        target_sec,
        item_name,
        ended: true,
    }))
}

/// 倒计时剩余秒数（服务端快照，与 `liveDurationSec` 同源，避免同步跳变）。
/// countup / 无 target → `None`。
pub fn remaining_sec(record: &TimeRecord, live: i64) -> Option<i64> {
    if record.mode != timer_mode::COUNTDOWN {
        return None;
    }
    record.target_sec.map(|target| (target - live).max(0))
}
