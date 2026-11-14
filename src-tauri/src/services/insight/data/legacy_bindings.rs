//! 旧 KV 配置 → 新表的一次性回填（设计文档 §13）。
//!
//! ## 迁的是什么
//!
//! | 旧 | 新 |
//! |---|---|
//! | `__app_override::<exe>` 的 `categories[]` | 活动库 `app_category`（`priority` = 数组下标） |
//! | `__app_override::<exe>` 的 `itemBindings[].itemId` | 业务库 `item_app` |
//! | `__app_item_binding::<exe>`（更早的单事项键） | 业务库 `item_app` |
//!
//! 三者的键空间都是 `resolveStatisticalApp(exe)` 归一后的应用键，与 `sessions.app_key`
//! 同一产出函数 —— 这里只做 `to_lowercase + trim`（桌面侧的归一就是小写 exe），
//! **不再实现一遍归一**（仓里踩过：三处各写一份归一 ⇒ 绑了却匹配不上）。
//!
//! ## 为什么是「一次性 + 守卫键」
//!
//! 旧界面仍在写 KV（CRUD 面板还没开），所以不能把回填做成每次启动都跑的镜像：
//! 用户在新面板里改了分类，下一次启动会被旧 KV 覆盖回去。守卫键
//! `__migration_item_centric::v1` 写入后即不再执行；真要重跑，删掉那个键即可
//! （回填本身是幂等 upsert，重复跑不会产生重复行）。
//!
//! ## 为什么失败不阻断
//!
//! 回填只影响「子记录的分类显示得对不对」。让它阻断时间轴 = 一个 KV 里的坏 JSON
//! 把整张卡打成空白。所以：单条解析失败计入 `skipped`，整体失败由调用方记 warn。
//! **但结果必须可见** —— 返回的计数就是为了让设置页能说「迁移了 N 条」，而不是
//! 静默成功后没人知道规则 1 一直没命中。

use serde_json::Value;
use sqlx::{Pool, Sqlite};

use crate::services::identity::install_id;
use crate::services::insight::data::repositories::app_category as app_category_repo;

pub const MIGRATION_GUARD_KEY: &str = "__migration_item_centric::v1";
const APP_OVERRIDE_PREFIX: &str = "__app_override::";
const APP_ITEM_BINDING_PREFIX: &str = "__app_item_binding::";

/// 回填结果（给界面显示「迁移了多少条」，也是排障现场）。
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackfillReport {
    /// 已跑过（守卫键存在），本次什么都没做。
    pub already_done: bool,
    /// 写进 `app_category` 的条数。
    pub app_categories: usize,
    /// 写进 `item_app` 的条数。
    pub item_bindings: usize,
    /// 解析失败 / 指向不存在事项而丢弃的条数。
    pub skipped: usize,
}

/// 从 `__app_override::` / `__app_item_binding::` 回填到新表。
pub async fn backfill(
    business: &sqlx::SqlitePool,
    activity: &Pool<Sqlite>,
    now_ms: i64,
) -> Result<BackfillReport, String> {
    if read_guard(business).await? {
        return Ok(BackfillReport { already_done: true, ..Default::default() });
    }
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT key, value FROM settings
          WHERE key LIKE '__app_override::%' OR key LIKE '__app_item_binding::%'",
    )
    .fetch_all(business)
    .await
    .map_err(|error| format!("failed to read legacy binding keys: {error}"))?;

    let mut report = BackfillReport::default();
    for (key, raw) in rows {
        let Some(app_key) = key
            .strip_prefix(APP_OVERRIDE_PREFIX)
            .or_else(|| key.strip_prefix(APP_ITEM_BINDING_PREFIX))
            .map(|exe| exe.trim().to_lowercase())
            .filter(|exe| !exe.is_empty())
        else {
            report.skipped += 1;
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(&raw) else {
            report.skipped += 1;
            continue;
        };

        if key.starts_with(APP_OVERRIDE_PREFIX) {
            write_categories(activity, &app_key, &value, now_ms, &mut report).await?;
            write_bindings(business, &app_key, &value, now_ms, &mut report).await?;
        } else {
            /* 更早的单事项键：`{"itemId":123}`。它没有分类信息，只补绑定。 */
            write_single_binding(business, &app_key, &value, now_ms, &mut report).await?;
        }
    }
    write_guard(business, now_ms).await?;
    Ok(report)
}

