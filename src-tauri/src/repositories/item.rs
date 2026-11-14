//! 事项仓库（items 表）。

use sqlx::{QueryBuilder, Sqlite, SqlitePool};

use crate::error::AppResult;
use crate::models::item::Item;

const COLS: &str = "id, name, color, status, is_system, sort_order, remind_at, reminded_at, \
                    is_pinned, created_at, updated_at, parent_id, depth, category_key";

/// 按 id 查询（排除已软删除）。
pub async fn find_by_id(pool: &SqlitePool, id: i64) -> AppResult<Option<Item>> {
    let sql = format!("SELECT {COLS} FROM items WHERE id = ? AND deleted_at IS NULL");
    let item = sqlx::query_as::<_, Item>(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(item)
}

/// 按名称精确查询（排除已软删除；同名多条取最小 id —— V0.3.12 待办→计时映射用）。
///
/// 与 `todos.title` 的匹配口径一致（`COLLATE BINARY`，见 `soft_delete_for_saved_record`）。
/// [0.13] 泛化到任意执行器（连接池或事务）：`todo_create_batch` 要在**事务内**
/// 按标题匹配事项（单条 `todo_create` 路径传 pool 不受影响，泛型两吃）。
pub async fn find_by_name<'a, E>(executor: E, name: &str) -> AppResult<Option<Item>>
where
    E: sqlx::Executor<'a, Database = sqlx::Sqlite>,
{
    let sql = format!(
        "SELECT {COLS} FROM items WHERE name = ? COLLATE BINARY AND deleted_at IS NULL \
         ORDER BY id ASC LIMIT 1"
    );
    let item = sqlx::query_as::<_, Item>(&sql)
        .bind(name)
        .fetch_optional(executor)
        .await?;
    Ok(item)
}

/// 列表（固定任务置顶；排序 `is_pinned DESC, sort_order ASC, id ASC`）。
pub async fn list(pool: &SqlitePool, include_archived: bool) -> AppResult<Vec<Item>> {
    let mut qb =
        QueryBuilder::<Sqlite>::new(format!("SELECT {COLS} FROM items WHERE deleted_at IS NULL"));
    if !include_archived {
        qb.push(" AND status = 'active'");
    }
    qb.push(" ORDER BY is_pinned DESC, sort_order ASC, id ASC");
    let items = qb.build_query_as::<Item>().fetch_all(pool).await?;
    Ok(items)
}

/// 直接子事项数量（排除已软删除）—— 「有子的事项不能再挂到别人下面」的判据。
pub async fn count_children(pool: &SqlitePool, parent_id: i64) -> AppResult<i64> {
    let value: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM items WHERE parent_id = ? AND deleted_at IS NULL",
    )
    .bind(parent_id)
    .fetch_one(pool)
    .await?;
    Ok(value)
}

/// 当前最大 sort_order（无记录返回 0）。
pub async fn max_sort_order(pool: &SqlitePool) -> AppResult<i64> {
    let value: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(sort_order), 0) FROM items WHERE deleted_at IS NULL",
    )
    .fetch_one(pool)
    .await?;
    Ok(value)
}

/// 新行（仓库层入参）。
///
/// 与 `ItemFields` 同型：聚成结构体，因为 `parent_id`/`depth`/`category_key` 加进来后
/// 参数已经是 8 个（`clippy::too_many_arguments`），且按位置传的三个 `Option` 很容易传反
/// —— 它们都是 `Option<&str>` 或 `Option<i64>`，编译器不会替人分辨。
pub struct NewItem<'a> {
    pub name: &'a str,
    pub color: Option<&'a str>,
    pub sort_order: i64,
    pub now: i64,
    pub parent_id: Option<i64>,
    pub depth: i64,
    pub category_key: Option<&'a str>,
}

/// 插入并返回新 id。
///
/// `depth` 由调用方算好传进来（`services::item` 是分层规则的唯一入口）：
/// 仓储层不该知道「2 层硬限」这条业务规则，否则规则会有第二个实现。
pub async fn insert(pool: &SqlitePool, new: NewItem<'_>) -> AppResult<i64> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO items (name, color, status, is_system, sort_order, created_at, updated_at, \
                            parent_id, depth, category_key) \
         VALUES (?, ?, 'active', 0, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(new.name)
    .bind(new.color)
    .bind(new.sort_order)
    .bind(new.now)
    .bind(new.now)
    .bind(new.parent_id)
    .bind(new.depth)
    .bind(new.category_key)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

/// 部分更新字段集合（`None` = 不改动该列）。
///
/// `remind_at` 三态：`Some(Some(v))` 改值、`Some(None)` 置 NULL、`None` 不动。
/// 聚成结构体避免过长参数列表（`clippy::too_many_arguments`）。
#[derive(Debug, Clone, Copy, Default)]
pub struct ItemFields<'a> {
    pub name: Option<&'a str>,
    pub color: Option<&'a str>,
    pub sort_order: Option<i64>,
    pub remind_at: Option<Option<i64>>,
    pub is_pinned: Option<bool>,
    /// 三态同 `remind_at`：`None` 不动、`Some(None)` 置空、`Some(Some(v))` 改值。
    pub parent_id: Option<Option<i64>>,
    pub depth: Option<i64>,
    pub category_key: Option<Option<&'a str>>,
}

/// 部分更新（仅传非 None 字段）。
///
/// 任一 `remind_at` 改动均清 `reminded_at`（重设提醒使提醒复活，K-19）。
pub async fn update(pool: &SqlitePool, id: i64, fields: ItemFields<'_>, now: i64) -> AppResult<()> {
    let mut qb = QueryBuilder::<Sqlite>::new("UPDATE items SET updated_at = ");
    qb.push_bind(now);
    if let Some(v) = fields.name {
        qb.push(", name = ").push_bind(v.to_string());
    }
    if let Some(v) = fields.color {
        qb.push(", color = ").push_bind(v.to_string());
    }
    if let Some(v) = fields.sort_order {
        qb.push(", sort_order = ").push_bind(v);
    }
    match fields.remind_at {
        Some(Some(v)) => {
            qb.push(", remind_at = ").push_bind(v);
            qb.push(", reminded_at = NULL");
        }
        Some(None) => {
            qb.push(", remind_at = NULL");
            qb.push(", reminded_at = NULL");
        }
        None => {}
    }
    if let Some(v) = fields.is_pinned {
        qb.push(", is_pinned = ").push_bind(v);
    }
    match fields.parent_id {
        Some(Some(v)) => {
            qb.push(", parent_id = ").push_bind(v);
        }
        Some(None) => {
            qb.push(", parent_id = NULL");
        }
        None => {}
    }
    if let Some(v) = fields.depth {
        qb.push(", depth = ").push_bind(v);
    }
    match fields.category_key {
        Some(Some(v)) => {
            qb.push(", category_key = ").push_bind(v.to_string());
        }
        Some(None) => {
            qb.push(", category_key = NULL");
        }
        None => {}
    }
    qb.push(" WHERE id = ")
        .push_bind(id)
        .push(" AND deleted_at IS NULL");
    qb.build().execute(pool).await?;
    Ok(())
}

/// 设置状态（active / archived）。
pub async fn set_status(pool: &SqlitePool, id: i64, status: &str, now: i64) -> AppResult<()> {
    sqlx::query("UPDATE items SET status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
        .bind(status)
        .bind(now)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// 软删除。
pub async fn soft_delete(pool: &SqlitePool, id: i64, now: i64) -> AppResult<()> {
    sqlx::query("UPDATE items SET deleted_at = ?, updated_at = ? WHERE id = ?")
        .bind(now)
        .bind(now)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}
