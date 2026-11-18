//! 事项标签的写入规则（仓库之上的一层薄壳）。
//!
//! 命令层不得直接依赖仓库（L5），而标签又确实只有「读全量 / 覆盖写一条」两个动作。
//! 这一层是那条分层边界的落点，不承载规则之外的东西。

use sqlx::SqlitePool;

use crate::error::AppResult;
use crate::models::item_tags::ItemTags;
use crate::repositories::item_tags;

pub async fn list(pool: &SqlitePool) -> AppResult<Vec<ItemTags>> {
    item_tags::list(pool).await
}

pub async fn set(
    pool: &SqlitePool,
    item_id: i64,
    tags: &[String],
    now: i64,
) -> AppResult<Vec<String>> {
    item_tags::set(pool, item_id, tags, now).await
}
