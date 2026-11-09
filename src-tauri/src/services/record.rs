//! 记录业务：明细分页、汇总、编辑、删除。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::models::common::Paginated;
use crate::models::constants::{DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, NOTE_MAX_LEN};
use crate::models::enums::record_status;
use crate::models::record::{RecordPatch, TimeRecord};
use crate::models::stats::StatsSummary;
use crate::platform::clock::now_ms;
use crate::repositories::item as item_repo;
use crate::repositories::record as repo;

/// 明细分页（仅 saved）。
pub async fn list(
    pool: &SqlitePool,
    item_id: Option<i64>,
    from: Option<i64>,
    to: Option<i64>,
    page: Option<i64>,
    limit: Option<i64>,
) -> AppResult<Paginated<TimeRecord>> {
    let page = page.unwrap_or(1).max(1);
    let limit = limit.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, MAX_PAGE_SIZE);
    let total = repo::count(pool, item_id, from, to).await?;
    let offset = (page - 1) * limit;
    let items = repo::list_paged(pool, item_id, from, to, limit, offset).await?;
    Ok(Paginated::new(items, total, page, limit))
}

/// 合计汇总（仅 saved）。
pub async fn stats(
    pool: &SqlitePool,
    item_id: Option<i64>,
    from: Option<i64>,
    to: Option<i64>,
) -> AppResult<StatsSummary> {
    let (total_sec, record_count) = repo::totals(pool, item_id, from, to).await?;
    let by_item = repo::stats_by_item(pool, item_id, from, to).await?;
    Ok(StatsSummary {
        total_sec,
        record_count,
        by_item,
        /* 同期活动由**命令层**填（`commands::record_cmd::stats_summary`）：它要读的是
        Patina 的活动库，属于宿主装配层的事。服务层保持纯宿主语义——手机端也编这一份，
        在这里伸手去够 Patina 会把 `#[cfg]` 铺进业务逻辑。 */
        activity: Vec::new(),
    })
}

/// 编辑已保存记录（记录级"目标不存在"复用 ITEM_NOT_FOUND，见契约 R-3）。
pub async fn update(pool: &SqlitePool, id: i64, patch: RecordPatch) -> AppResult<TimeRecord> {
    let existing = repo::find_by_id(pool, id)
        .await?
        .ok_or_else(AppError::item_not_found)?;
    if existing.status != record_status::SAVED {
        return Err(AppError::item_not_found());
    }
    if let Some(new_item) = patch.item_id {
        if item_repo::find_by_id(pool, new_item).await?.is_none() {
            return Err(AppError::item_not_found());
        }
    }
    let started = patch.started_at.unwrap_or(existing.started_at);
    let ended = patch.ended_at.or(existing.ended_at);
    if let Some(ended_at) = ended {
        if ended_at < started {
            return Err(AppError::invalid_duration());
        }
    }
    /* [V0.3.12] 改了起止时刻 → 时长跟着区间走（ADR-030）：用户改的就是「这段时间」。
    只在真的动了时刻时重算 —— 单独改备注 / 事项时保留原来的累计（可能含暂停）。 */
    let accumulated_sec = if patch.started_at.is_some() || patch.ended_at.is_some() {
        ended.map(|end| ((end - started) / 1000).max(0))
    } else {
        None
    };
    let note = patch.note.as_deref().map(clamp_note);

    repo::update_saved(
        pool,
        id,
        patch.item_id,
        repo::SavedTimes {
            started_at: patch.started_at,
            ended_at: patch.ended_at,
            accumulated_sec,
        },
        note.as_deref(),
        now_ms(),
    )
    .await?;
    repo::find_by_id(pool, id)
        .await?
        .ok_or_else(|| AppError::db("记录更新后读取失败"))
}

/// 软删除单条记录（幂等）。
///
/// [V0.11.2] 进行中的会话不许删：删掉只会把它藏起来而不释放 `uq_records_open`
/// 的唯一槽（该索引按 `status='active'` 建，不看 `deleted_at`），之后
/// `start_timer` 永远回「已有进行中的计时」，界面却显示空闲，只能改库恢复。
/// 要作废进行中的会话请走 `discard_timer`。
pub async fn delete(pool: &SqlitePool, id: i64) -> AppResult<()> {
    if let Some(existing) = repo::find_by_id(pool, id).await? {
        if existing.status != record_status::SAVED {
            return Err(AppError::item_not_found());
        }
    }
    repo::soft_delete(pool, id, now_ms()).await
}

fn clamp_note(note: &str) -> String {
    note.chars().take(NOTE_MAX_LEN).collect()
}
