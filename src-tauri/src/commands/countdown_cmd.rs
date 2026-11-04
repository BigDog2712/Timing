//! 倒计时域命令（`setCountdownPreset`；`startCountdown` 置于 `timer_cmd`，同属计时域）。
//!
//! 仅做「反序列化 -> 调 service -> 序列化」，无业务、无 SQL。

use tauri::State;

use crate::error::AppResult;
use crate::services;
use crate::state::AppState;

/// 覆盖倒计时预设列表（去重 + 升序 + 每项 >0 + 上限 8；落 `settings.countdown.presets`）。
#[tauri::command]
pub async fn set_countdown_preset(
    state: State<'_, AppState>,
    presets: Vec<i64>,
) -> AppResult<Vec<i64>> {
    services::theme::set_presets(&state.pool, presets).await
}
