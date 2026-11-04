//! 便利贴仓库（`notes` 表）。仅 SQL + 行映射，不含业务规则。SQL 全参数化（禁拼接）。

use sqlx::{QueryBuilder, Sqlite, SqlitePool};

use crate::error::AppResult;
use crate::models::note::{Note, NoteGeometry, NoteGeometryPatch};

const COLS: &str = "id, item_id, content, pos_x, pos_y, width, height, is_open, is_pinned, \
                    created_at, updated_at";

/// 按 id 查询（排除已软删除）。
pub async fn find_by_id(pool: &SqlitePool, id: i64) -> AppResult<Option<Note>> {
    let sql = format!("SELECT {COLS} FROM notes WHERE id = ? AND deleted_at IS NULL");
    Ok(sqlx::query_as::<_, Note>(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await?)
}

/// 列表（`itemId` 缺省 = 全部；排序 `updated_at DESC`）。
pub async fn list(pool: &SqlitePool, item_id: Option<i64>) -> AppResult<Vec<Note>> {
    let mut qb =
        QueryBuilder::<Sqlite>::new(format!("SELECT {COLS} FROM notes WHERE deleted_at IS NULL"));
    if let Some(v) = item_id {
        qb.push(" AND item_id = ").push_bind(v);
    }
    qb.push(" ORDER BY updated_at DESC, id DESC");
    Ok(qb.build_query_as::<Note>().fetch_all(pool).await?)
}

/// 启动恢复用：`is_open=1 AND deleted_at IS NULL` 的便利贴（热点索引 `idx_notes_open`）。
/// 生产路径已不自动重开（V0.3.9），仅测试使用；标 `cfg(test)` 避免 dead_code。
#[cfg(test)]
pub async fn list_open(pool: &SqlitePool) -> AppResult<Vec<Note>> {
    let sql = format!(
        "SELECT {COLS} FROM notes WHERE is_open = 1 AND deleted_at IS NULL ORDER BY id ASC"
    );
    Ok(sqlx::query_as::<_, Note>(&sql).fetch_all(pool).await?)
}

/// 已打开的便利贴数量（`is_open=1 AND deleted_at IS NULL`；热点索引 `idx_notes_open`）。
pub async fn count_open(pool: &SqlitePool) -> AppResult<i64> {
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM notes WHERE is_open = 1 AND deleted_at IS NULL")
            .fetch_one(pool)
            .await?;
    Ok(count)
}

/// 启动时清掉「上次没收纳」的打开标记（V0.3.9）。
///
/// `is_open` 只在「点黄点收纳」时归零；应用退出 / 崩溃不会清零。既然启动不再自动
/// 重开便利贴（见 `services::note::reset_open`），这些残留只会在「最多 20 张」的
/// 打开计数里占位，故启动统一归零，语义回到「当前真的开着窗」。
pub async fn clear_open(pool: &SqlitePool) -> AppResult<u64> {
    let res = sqlx::query("UPDATE notes SET is_open = 0 WHERE is_open = 1 AND deleted_at IS NULL")
        .execute(pool)
        .await?;
    Ok(res.rows_affected())
}

/// 插入并返回新 id（`is_open` 默认 0；窗口由 `open_note_window` 负责）。
pub async fn insert(
    pool: &SqlitePool,
    item_id: Option<i64>,
    content: &str,
    geom: NoteGeometry,
    now: i64,
) -> AppResult<i64> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO notes \
         (item_id, content, pos_x, pos_y, width, height, is_open, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?) RETURNING id",
    )
    .bind(item_id)
    .bind(content)
    .bind(geom.pos_x)
    .bind(geom.pos_y)
    .bind(geom.width)
    .bind(geom.height)
    .bind(now)
    .bind(now)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

/// 部分更新（仅传非 None 字段）。`item_id` 三态：改值 / 置 NULL（解绑）/ 不动。
///
/// 新建行的 `is_pinned` 不在本函数参数里：由列默认值 `1`（置顶）给出，
/// 与 AC-64「默认置顶」一致，避免每个调用点都要传一次 true。
pub async fn update(
    pool: &SqlitePool,
    id: i64,
    content: Option<&str>,
    item_id: Option<Option<i64>>,
    geom: NoteGeometryPatch,
    is_pinned: Option<bool>,
    now: i64,
) -> AppResult<()> {
    let mut qb = QueryBuilder::<Sqlite>::new("UPDATE notes SET updated_at = ");
    qb.push_bind(now);
    if let Some(v) = content {
        qb.push(", content = ").push_bind(v.to_string());
    }
    match item_id {
        Some(Some(v)) => {
            qb.push(", item_id = ").push_bind(v);
        }
        Some(None) => {
            qb.push(", item_id = NULL");
        }
        None => {}
    }
    if let Some(v) = geom.pos_x {
        qb.push(", pos_x = ").push_bind(v);
    }
    if let Some(v) = geom.pos_y {
        qb.push(", pos_y = ").push_bind(v);
    }
    if let Some(v) = geom.width {
        qb.push(", width = ").push_bind(v);
    }
    if let Some(v) = geom.height {
        qb.push(", height = ").push_bind(v);
    }
    if let Some(v) = is_pinned {
        qb.push(", is_pinned = ").push_bind(v);
    }
    qb.push(" WHERE id = ")
        .push_bind(id)
        .push(" AND deleted_at IS NULL");
    qb.build().execute(pool).await?;
    Ok(())
}

/// 设置窗口打开态（`is_open`）。
pub async fn set_open(pool: &SqlitePool, id: i64, is_open: bool, now: i64) -> AppResult<()> {
    sqlx::query("UPDATE notes SET is_open = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
        .bind(is_open)
        .bind(now)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// 软删除（置 `deleted_at` / `updated_at`）。
pub async fn soft_delete(pool: &SqlitePool, id: i64, now: i64) -> AppResult<()> {
    sqlx::query(
        "UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(now)
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}
