//! 定时导出的**产物校验**：把刚写出来的 sqlite / parquet / markdown 读回来验一遍。
//!
//! 从 `scheduled_export.rs` 拆出（2026-11-16，评审 P2-3）。两个理由：
//!
//! 1. 那个文件是冻结基线（1096 行），补一条「显式关连接」的修复不给加行；
//! 2. 这里的东西是**纯校验**：给一份文件、一组期望列、一个期望行数，回 ok / 失败。
//!    它不需要 AppHandle、不需要配置、不写库，和调度逻辑本来就不是一件事。
//!
//! ## 为什么必须显式 `close()`（P2-3 的真凶）
//!
//! sqlx 的 `SqliteConnection` 在 `Drop` 时只往连接的后台线程发一条 close 命令，
//! **不等它真的关掉**。所以「校验完立刻删 / 移动这个文件」在 Windows 上会撞
//! `os error 32`（文件被占用）：全量 `cargo test` 并行跑时随机一条红、单跑必绿，
//! 评审看到的两轮「不同用例失败」就是这个。`close().await` 等到句柄真的释放。

use std::path::Path;

use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};

/// 一条会话 / 一段浏览记录都要有的表与列（写死：这是导出格式的契约）。
const EXPORT_TABLES: [&str; 2] = ["sessions", "web_activity_segments"];

/// 校验一份导出的 sqlite：完整性 + 列集合 + 行数。
///
/// 失败一律回 `format_validation_failed`（不带任何内部细节：这个串会进给用户的错误提示）。
pub async fn validate_sqlite(
    path: &Path,
    selected_fields: &[String],
    expected_rows: u64,
) -> Result<(), String> {
    let options = SqliteConnectOptions::new().filename(path).read_only(true);
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|_| "format_validation_failed".to_string())?;
    /* 结果先接住、再关连接、最后返回：见模块头的 P2-3 说明。 */
    let outcome = validate_open(&mut connection, selected_fields, expected_rows).await;
    connection.close().await.ok();
    outcome
}

/// 校验体：连接由调用方持有并负责关闭。
async fn validate_open(
    connection: &mut SqliteConnection,
    selected_fields: &[String],
    expected_rows: u64,
) -> Result<(), String> {
    let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(&mut *connection)
        .await
        .map_err(|_| "format_validation_failed".to_string())?;
    if integrity != "ok" {
        return Err("format_validation_failed".to_string());
    }
    let (session_fields, web_fields) =
        crate::services::activity::data::export::sqlite_exporter::resolved_sqlite_column_names(
            selected_fields,
        )
        .map_err(|_| "format_validation_failed".to_string())?;
    let per_table = [session_fields, web_fields];
    let mut rows: u64 = 0;
    for (table, expected) in EXPORT_TABLES.iter().zip(per_table.iter()) {
        validate_columns(&mut *connection, table, expected).await?;
        let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(&mut *connection)
            .await
            .map_err(|_| "format_validation_failed".to_string())?;
        rows = rows.saturating_add(u64::try_from(count).unwrap_or(0));
    }
    (rows == expected_rows)
        .then_some(())
        .ok_or_else(|| "format_validation_failed".to_string())
}

/// 表头必须是 `id` + 选中的列（顺序也要一致：导出是按这个顺序写的）。
async fn validate_columns(
    connection: &mut SqliteConnection,
    table: &str,
    expected_fields: &[String],
) -> Result<(), String> {
    let rows = sqlx::query(&format!("PRAGMA table_info({table})"))
        .fetch_all(&mut *connection)
        .await
        .map_err(|_| "format_validation_failed".to_string())?;
    let actual = rows
        .into_iter()
        .map(|row| sqlx::Row::get::<String, _>(&row, "name"))
        .collect::<Vec<_>>();
    let expected = std::iter::once("id".to_string())
        .chain(expected_fields.iter().cloned())
        .collect::<Vec<_>>();
    (actual == expected)
        .then_some(())
        .ok_or_else(|| "format_validation_failed".to_string())
}
