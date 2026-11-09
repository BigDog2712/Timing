pub mod common;
pub mod csv_exporter;
pub mod markdown_exporter;
pub mod parquet_exporter;
pub mod sqlite_exporter;

use crate::services::insight::data::sqlite_pool::wait_for_sqlite_pool;
use serde::Deserialize;
use tauri::AppHandle;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDataRequest {
    pub format: String,
    pub output_path: String,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub selected_fields: Option<Vec<String>>,
}

pub async fn export_data(app: &AppHandle, request: ExportDataRequest) -> Result<u64, String> {
    common::validate_time_range(request.start_time, request.end_time)?;
    let database_path = crate::services::insight::data::sqlite_pool::resolve_product_db_path(app)?;
    if common::paths_refer_to_same_file(std::path::Path::new(&request.output_path), &database_path)
    {
        return Err("export path cannot overwrite the Patina database".to_string());
    }
    let pool = wait_for_sqlite_pool(app).await?;
    let selected_fields = request.selected_fields.as_deref();

    match request.format.as_str() {
        "csv" => {
            csv_exporter::export_to_csv(
                &pool,
                &request.output_path,
                request.start_time,
                request.end_time,
                selected_fields,
            )
            .await
        }
        "sqlite" => {
            sqlite_exporter::export_to_sqlite(
                &pool,
                &request.output_path,
                request.start_time,
                request.end_time,
                selected_fields,
            )
            .await
        }
        "parquet" => {
            parquet_exporter::export_to_parquet(
                &pool,
                &request.output_path,
                selected_fields,
                request.start_time,
                request.end_time,
            )
            .await
        }
        "markdown" => {
            markdown_exporter::export_to_markdown(
                &pool,
                &request.output_path,
                request.start_time,
                request.end_time,
                selected_fields,
            )
            .await
        }
        _ => Err(format!("unsupported export format: {}", request.format)),
    }
}

#[cfg(test)]
#[path = "mod_mod_tests.rs"]
mod tests;
