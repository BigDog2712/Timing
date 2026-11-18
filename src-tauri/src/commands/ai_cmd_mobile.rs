//! AI 命令 —— 移动端桩（六条）。
//!
//! AI 传输库只在桌面依赖段，且今日汇总要读分析窗库，因此手机端不提供实现。
//! 统一回 `IO_ERROR` + 「仅桌面端可用」，不新增错误码；命令名与注册点两平台一致。

use tauri::State;

use crate::error::AppResult;
use crate::models::ai::{
    AiConfig, AiConfigView, AiDailySummary, AiListModelsRequest, AiSuggestRequest,
    AiSuggestResponse, AiTestResult,
};
use crate::platform::host;
use crate::state::AppState;

fn unavailable<T>(command: &str) -> AppResult<T> {
    Err(host::desktop_only(command))
}

#[tauri::command]
pub async fn ai_config_get(_state: State<'_, AppState>) -> AppResult<AiConfigView> {
    unavailable("ai_config_get")
}

#[tauri::command]
pub async fn ai_config_save(
    _state: State<'_, AppState>,
    _config: AiConfig,
    _api_key: Option<String>,
) -> AppResult<AiConfigView> {
    unavailable("ai_config_save")
}

#[tauri::command]
pub async fn ai_test(_state: State<'_, AppState>) -> AppResult<AiTestResult> {
    unavailable("ai_test")
}

#[tauri::command]
pub async fn ai_list_models(
    _state: State<'_, AppState>,
    _request: AiListModelsRequest,
) -> AppResult<Vec<String>> {
    unavailable("ai_list_models")
}

#[tauri::command]
pub async fn ai_suggest_tags(
    _state: State<'_, AppState>,
    _request: AiSuggestRequest,
) -> AppResult<AiSuggestResponse> {
    unavailable("ai_suggest_tags")
}

#[tauri::command]
pub async fn ai_daily_summary(_state: State<'_, AppState>) -> AppResult<AiDailySummary> {
    unavailable("ai_daily_summary")
}
