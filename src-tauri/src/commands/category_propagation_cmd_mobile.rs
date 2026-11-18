use crate::error::{AppError, AppResult};
use crate::services::category_propagation::{
    CategoryPropagationPreview, CategoryPropagationRequest,
};
use tauri::{AppHandle, Runtime};

#[tauri::command]
pub async fn preview_category_propagation<R: Runtime>(
    _app: AppHandle<R>,
    _request: CategoryPropagationRequest,
) -> AppResult<CategoryPropagationPreview> {
    Err(AppError::io("标签传播仅支持桌面端"))
}

#[tauri::command]
pub async fn apply_category_propagation<R: Runtime>(
    _app: AppHandle<R>,
    _request: CategoryPropagationRequest,
    _expected_fingerprint: String,
) -> AppResult<()> {
    Err(AppError::io("标签传播仅支持桌面端"))
}
