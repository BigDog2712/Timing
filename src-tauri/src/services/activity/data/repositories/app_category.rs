//! 应用 ↔ 分类绑定仓库（`app_category`，活动库）。
//!
//! ## 表的作用
//!
//! 一个应用可以有多个分类：chrome 既是学习工具也是娱乐工具。`priority` 最小者
//! 就是「分类首位」，在事项分类不在该应用的分类集里时兜底 —— 这是
//! `attribution::category` 三条规则的规则 2，全部机制就到这儿，没有第二套。
//!
//! ## 为什么写在活动库
//!
//! 子记录切片（块 ∩ 会话）在同一侧的 `sessions.app_key` 上做，分类解析必须与它同库
//! 才能在一个查询里完成；两个 pool 不能 JOIN。事项的 `category_key` 由
//! `focus_blocks.category_key`（快照）带过来，因此解析过程不需要回读业务库。

use sqlx::{Pool, Row, Sqlite};

/// 一行「应用 → 分类」绑定。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppCategoryRow {
    pub app_key: String,
    pub category_key: String,
    pub priority: i64,
}

/// 列出绑定：给 `app_key` 就只列那个应用的，不给就列全部（设置页总览要它）。
pub async fn list(
    pool: &Pool<Sqlite>,
    app_key: Option<&str>,
) -> Result<Vec<AppCategoryRow>, String> {
    let sql = match app_key {
        Some(_) => {
            "SELECT app_key, category_key, priority FROM app_category
              WHERE app_key = ?1 ORDER BY app_key ASC, priority ASC, category_key ASC"
        }
        None => {
            "SELECT app_key, category_key, priority FROM app_category
              ORDER BY app_key ASC, priority ASC, category_key ASC"
        }
    };
    let mut query = sqlx::query(sql);
    if let Some(key) = app_key {
        query = query.bind(key);
    }
    let rows = query
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to read app categories: {error}"))?;
    Ok(rows
        .iter()
        .map(|row| AppCategoryRow {
            app_key: row.get("app_key"),
            category_key: row.get("category_key"),
            priority: row.get("priority"),
        })
        .collect())
}

/// 写入一条绑定（`(app_key, category_key)` 唯一，重复设置只改 `priority`）。
///
/// `device_id` 必须显式写：`uid`（`c:<device>:<id>`）由 AFTER INSERT 触发器按它发，
/// 漏了它 → uid 恒 NULL → 这条绑定永远不出现在同步分片里，且零报错。
pub async fn upsert(
    pool: &Pool<Sqlite>,
    app_key: &str,
    category_key: &str,
    priority: i64,
    now_ms: i64,
) -> Result<(), String> {
    let device_id = crate::services::identity::install_id().unwrap_or_default();
    sqlx::query(
        "INSERT INTO app_category(app_key, category_key, priority, created_at, updated_at, device_id)
         VALUES (?1, ?2, ?3, ?4, ?4, ?5)
         ON CONFLICT(app_key, category_key)
         DO UPDATE SET priority = excluded.priority, updated_at = excluded.updated_at",
    )
    .bind(app_key)
    .bind(category_key)
    .bind(priority)
    .bind(now_ms)
    .bind(device_id)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to write app category: {error}"))?;
    Ok(())
}

/// 删除一条绑定。返回是否真的删掉了一行。
pub async fn remove(
    pool: &Pool<Sqlite>,
    app_key: &str,
    category_key: &str,
) -> Result<bool, String> {
    let result = sqlx::query("DELETE FROM app_category WHERE app_key = ?1 AND category_key = ?2")
        .bind(app_key)
        .bind(category_key)
        .execute(pool)
        .await
        .map_err(|error| format!("failed to delete app category: {error}"))?;
    Ok(result.rows_affected() > 0)
}
