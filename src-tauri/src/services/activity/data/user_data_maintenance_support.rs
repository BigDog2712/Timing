//! 保留期清理与按应用删除共用的查询小工具。
//!
//! 单独成文件只为把 `user_data_maintenance.rs` 的棘轮行数腾出来：这里的四个函数都不碰
//! 宿主状态，也不需要 `Runtime`，放在一起自成一块。

use crate::services::activity::data::repositories::media_playback;
use crate::services::activity::data::sqlite_error::SqliteOperationError;
use sqlx::Sqlite;

/// 错误统一挂在一个操作名下：调用方都是清理缓存的收尾步骤，不需要更细的分类。
pub(super) fn cache_error(error: sqlx::Error) -> SqliteOperationError {
    SqliteOperationError::from_sqlx("clean unreferenced activity icons", error)
}

pub(super) fn non_empty_values(values: Vec<String>) -> Vec<String> {
    values
        .into_iter()
        .filter(|value| !value.trim().is_empty())
        .collect()
}

pub(super) fn in_clause_placeholders(value_count: usize) -> String {
    std::iter::repeat_n("?", value_count)
        .collect::<Vec<_>>()
        .join(", ")
}

/// 删掉一批应用的**内容型**记录：窗口标题采样与媒体播放采样。
///
/// 两张表都不挂 `session_id` 的语义（媒体甚至完全不挂），删应用历史时必须显式带走，
/// 否则「已删除」的应用还能被查出「看过什么页面、放过哪个视频」。
pub(super) async fn delete_app_samples_by_exe_names(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    exe_names: &[String],
) -> Result<(), SqliteOperationError> {
    let placeholders = in_clause_placeholders(exe_names.len());
    let title_query = format!(
        "DELETE FROM session_title_samples
         WHERE session_id IN (SELECT id FROM sessions WHERE exe_name IN ({placeholders}))"
    );
    let mut title_query = sqlx::query(&title_query);
    for exe_name in exe_names {
        title_query = title_query.bind(exe_name);
    }
    title_query.execute(&mut **tx).await.map_err(|error| {
        SqliteOperationError::from_sqlx("delete app title samples by executable", error)
    })?;
    media_playback::delete_by_app_ids(tx, exe_names)
        .await
        .map_err(|error| SqliteOperationError::from_sqlx("delete app media samples", error))?;
    Ok(())
}

/// 列出待删除应用里**真实存在过**数据的进程名。
///
/// 不能直接拿请求里的名字当结果：前端可能传来从未记录过的名字，用它去查图标缓存会
/// 把「从未出现」误判成「出现后被删」。
pub(super) async fn apps_in_deletion(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    names: &[String],
    range: Option<(i64, i64)>,
) -> Result<Vec<String>, SqliteOperationError> {
    sqlx::query_scalar(
        "WITH target AS (SELECT value FROM json_each(?1))
         SELECT exe_name FROM sessions WHERE exe_name IN target AND (?2 IS NULL OR start_time >= ?2 AND start_time < ?3)
         UNION SELECT exe_name FROM import_exact_sessions WHERE exe_name IN target AND (?2 IS NULL OR start_time >= ?2 AND start_time < ?3)
         UNION SELECT exe_name FROM import_time_buckets WHERE exe_name IN target AND (?2 IS NULL OR bucket_start_time >= ?2 AND bucket_start_time < ?3)",
    ).bind(serde_json::json!(names).to_string()).bind(range.map(|r| r.0)).bind(range.map(|r| r.1))
     .fetch_all(&mut **tx).await.map_err(cache_error)
}
