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
    std::env::temp_dir().join(format!("timing-qa-{tag}-{pid}-{n}-{nanos}"))
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

/// 把会话的 `started_at` / `running_since` 同步回拨 ms 毫秒（`running_since` 为 NULL 时保持 NULL）。
///
/// 用途：模拟「已经跑了一段时间」而不必真的 sleep——计时相关用例共用。
pub async fn rewind(pool: &SqlitePool, id: i64, ms: i64) {
    exec(
        pool,
        &format!(
            "UPDATE time_records \
             SET started_at = started_at - {ms}, running_since = running_since - {ms} \
             WHERE id = {id}"
        ),
    )
    .await;
}

/// 新建一个普通事项并返回其 id（新库仅有系统事项 id=1，用例按需建 2/3/…）。
pub async fn new_item(pool: &SqlitePool, name: &str) -> i64 {
    crate::services::item::create(pool, name, None)
        .await
        .expect("建事项应成功")
        .id
}

/// 把「最短记录时长」阈值关到 0，让用例可以自由结束任意短的会话。
///
/// [V0.3.4] `timer::stop` 默认会忽略短于 `min_record_seconds`（出厂 30s）的会话
/// （`discarded = true`，软删、不落库）。**状态机 / 待办联动**的用例只关心迁移本身，
/// 不该被阈值牵连，所以显式关掉它；阈值行为本身在
/// `timer.rs::stop_discards_below_min_record_seconds` 与 `countdown.rs` 里专门验证。
pub async fn allow_short_records(pool: &SqlitePool) {
    crate::services::settings::update_reference(
        pool,
        &crate::models::settings::ReferenceSettingsPatch {
            min_record_seconds: Some(0),
            ..Default::default()
        },
    )
    .await
    .expect("写入最短记录时长应成功");
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
