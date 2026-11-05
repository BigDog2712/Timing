//! Markdown 同步专用查询（只在同步服务里用，不扩散到通用记录 / 便利贴仓库）。
//!
//! 与通用仓库的边界：
//! - 通用仓库服务 UI 的查询（分页、聚合、编辑）；
//! - 本文件服务「按天列出记录 + 名称」「按 id 批量软删」「导入时改写时间」这类
//!   同步语义。放在一起会让两边都变长，也会让通用仓库混入一次性用例。

use sqlx::SqlitePool;

use crate::error::AppResult;

/// 记录 + 事项名（同步渲染只需要名称，不需要完整 Item）。
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct RecordWithItem {
    pub id: i64,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    /// 非空 = 当前计时段的起点；`None` = 暂停中（或已保存）。
    pub running_since: Option<i64>,
    pub accumulated_sec: i64,
    pub item_name: String,
}

/// 某天**已保存**的记录（按开始时间升序，便于按事项分组）。
///
/// 只认 `status='saved'`：导入侧用它做「第 N 段」对位，进行中的实时段绝不能混进来。
/// 导出侧另走 `active_record_in_day`（进行中的记录也要上屏）。
pub async fn records_for_day(
    pool: &SqlitePool,
    from: i64,
    to: i64,
) -> AppResult<Vec<RecordWithItem>> {
    let rows = sqlx::query_as::<_, RecordWithItem>(
        "SELECT r.id, r.started_at, r.ended_at, r.running_since, r.accumulated_sec, \
                COALESCE(i.name, '未归类') AS item_name \
         FROM time_records r LEFT JOIN items i ON i.id = r.item_id \
         WHERE r.status = 'saved' AND r.deleted_at IS NULL \
           AND r.started_at >= ? AND r.started_at < ? \
         ORDER BY r.started_at ASC, r.id ASC",
    )
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// 某天区间内**正在计时**的那条记录（`uq_records_open` 保证全局最多一条）。
///
/// 与 `records_for_day` 刻意分开，而不是给它加个「是否包含 active」开关：
/// 导入路径必须只看到 saved 行，否则实时段会被当成用户新写的一条记录插进库里。
///
/// 按 `started_at` 归日：昨天 23:00 开始、现在还在跑的会话属于昨天那一天的文件，
/// 不会出现在今天的区块里（已知限制，见 `services::md_sync::export` 模块注释）。
pub async fn active_record_in_day(
    pool: &SqlitePool,
    from: i64,
    to: i64,
) -> AppResult<Option<RecordWithItem>> {
    let row = sqlx::query_as::<_, RecordWithItem>(
        "SELECT r.id, r.started_at, r.ended_at, r.running_since, r.accumulated_sec, \
                COALESCE(i.name, '未归类') AS item_name \
         FROM time_records r LEFT JOIN items i ON i.id = r.item_id \
         WHERE r.status = 'active' AND r.deleted_at IS NULL \
           AND r.started_at >= ? AND r.started_at < ? \
         ORDER BY r.started_at DESC, r.id DESC LIMIT 1",
    )
    .bind(from)
    .bind(to)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// 直接插入一条已保存记录（来源是 Markdown，不经计时状态机）。
pub async fn insert_saved_record(
    pool: &SqlitePool,
    item_id: i64,
    started_at: i64,
    ended_at: i64,
    accumulated_sec: i64,
    now: i64,
) -> AppResult<i64> {
    let id = sqlx::query_scalar(
        "INSERT INTO time_records \
         (item_id, status, started_at, ended_at, accumulated_sec, running_since, mode, target_sec, created_at, updated_at) \
         VALUES (?, 'saved', ?, ?, ?, NULL, 'countup', NULL, ?, ?) RETURNING id",
    )
    .bind(item_id)
    .bind(started_at)
    .bind(ended_at)
    .bind(accumulated_sec)
    .bind(now)
    .bind(now)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

/// 改写一条已保存记录的起止时刻与累计秒数。
pub async fn update_record_times(
    pool: &SqlitePool,
    id: i64,
    started_at: i64,
    ended_at: i64,
    accumulated_sec: i64,
    now: i64,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE time_records \
         SET started_at = ?, ended_at = ?, accumulated_sec = ?, updated_at = ? \
         WHERE id = ? AND status = 'saved' AND deleted_at IS NULL",
    )
    .bind(started_at)
    .bind(ended_at)
    .bind(accumulated_sec)
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// 批量软删（同步删除即软删，保留历史行；查询都过滤 `deleted_at`）。
pub async fn soft_delete_records(pool: &SqlitePool, ids: &[i64], now: i64) -> AppResult<u64> {
    let mut affected = 0;
    for id in ids {
        let result = sqlx::query(
            "UPDATE time_records SET deleted_at = ?, updated_at = ? \
             WHERE id = ? AND deleted_at IS NULL",
        )
        .bind(now)
        .bind(now)
        .bind(id)
        .execute(pool)
        .await?;
        affected += result.rows_affected();
    }
    Ok(affected)
}

/// 便利贴 + 事项名（同步渲染用）。
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct NoteWithItem {
    pub id: i64,
    pub content: String,
    pub updated_at: i64,
    pub item_name: Option<String>,
}

/// 某个本地日**相关**的便利贴：当天创建，或当天被改过。
///
/// 为什么要按天筛：日记是「那一天的记录」。旧实现把全部便利贴写进每一天的文件，
/// 昨天贴的便条会天天跟着出现，换一篇日记就换一份副本，读完不知道哪张是真的。
/// 今天的日记只承载今天动过的便利贴；没动过的留在它自己那天的文件里。
///
/// 注意这带来一个后果（已在 `docs/plugin-spec.md` 写明）：用户把文件模板改成
/// 不带 `{date}` 的固定文件时，跨天会看到区块被「清空」——那是当天的过滤结果，
/// 不是数据丢失。
pub async fn notes_in_day(pool: &SqlitePool, from: i64, to: i64) -> AppResult<Vec<NoteWithItem>> {
    let rows = sqlx::query_as::<_, NoteWithItem>(
        "SELECT n.id, n.content, n.updated_at, i.name AS item_name \
         FROM notes n LEFT JOIN items i ON i.id = n.item_id \
         WHERE n.deleted_at IS NULL \
           AND ((n.created_at >= ? AND n.created_at < ?) \
             OR (n.updated_at >= ? AND n.updated_at < ?)) \
         ORDER BY n.updated_at ASC, n.id ASC",
    )
    .bind(from)
    .bind(to)
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// 从 Markdown 改写便利贴正文 / 归属（时间戳由调用方给）。
pub async fn update_note_from_sync(
    pool: &SqlitePool,
    id: i64,
    item_id: Option<i64>,
    content: &str,
    now: i64,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE notes SET content = ?, item_id = ?, updated_at = ? \
         WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(content)
    .bind(item_id)
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// 软删单张便利贴（同步删除；`note::soft_delete` 的别名，避免跨仓库语义混淆）。
pub async fn soft_delete_note(pool: &SqlitePool, id: i64, now: i64) -> AppResult<u64> {
    let result = sqlx::query(
        "UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(now)
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}