/// `categories[]`（缺失时退回 `category`）→ `app_category`，`priority` = 数组下标。
async fn write_categories(
    activity: &Pool<Sqlite>,
    app_key: &str,
    value: &Value,
    now_ms: i64,
    report: &mut BackfillReport,
) -> Result<(), String> {
    let mut keys: Vec<String> = value
        .get("categories")
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(|item| item.as_str()).map(|s| s.trim().to_lowercase()).collect())
        .unwrap_or_default();
    if keys.is_empty() {
        if let Some(single) = value.get("category").and_then(Value::as_str) {
            keys.push(single.trim().to_lowercase());
        }
    }
    keys.retain(|key| !key.is_empty());
    keys.dedup();
    for (index, category_key) in keys.iter().enumerate() {
        app_category_repo::upsert(
            activity,
            app_key,
            category_key,
            index as i64 * 10,
            now_ms,
        )
        .await?;
        report.app_categories += 1;
    }
    Ok(())
}

/// `itemBindings[].itemId` → `item_app`（`track` 缺省 1）。
async fn write_bindings(
    business: &sqlx::SqlitePool,
    app_key: &str,
    value: &Value,
    now_ms: i64,
    report: &mut BackfillReport,
) -> Result<(), String> {
    let Some(list) = value.get("itemBindings").and_then(Value::as_array) else {
        return Ok(());
    };
    for entry in list {
        match entry.get("itemId").and_then(Value::as_i64) {
            Some(item_id) if item_exists(business, item_id).await? => {
                bind_item(business, item_id, app_key, now_ms).await?;
                report.item_bindings += 1;
            }
            /* 悬空 `itemId`（事项已删）**不写**：写进去就是一条永远解不开的绑定，
               而外键在 SQLite 默认是关的，不会有任何报错。 */
            _ => report.skipped += 1,
        }
    }
    Ok(())
}

async fn write_single_binding(
    business: &sqlx::SqlitePool,
    app_key: &str,
    value: &Value,
    now_ms: i64,
    report: &mut BackfillReport,
) -> Result<(), String> {
    match value.get("itemId").and_then(Value::as_i64) {
        Some(item_id) if item_exists(business, item_id).await? => {
            bind_item(business, item_id, app_key, now_ms).await?;
            report.item_bindings += 1;
        }
        _ => report.skipped += 1,
    }
    Ok(())
}

/// 绑一条并把 `AppError` 翻成字符串（本模块整块用 `Result<_, String>` 的错误面，
/// 与 `focus_blocks` 一致；`AppError` 没有 `Display`，所以取它的 `message`）。
async fn bind_item(
    business: &sqlx::SqlitePool,
    item_id: i64,
    app_key: &str,
    now_ms: i64,
) -> Result<(), String> {
    crate::repositories::item_app::bind(business, item_id, app_key, 1, now_ms)
        .await
        .map_err(|error| format!("failed to bind item `{item_id}` to `{app_key}`: {}", error.message))
}

async fn item_exists(business: &sqlx::SqlitePool, item_id: i64) -> Result<bool, String> {
    let found: Option<i64> = sqlx::query_scalar("SELECT id FROM items WHERE id = ?1")
        .bind(item_id)
        .fetch_optional(business)
        .await
        .map_err(|error| format!("failed to check item `{item_id}`: {error}"))?;
    Ok(found.is_some())
}

async fn read_guard(business: &sqlx::SqlitePool) -> Result<bool, String> {
    let found: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?1")
        .bind(MIGRATION_GUARD_KEY)
        .fetch_optional(business)
        .await
        .map_err(|error| format!("failed to read migration guard: {error}"))?;
    Ok(found.is_some())
}

async fn write_guard(business: &sqlx::SqlitePool, now_ms: i64) -> Result<(), String> {
    /* 守卫值存本机 `device_id`：出问题时能一眼看出是哪台设备跑的迁移。 */
    let stamp = install_id().unwrap_or("unknown").to_string();
    sqlx::query(
        "INSERT INTO settings(key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(MIGRATION_GUARD_KEY)
    .bind(stamp)
    .bind(now_ms)
    .execute(business)
    .await
    .map_err(|error| format!("failed to write migration guard: {error}"))?;
    Ok(())
}

#[cfg(test)]
#[path = "legacy_bindings_tests.rs"]
mod legacy_bindings_tests;
