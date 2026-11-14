//! 同步簿记用例的共用夹具（只给 `sync_bookkeeping_*_tests` 用）。
//!
//! 单独一个文件是因为两个用例文件都要用同一套 helper，而 `check:size` 的 300 行
//! 是**单文件**硬约束：把 helper 抄两遍既撞限又会在两处漂移。

use crate::services::insight::data::sqlite_pool::prepare_pool_schema;
use sqlx::{Row, SqlitePool};
use std::path::Path;

/// 内存库走到 head（`prepare_pool_schema` 会跑 Migrator + 认领 + ensure_self）。
pub(super) async fn fresh_patina() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    prepare_pool_schema(&pool, Path::new(":memory:")).await.unwrap();
    pool
}

pub(super) async fn insert_session(pool: &SqlitePool, device_id: &str, start_time: i64) -> i64 {
    sqlx::query(
        "INSERT INTO sessions(app_name, exe_name, window_title, start_time, end_time, duration, device_id)
         VALUES ('App', 'app.exe', '', ?1, ?2, ?3, ?4)",
    )
    .bind(start_time)
    .bind(start_time + 500)
    .bind(500_i64)
    .bind(device_id)
    .execute(pool)
    .await
    .unwrap()
    .last_insert_rowid()
}

pub(super) async fn delete_session(pool: &SqlitePool, id: i64) {
    sqlx::query("DELETE FROM sessions WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
}

/// 直写 `updated_at_ms`：`trg_sessions_touch_update` 的 `AFTER UPDATE OF` 列表里没有它，
/// 所以这一句不会被盖戳逻辑改写 —— 这正是「把 OLD 造到未来」的入口。
pub(super) async fn set_updated_at(pool: &SqlitePool, id: i64, value: i64) {
    sqlx::query("UPDATE sessions SET updated_at_ms = ?1 WHERE id = ?2")
        .bind(value)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
}

pub(super) async fn touch_title(pool: &SqlitePool, id: i64, title: &str) {
    sqlx::query("UPDATE sessions SET window_title = ?1 WHERE id = ?2")
        .bind(title)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
}

pub(super) async fn updated_at(pool: &SqlitePool, id: i64) -> i64 {
    sqlx::query_scalar("SELECT updated_at_ms FROM sessions WHERE id = ?1")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

pub(super) async fn uid_of(pool: &SqlitePool, id: i64) -> String {
    sqlx::query_scalar("SELECT uid FROM sessions WHERE id = ?1")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

pub(super) async fn self_device_id(pool: &SqlitePool) -> String {
    sqlx::query_scalar("SELECT install_id FROM devices WHERE is_self = 1")
        .fetch_one(pool)
        .await
        .unwrap()
}

pub(super) async fn tombstone_count(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM sync_tombstone")
        .fetch_one(pool)
        .await
        .unwrap()
}

pub(super) async fn tombstone_deleted_at(pool: &SqlitePool, uid: &str) -> i64 {
    sqlx::query_scalar("SELECT deleted_at_ms FROM sync_tombstone WHERE uid = ?1")
        .bind(uid)
        .fetch_one(pool)
        .await
        .unwrap()
}

pub(super) async fn applied_head(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT MAX(version) FROM _sqlx_migrations")
        .fetch_one(pool)
        .await
        .unwrap()
}

pub(super) async fn table_exists(pool: &SqlitePool, name: &str) -> bool {
    object_exists(pool, "table", name).await
}

pub(super) async fn trigger_exists(pool: &SqlitePool, name: &str) -> bool {
    object_exists(pool, "trigger", name).await
}

pub(super) async fn index_exists(pool: &SqlitePool, name: &str) -> bool {
    object_exists(pool, "index", name).await
}

async fn object_exists(pool: &SqlitePool, kind: &str, name: &str) -> bool {
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sqlite_master WHERE type = ?1 AND name = ?2")
        .bind(kind)
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
        > 0
}

pub(super) async fn column_exists(pool: &SqlitePool, table: &str, column: &str) -> bool {
    sqlx::query(&format!("PRAGMA table_info({table})"))
        .fetch_all(pool)
        .await
        .unwrap()
        .iter()
        .any(|row| row.get::<String, _>("name") == column)
}
