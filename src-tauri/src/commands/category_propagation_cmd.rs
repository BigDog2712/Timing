use crate::error::{AppError, AppResult};
use crate::services::category_propagation::{self, CategoryPropagationRequest};
use crate::state::AppState;
use tauri::{AppHandle, Runtime, State};

#[tauri::command]
pub async fn preview_category_propagation<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    request: CategoryPropagationRequest,
) -> AppResult<category_propagation::CategoryPropagationPreview> {
    category_propagation::preview(&app, &state.pool, &request)
        .await
        .map_err(AppError::io)
}

#[tauri::command]
pub async fn apply_category_propagation<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    request: CategoryPropagationRequest,
    expected_fingerprint: String,
) -> AppResult<()> {
    category_propagation::apply(&app, &state.pool, &request, &expected_fingerprint)
        .await
        .map_err(AppError::io)?;
    crate::app::events::emit_category_catalog_changed(&app);
    crate::services::md_sync::dirty::mark("item");
    Ok(())
}
