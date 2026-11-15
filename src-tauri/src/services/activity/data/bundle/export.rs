//! 全额数据包导出：两个库各扫一遍，逐表逐行流式写 JSON。
//!
//! ## 只读
//!
//! 业务库用宿主已开的池（`AppState.pool`），活动库用分析窗已开的池
//! （`wait_for_sqlite_pool`）——**都在跑着的连接上做 `SELECT`**，不另开可写连接。
//! 另开一份连接的风险很具体：活动库有后台写入（采样器/读模型），第二个连接会多一份
//! WAL 读者，导出期间还会把 `-wal` 撑大。
//!
//! ## 流式
//!
//! `BundleWriter` 逐行写、逐表关（见 `mod.rs` 的说明）。这里的 `fetch` 也是游标式的
//! （`try_next` 逐行取），不是 `fetch_all` —— 24k 行 `session_title_samples` 级别的表
//! 一旦全量进堆，几百万行的库就能把导出的进程撑爆。
//!
//! ## 缺表不算失败
//!
//! 清单里的表在**旧库**上可能还不存在（迁移没跑到 / 用户从更早版本升上来）。
//! 缺表导出成 `[]` 并跳过计数，不影响整包——导入侧对「包里没有这张表」也是同一个态度。

use super::{row_to_value, BundleWriter, ACTIVITY_TABLES, BUSINESS_TABLES, FORMAT, TableSpec};
use futures_util::TryStreamExt;
use serde::Serialize;
use sqlx::{Pool, Sqlite, SqliteConnection};
use std::fs;
use std::io::{BufWriter, Write};
use std::path::Path;

/** 导出结果（命令层原样回给前端）。 */
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    pub row_count: u64,
    pub table_count: usize,
    pub bytes: u64,
}

/// 把两个库导成**一个** JSON 包。
///
/// `device_id` 由调用方传（命令层读 `install_id()`）：`services::insight` 不直接依赖
/// 宿主的 `services::identity`，两边各读一次会出现「包里的 id 与本机 id 不是同一份」。
pub async fn export_full_bundle(
    business: &Pool<Sqlite>,
    activity: &Pool<Sqlite>,
    output: &Path,
    device_id: &str,
) -> Result<ExportSummary, String> {
    if let Some(parent) = output.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create bundle dir: {error}"))?;
        }
    }
    let file = fs::File::create(output)
        .map_err(|error| format!("failed to create bundle file: {error}"))?;
    let mut writer = BundleWriter::new(BufWriter::new(file));

    let header = format!(
        "{{\"format\":\"{FORMAT}\",\"exportedAtMs\":{},\"appVersion\":\"{}\",\"deviceId\":{},",
        crate::infra::activity::clock::unix_timestamp_millis_i64(),
        env!("CARGO_PKG_VERSION"),
        serde_json::to_string(device_id).map_err(|error| error.to_string())?,
    );
    writer.raw(&header).map_err(io_error)?;

    let mut row_count = 0_u64;
    let mut table_count = 0_usize;

    writer.raw("\"business\":{").map_err(io_error)?;
    table_count += write_section(&mut writer, business, BUSINESS_TABLES, &mut row_count).await?;
    writer.raw("},\"activity\":{").map_err(io_error)?;
    table_count += write_section(&mut writer, activity, ACTIVITY_TABLES, &mut row_count).await?;
    writer.raw("}}").map_err(io_error)?;

    let mut buffered = writer.into_inner();
    buffered.flush().map_err(io_error)?;
    drop(buffered);

    let bytes = fs::metadata(output)
        .map_err(|error| format!("failed to stat bundle file: {error}"))?
        .len();
    Ok(ExportSummary { row_count, table_count, bytes })
}

async fn write_section<W: Write>(
    writer: &mut BundleWriter<W>,
    pool: &Pool<Sqlite>,
    tables: &[TableSpec],
    row_count: &mut u64,
) -> Result<usize, String> {
    let mut written = 0_usize;
    for (index, spec) in tables.iter().enumerate() {
        writer
            .open_table(spec.name, index == 0)
            .map_err(io_error)?;
        if table_exists(pool, spec.name).await? {
            written += 1;
            let sql = format!("SELECT * FROM \"{}\"", spec.name);
            let mut rows = sqlx::query(&sql).fetch(pool);
            while let Some(row) = rows
                .try_next()
                .await
                .map_err(|error| format!("failed to read {}: {error}", spec.name))?
            {
                writer.row(&row_to_value(&row)).map_err(io_error)?;
                *row_count += 1;
            }
        }
        writer.close_table().map_err(io_error)?;
    }
    Ok(written)
}

/// 表存在探测（池版本）：借一条连接，复用连接版本，避免两处 SQL 漂移。
pub(crate) async fn table_exists(pool: &Pool<Sqlite>, name: &str) -> Result<bool, String> {
    let mut conn = pool
        .acquire()
        .await
        .map_err(|error| format!("failed to acquire connection: {error}"))?;
    table_exists_on(conn.as_mut(), name).await
}

/// 表存在探测（连接/事务版本）：导入侧在事务里探表，不能另借连接（会看到事务外的快照）。
pub(crate) async fn table_exists_on(
    conn: &mut SqliteConnection,
    name: &str,
) -> Result<bool, String> {
    let found: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?")
            .bind(name)
            .fetch_optional(conn)
            .await
            .map_err(|error| format!("failed to probe table {name}: {error}"))?;
    Ok(found.is_some())
}

fn io_error(error: std::io::Error) -> String {
    format!("failed to write bundle: {error}")
}
