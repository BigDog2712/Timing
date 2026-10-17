//! 测试支持：为每个用例构造独立临时库（走真实 `infra::db::init_pool` + 0001 迁移），
//! 以及若干断言/建数据辅助。**不参与发布产物**（由 `#[cfg(test)] mod tests` 引入）。

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use sqlx::SqlitePool;

use crate::error::{AppResult, ErrorCode};
use crate::infra::db;

static SEQ: AtomicU64 = AtomicU64::new(0);

/// 每用例一个独立临时目录，避免并行用例相互污染。
pub fn unique_dir(tag: &str) -> PathBuf {
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    std::env::temp_dir().join(format!("tickbar-qa-{tag}-{pid}-{n}-{nanos}"))
}

/// 新建独立空库（已执行 0001 迁移与种子）。
pub async fn fresh_pool(tag: &str) -> SqlitePool {
    let dir = unique_dir(tag);
    db::init_pool(&dir).await.expect("init_pool 应成功")
}

/// 断言结果为 Err 并返回其错误码（失败信息含实际 Ok 值，便于定位）。
#[track_caller]
pub fn expect_err<T: std::fmt::Debug>(r: AppResult<T>) -> ErrorCode {
    match r {
        Ok(v) => panic!("期望 Err，却得到 Ok({v:?})"),
        Err(e) => e.code,
    }
}

/// 执行一条无参写语句（仅测试用建数据）。
pub async fn exec(pool: &SqlitePool, sql: &str) {
    sqlx::query(sql).execute(pool).await.expect("exec 应成功");
}

/// 读取单个 i64 标量。
pub async fn scalar_i64(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(sql)
        .fetch_one(pool)
        .await
        .expect("标量查询应成功")
}

/// 读取单个字符串标量（可空）。
pub async fn scalar_opt_str(pool: &SqlitePool, sql: &str) -> Option<String> {
    sqlx::query_scalar::<_, Option<String>>(sql)
        .fetch_one(pool)
        .await
        .expect("标量查询应成功")
}

/// 当前未删除的 active 会话条数（用于验证「全局最多一条」不变式）。
pub async fn count_active(pool: &SqlitePool) -> i64 {
    scalar_i64(
        pool,
        "SELECT COUNT(*) FROM time_records WHERE status = 'active' AND deleted_at IS NULL",
    )
    .await
}

/// 新建一个普通事项并返回其 id（新库仅有系统事项 id=1，用例按需建 2/3/…）。
pub async fn new_item(pool: &SqlitePool, name: &str) -> i64 {
    crate::services::item::create(pool, name, None)
        .await
        .expect("建事项应成功")
        .id
}

/// 直接插入一条 saved 记录（确定性构造统计/分页数据），返回记录 id。
pub async fn insert_saved(
    pool: &SqlitePool,
    item_id: i64,
    started_at: i64,
    ended_at: i64,
    accumulated_sec: i64,
) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "INSERT INTO time_records \
         (item_id, status, started_at, ended_at, accumulated_sec, running_since, note, created_at, updated_at) \
         VALUES (?, 'saved', ?, ?, ?, NULL, NULL, ?, ?) RETURNING id",
    )
    .bind(item_id)
    .bind(started_at)
    .bind(ended_at)
    .bind(accumulated_sec)
    .bind(started_at)
    .bind(started_at)
    .fetch_one(pool)
    .await
    .expect("插入 saved 记录应成功")
}
