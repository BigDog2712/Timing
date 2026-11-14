//! 事项块投影（`focus_blocks`，活动库）与子记录切片取数。
//!
//! ## 判据：清空本表必须能从 `time_records` 完整重造
//!
//! 这条是「投影」与「双写」的分界线。投影的每一列都能从业务库算出来（外加 `items`
//! 的名字与分类），所以清表重推不会丢任何用户数据。反之，任何「只有这里才有」的列
//! 都意味着它其实是第三份真源。
//!
//! ## 为什么读 `time_records` 要过滤 `deleted_at IS NULL`
//!
//! 丢弃的会话（低于最短记录时长 / 用户点了丢弃）留在业务库里但 `deleted_at` 非空。
//! 不过滤的话，时间轴上会冒出用户明明「丢掉」的那一段。
//!
//! ## 为什么切片读事实时也过滤 `deleted_at`
//!
//! `sessions` 的删除是硬删（活动库的读模型靠自己重建），但导入批次删除是软删；
//! 两种都过滤一遍比记住「哪张表用哪种」更便宜。

use sqlx::{Pool, Row, Sqlite};

mod read;

pub use read::{block_detail, list_blocks, BlockDetailDto};

/// 投影写入统计（命令出参：让用户知道「同步了多少块」）。
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionReport {
    pub upserted: usize,
    pub skipped: usize,
}

/// 一个块（命令出参）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusBlockDto {
    pub uid: String,
    pub device_id: String,
    pub item_uid: String,
    pub item_name: String,
    pub category_key: Option<String>,
    pub start_time: i64,
    /// null = 进行中
    pub end_time: Option<i64>,
}


/// 从业务库把会话投影进活动库的 `focus_blocks`。
///
/// `since_ms` 之前的块不动（增量）；传 `None` 表示全量重推（修复用，数据量大时慢）。
pub async fn project(
    business: &sqlx::SqlitePool,
    activity: &Pool<Sqlite>,
    since_ms: Option<i64>,
) -> Result<ProjectionReport, String> {
    let sql = match since_ms {
        Some(_) => {
            "SELECT r.uid, r.device_id, i.uid AS item_uid, i.name AS item_name,
                    i.category_key, r.started_at, r.ended_at
               FROM time_records r JOIN items i ON i.id = r.item_id
              WHERE r.deleted_at IS NULL AND r.uid IS NOT NULL AND i.uid IS NOT NULL
                AND r.started_at >= ?1"
        }
        None => {
            "SELECT r.uid, r.device_id, i.uid AS item_uid, i.name AS item_name,
                    i.category_key, r.started_at, r.ended_at
               FROM time_records r JOIN items i ON i.id = r.item_id
              WHERE r.deleted_at IS NULL AND r.uid IS NOT NULL AND i.uid IS NOT NULL"
        }
    };
    let mut query = sqlx::query(sql);
    if let Some(since) = since_ms {
        query = query.bind(since);
    }
    let rows = query
        .fetch_all(business)
        .await
        .map_err(|error| format!("failed to read business sessions for projection: {error}"))?;

    let mut report = ProjectionReport::default();
    let now_ms = crate::infra::insight::clock::unix_timestamp_millis_i64();
    for row in &rows {
        let uid: String = row.get("uid");
        let device_id: String = row.get("device_id");
        let item_uid: String = row.get("item_uid");
        /* `device_id` 是哨兵 `''` 的行跳过：它还没被认领，uid 里也没有真实属主，
           投影过来只会让「按设备筛选」多出一个空设备。启动认领之后重推即可。 */
        if device_id.trim().is_empty() {
            report.skipped += 1;
            continue;
        }
        sqlx::query(
            "INSERT INTO focus_blocks(uid, device_id, item_uid, item_name, category_key,
                                      start_time, end_time, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(uid) DO UPDATE SET
                 device_id = excluded.device_id,
                 item_uid = excluded.item_uid,
                 item_name = excluded.item_name,
                 category_key = excluded.category_key,
                 start_time = excluded.start_time,
                 end_time = excluded.end_time,
                 updated_at_ms = excluded.updated_at_ms",
        )
        .bind(&uid)
        .bind(&device_id)
        .bind(&item_uid)
        .bind(row.get::<String, _>("item_name"))
        .bind(row.get::<Option<String>, _>("category_key"))
        .bind(row.get::<i64, _>("started_at"))
        .bind(row.get::<Option<i64>, _>("ended_at"))
        .bind(now_ms)
        .execute(activity)
        .await
        .map_err(|error| format!("failed to project focus block `{uid}`: {error}"))?;
        report.upserted += 1;
    }
    Ok(report)
}

/// 把 `focus_blocks` 的一行读成 DTO（读侧三个函数共用，所以放这里）。
pub(crate) fn to_block_dto(row: &sqlx::sqlite::SqliteRow) -> FocusBlockDto {
    FocusBlockDto {
        uid: row.get("uid"),
        device_id: row.get("device_id"),
        item_uid: row.get("item_uid"),
        item_name: row.get("item_name"),
        category_key: row.get("category_key"),
        start_time: row.get("start_time"),
        end_time: row.get("end_time"),
    }
}
