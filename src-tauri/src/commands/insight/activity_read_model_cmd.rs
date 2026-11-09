use crate::commands::insight::error::CommandErrorDto;
use crate::services::insight::data::activity_read_model::{
    self, ActivityAggregateRangeDto, ReadModelStatusDto, RecordedAppCatalogCursorDto,
    RecordedAppCatalogPageDto,
};
use tauri::{AppHandle, Runtime};

fn command_error(context: &'static str, error: String) -> CommandErrorDto {
    CommandErrorDto::new(
        "ACTIVITY_READ_MODEL_FAILED",
        format!("{context}: {error}"),
        true,
    )
}

#[tauri::command]
pub async fn cmd_get_recorded_app_catalog_page<R: Runtime>(
    cursor: Option<RecordedAppCatalogCursorDto>,
    search_query: String,
    limit: usize,
    app: AppHandle<R>,
) -> Result<RecordedAppCatalogPageDto, CommandErrorDto> {
    activity_read_model::load_recorded_app_catalog_page(&app, cursor, search_query, limit)
        .await
        .map_err(|error| command_error("failed to read recorded app catalog", error))
}

#[tauri::command]
pub async fn cmd_get_activity_aggregate_range<R: Runtime>(
    start_ms: i64,
    end_ms: i64,
    bucket_boundaries_ms: Option<Vec<i64>>,
    app: AppHandle<R>,
) -> Result<ActivityAggregateRangeDto, CommandErrorDto> {
    activity_read_model::load_activity_aggregate_range(&app, start_ms, end_ms, bucket_boundaries_ms)
        .await
        .map_err(|error| command_error("failed to read activity aggregate", error))
}

#[tauri::command]
pub async fn cmd_get_activity_read_model_status<R: Runtime>(
    app: AppHandle<R>,
) -> Result<ReadModelStatusDto, CommandErrorDto> {
    activity_read_model::load_status(&app)
        .await
        .map_err(|error| command_error("failed to read activity model status", error))
}
