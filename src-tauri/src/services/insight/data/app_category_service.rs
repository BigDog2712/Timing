//! 应用分类绑定的服务层（活动库）+ 命令 DTO。
//!
//! 三条命令覆盖设置页「应用 → 分类」的全部写入：列、设、删。「设」是幂等的
//! （`(app_key, category_key)` 唯一），所以「把某分类排到首位」只需把它设为更小的
//! `priority`，不必先删后插 —— 先删会有一段「这个应用没有任何分类」的中间态，
//! 那段时间里切片会全落到 `other`。
//!
//! ## 校验口径
//!
//! `category_key` 不校验「分类是否存在」：分类定义的真相在 `classification_settings`
//! 的 KV 快照里，而键可能来自导入数据（一台旧机器上的分类这台还没有）。
//! 拒绝写入只会让用户没法先把绑定准备好；写进来最多是「暂时解析到兜底」，
//! 之后建同名分类就自动生效。

use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite};

use crate::services::insight::data::repositories::app_category;

/// 一行绑定（命令出参）。字段名走 camelCase，与前端 `AppCategoryRow` 一一对应。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppCategoryDto {
    pub app_key: String,
    pub category_key: String,
    pub priority: i64,
}

impl From<app_category::AppCategoryRow> for AppCategoryDto {
    fn from(row: app_category::AppCategoryRow) -> Self {
        Self {
            app_key: row.app_key,
            category_key: row.category_key,
            priority: row.priority,
        }
    }
}

fn normalize_key(label: &'static str, raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} must not be empty"));
    }
    Ok(trimmed.to_string())
}

/// 列表。给 `app_key` 只列那一个应用的（按优先序列出，首个即「分类首位」）。
pub async fn list(
    pool: &Pool<Sqlite>,
    app_key: Option<&str>,
) -> Result<Vec<AppCategoryDto>, String> {
    let key = match app_key {
        Some(raw) => Some(normalize_key("app_key", raw)?),
        None => None,
    };
    Ok(app_category::list(pool, key.as_deref())
        .await?
        .into_iter()
        .map(AppCategoryDto::from)
        .collect())
}

/// 设一条绑定（幂等）。`priority` 越小越靠前，最小者即「分类首位」。
pub async fn set(
    pool: &Pool<Sqlite>,
    app_key: &str,
    category_key: &str,
    priority: i64,
    now_ms: i64,
) -> Result<(), String> {
    let app_key = normalize_key("app_key", app_key)?;
    let category_key = normalize_key("category_key", category_key)?;
    app_category::upsert(pool, &app_key, &category_key, priority, now_ms).await
}

/// 删一条绑定。返回是否真的删掉了一行。
pub async fn remove(
    pool: &Pool<Sqlite>,
    app_key: &str,
    category_key: &str,
) -> Result<bool, String> {
    let app_key = normalize_key("app_key", app_key)?;
    let category_key = normalize_key("category_key", category_key)?;
    app_category::remove(pool, &app_key, &category_key).await
}
