use crate::app::insight::web_activity;
use crate::models::insight::web_activity::WebActivityBridgeSnapshot;
use crate::services::insight::engine::web_activity::WebActivityRuntimeState;
use tauri::{AppHandle, Runtime, State};

#[tauri::command]
pub async fn cmd_get_web_activity_bridge_snapshot<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, WebActivityRuntimeState>,
) -> Result<WebActivityBridgeSnapshot, String> {
    web_activity::get_bridge_snapshot(app, state).await
}
