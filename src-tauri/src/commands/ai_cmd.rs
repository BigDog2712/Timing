//! AI 命令（桌面）：配置、测试连接、模型目录、标签建议、今日汇总。
//!
//! 六条命令都只做「取 pool → 调 service」。密钥三态（`None` 不动 / 空串清空 /
//! 明文写入）与 WebDAV 密码同口径，由 `services::ai::config::save` 解释。

use tauri::State;

use crate::error::AppResult;
use crate::models::ai::{
    AiConfig, AiConfigView, AiDailySummary, AiListModelsRequest, AiSuggestRequest,
    AiSuggestResponse, AiTestResult,
};
use crate::platform::clock;
use crate::services::ai::{client, config as ai_config, daily, suggest};
use crate::state::AppState;

#[tauri::command]
pub async fn ai_config_get(state: State<'_, AppState>) -> AppResult<AiConfigView> {
    ai_config::view(&state.pool).await
}

/// `api_key` 不传 = 保留原密钥；传空串 = 清除；传值 = 覆盖。
#[tauri::command]
pub async fn ai_config_save(
    state: State<'_, AppState>,
    config: AiConfig,
    api_key: Option<String>,
) -> AppResult<AiConfigView> {
    ai_config::save(&state.pool, &config, api_key.as_deref(), clock::now_ms()).await
}

/// 测试连接**不要求总开关打开**：用户往往先测通再启用。失败回 `ok=false`，
/// 把供应商的原话交给设置页显示。
#[tauri::command]
pub async fn ai_test(state: State<'_, AppState>) -> AppResult<AiTestResult> {
    let config = ai_config::load(&state.pool).await?;
    let Some(key) = ai_config::saved_key().await? else {
        return Ok(AiTestResult {
            ok: false,
            message: "还没有保存 API Key".to_string(),
            latency_ms: 0,
        });
    };
    Ok(client::test_connection(&config, &key).await)
}

/// 只读 `GET /models`。地址可先于保存试用；没带草稿密钥时只复用同源的已存密钥。
#[tauri::command]
pub async fn ai_list_models(
    state: State<'_, AppState>,
    request: AiListModelsRequest,
) -> AppResult<Vec<String>> {
    let base_url = ai_config::validate_base_url(&request.base_url)?;
    let key = ai_config::resolve_key(&state.pool, &base_url, request.api_key.as_deref()).await?;
    client::list_models(&base_url, &key).await
}

#[tauri::command]
pub async fn ai_suggest_tags(
    state: State<'_, AppState>,
    request: AiSuggestRequest,
) -> AppResult<AiSuggestResponse> {
    suggest::suggest(&state.pool, request).await
}

#[tauri::command]
pub async fn ai_daily_summary(state: State<'_, AppState>) -> AppResult<AiDailySummary> {
    daily::generate(&state.pool).await
}
