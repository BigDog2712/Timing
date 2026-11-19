//! 启动时的「恢复待决」状态：库里还有 active 会话 ⇒ 先别让后台任务替用户收尾。

use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use crate::state::AppState;

/// 注入共享状态，并按「库里有 active 会话」决定恢复闸门。
///
/// 恢复对话框的用户选择（`resolve_open_record`）是唯一解除点；`jobs::countdown`
/// 每 tick 读这一个原子位，所以「不计退出期间 / 丢弃」不会在用户点击之前被后台抢先落账。
pub(super) fn manage(app: &AppHandle, pool: &SqlitePool) {
    let pending =
        tauri::async_runtime::block_on(crate::repositories::record_session::find_active(pool))
            .map(|active| active.is_some())
            .unwrap_or(false);
    let state = AppState::new(pool.clone());
    state
        .timer_recovery_pending
        .store(pending, std::sync::atomic::Ordering::Release);
    app.manage(state);
}
