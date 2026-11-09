use crate::patina::data::repositories::icon_cache::fetch_icon_for_exe;
use crate::patina::data::sqlite_pool::wait_for_sqlite_pool;
use tauri::{AppHandle, Runtime};

pub async fn load_icon_for_exe<R: Runtime>(
    app: &AppHandle<R>,
    exe_name: &str,
) -> Result<Option<String>, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    fetch_icon_for_exe(&pool, exe_name).await
}
