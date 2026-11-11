//! 时间记录仓库（time_records 表）：查询 / 汇总 / 编辑 / 软删除。
//! 计时会话生命周期 SQL 见 `record_session`。

use sqlx::{QueryBuilder, Sqlite, SqliteConnection, SqlitePool};

use crate::error::AppResult;
use crate::models::record::TimeRecord;
use crate::models::stats::ItemStats;

/// time_records 查询列（供本模块与 `record_session` 共用）。
pub const COLS: &str =
    "id, item_id, status, started_at, ended_at, accumulated_sec, running_since, \
                        note, mode, target_sec";

/// 统计总量行。
#[derive(sqlx::FromRow)]
struct Totals {
    total_sec: i64,
    cnt: i64,
}

/// 按 id 查询（排除已软删除）。
pub async fn find_by_id(pool: &SqlitePool, id: i64) -> AppResult<Option<TimeRecord>> {
    let sql = format!("SELECT {COLS} FROM time_records WHERE id = ? AND deleted_at IS NULL");
    Ok(sqlx::query_as::<_, TimeRecord>(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await?)
}

/// 编辑已保存记录时可改的时间字段（None = 不动）。
pub struct SavedTimes {
    pub started_at: Option<i64>,
    pub ended_at: Option<i64>,
    pub accumulated_sec: Option<i64>,
}

/// 编辑已保存记录（动态 SET）。
pub async fn update_saved(
    pool: &SqlitePool,
    id: i64,
    item_id: Option<i64>,
    times: SavedTimes,
    note: Option<&str>,
    now: i64,
) -> AppResult<()> {
    let mut qb = QueryBuilder::<Sqlite>::new("UPDATE time_records SET updated_at = ");
    qb.push_bind(now);
    if let Some(v) = item_id {
        qb.push(", item_id = ").push_bind(v);
    }
    if let Some(v) = times.started_at {
        qb.push(", started_at = ").push_bind(v);
    }
    if let Some(v) = times.ended_at {
        qb.push(", ended_at = ").push_bind(v);
    }
    if let Some(v) = times.accumulated_sec {
        qb.push(", accumulated_sec = ").push_bind(v);
    }
    if let Some(v) = note {
        qb.push(", note = ").push_bind(v.to_string());
    }
    qb.push(" WHERE id = ")
        .push_bind(id)
        .push(" AND status = 'saved' AND deleted_at IS NULL");
    qb.build().execute(pool).await?;
    Ok(())
}

/// 软删除单条记录（幂等）。
///
/// [V0.11.2] 只删**已保存**且未删过的行。原先无条件 `UPDATE ... WHERE id = ?`，
/// 一条进行中的会话被删后会「看不见但占着槽」：`uq_records_open` 是
/// `WHERE status='active'` 的部分唯一索引，不过滤 `deleted_at`，于是
/// `find_active` 返回空（用户看到空闲）却再也起不了新计时（唯一冲突）。
pub async fn soft_delete(pool: &SqlitePool, id: i64, now: i64) -> AppResult<()> {
    sqlx::query(
        "UPDATE time_records SET deleted_at = ?, updated_at = ? \
         WHERE id = ? AND status = 'saved' AND deleted_at IS NULL",
    )
    .bind(now)
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// 分页查询已保存记录（started_at DESC）。
pub async fn list_paged(
    pool: &SqlitePool,
    item_id: Option<i64>,
    from: Option<i64>,
    to: Option<i64>,
    limit: i64,
    offset: i64,
) -> AppResult<Vec<TimeRecord>> {
    let mut qb = QueryBuilder::<Sqlite>::new(format!(
        "SELECT {COLS} FROM time_records WHERE status = 'saved' AND deleted_at IS NULL"
    ));
    push_filters(&mut qb, item_id, from, to);
    qb.push(" ORDER BY started_at DESC LIMIT ")
        .push_bind(limit)
        .push(" OFFSET ")
        .push_bind(offset);
    Ok(qb.build_query_as::<TimeRecord>().fetch_all(pool).await?)
}

/// 统计过滤后总条数。
pub async fn count(
    pool: &SqlitePool,
    item_id: Option<i64>,
    from: Option<i64>,
    to: Option<i64>,
) -> AppResult<i64> {
    let mut qb = QueryBuilder::<Sqlite>::new(
        "SELECT COUNT(*) FROM time_records WHERE status = 'saved' AND deleted_at IS NULL",
    );
    push_filters(&mut qb, item_id, from, to);
    Ok(qb.build_query_scalar::<i64>().fetch_one(pool).await?)
}

/// 合计时长与条数。
pub async fn totals(
    pool: &SqlitePool,
    item_id: Option<i64>,
    from: Option<i64>,
    to: Option<i64>,
) -> AppResult<(i64, i64)> {
    let mut qb = QueryBuilder::<Sqlite>::new(
        "SELECT COALESCE(SUM(accumulated_sec), 0) AS total_sec, COUNT(*) AS cnt \
         FROM time_records WHERE status = 'saved' AND deleted_at IS NULL",
    );
    push_filters(&mut qb, item_id, from, to);
    let row: Totals = qb.build_query_as::<Totals>().fetch_one(pool).await?;
    Ok((row.total_sec, row.cnt))
}

/// 按事项聚合（total_sec 降序）。
pub async fn stats_by_item(
    pool: &SqlitePool,
    item_id: Option<i64>,
    from: Option<i64>,
    to: Option<i64>,
) -> AppResult<Vec<ItemStats>> {
    let mut qb = QueryBuilder::<Sqlite>::new(
        "SELECT item_id, COALESCE(SUM(accumulated_sec), 0) AS total_sec \
         FROM time_records WHERE status = 'saved' AND deleted_at IS NULL",
    );
    push_filters(&mut qb, item_id, from, to);
    qb.push(" GROUP BY item_id ORDER BY total_sec DESC");
    Ok(qb.build_query_as::<ItemStats>().fetch_all(pool).await?)
}

/// 补记的幂等键查询：同事项 + 同起点的**已保存**行（P1-01 §2.4）。键取
/// `(item_id, started_at)` 二元组而非三元组：跨零点拆段后首尾两行的区间都不等于原始区间，
/// 三元组匹配不上；毫秒精度下「同事项同起点」与真实计时撞车不可能。代价：同事项同毫秒
/// 起点的两次不同长度补记被判重复——**有意的取向：宁可少记，不可重复记**。
pub async fn find_backfill_duplicate(
    pool: &SqlitePool,
    item_id: i64,
    started_at: i64,
) -> AppResult<Option<TimeRecord>> {
    let sql = format!(
        "SELECT {COLS} FROM time_records \
         WHERE item_id = ? AND started_at = ? AND status = 'saved' AND deleted_at IS NULL \
         ORDER BY id ASC LIMIT 1"
    );
    Ok(sqlx::query_as::<_, TimeRecord>(&sql)
        .bind(item_id)
        .bind(started_at)
        .fetch_optional(pool)
        .await?)
}

/// 补记落库：纯插入一条 `saved` 行，返回新 id。形状**逐字对齐**
/// `record_session.rs::finalize_split` 的 INSERT：`status='saved'`、`running_since=NULL`、
/// `mode='countup'`、`target_sec=NULL`——补记不产生进行中的会话，也不产生倒计时；比那三份
/// 范式多出来的只有 `note` 一列。取 `&mut SqliteConnection` 而非 pool：调用方要把跨零点的
/// 多段插入放进**同一个事务**，否则中途失败留下半条账。
pub async fn insert_saved(
    conn: &mut SqliteConnection,
    item_id: i64,
    started_at: i64,
    ended_at: i64,
    accumulated_sec: i64,
    note: Option<&str>,
    now: i64,
) -> AppResult<i64> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO time_records \
         (item_id, status, started_at, ended_at, accumulated_sec, running_since, \
          mode, target_sec, note, created_at, updated_at) \
         VALUES (?, 'saved', ?, ?, ?, NULL, 'countup', NULL, ?, ?, ?) RETURNING id",
    )
    .bind(item_id)
    .bind(started_at)
    .bind(ended_at)
    .bind(accumulated_sec)
    .bind(note)
    .bind(now)
    .bind(now)
    .fetch_one(&mut *conn)
    .await?;
    Ok(id)
}

/// 追加可选过滤条件（itemId 精确；from 含、to 不含，作用 started_at）。
fn push_filters(
    qb: &mut QueryBuilder<'_, Sqlite>,
    item_id: Option<i64>,
    from: Option<i64>,
    to: Option<i64>,
) {
    if let Some(v) = item_id {
        qb.push(" AND item_id = ").push_bind(v);
    }
    if let Some(v) = from {
        qb.push(" AND started_at >= ").push_bind(v);
    }
    if let Some(v) = to {
        qb.push(" AND started_at < ").push_bind(v);
    }
}
