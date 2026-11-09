//! 记录域命令。

use tauri::State;

use crate::error::AppResult;
use crate::models::common::Paginated;
use crate::models::record::{RecordPatch, TimeRecord};
use crate::models::stats::StatsSummary;
use crate::services;
use crate::state::AppState;

#[tauri::command]
pub async fn list_records(
    state: State<'_, AppState>,
    item_id: Option<i64>,
    from: Option<i64>,
    to: Option<i64>,
    page: Option<i64>,
    limit: Option<i64>,
) -> AppResult<Paginated<TimeRecord>> {
    services::record::list(&state.pool, item_id, from, to, page, limit).await
}

/// 同期活动最多回几条：记录面板那一行只放得下 5 个，多查无用。
#[cfg(desktop)]
const ACTIVITY_LIMIT: i64 = 5;

#[tauri::command]
pub async fn stats_summary(
    state: State<'_, AppState>,
    item_id: Option<i64>,
    from: Option<i64>,
    to: Option<i64>,
) -> AppResult<StatsSummary> {
    let mut summary = services::record::stats(&state.pool, item_id, from, to).await?;
    /* 「同期电脑活动」在这里补，不放进 `services::record`：
    ① 它读的是 Patina 的活动库，属于装配层的事，手机端编不到；
    ② 失败只影响一个旁证条，不该让 `stats_summary` 整体失败——`activity_summary`
       自己吞掉错误并返回空数组，这里拿到的永远是可用数据。 */
    #[cfg(desktop)]
    {
        let (start, end) = activity_window(from, to);
        summary.activity = crate::app::patina_bridge::activity_summary(start, end, ACTIVITY_LIMIT).await;
    }
    Ok(summary)
}

/// 活动查询的时间窗：调用方没给区间时取「今天零点 → 此刻」。
///
/// 记录面板恒传 `from`/`to`，这里是给「只看总量」的调用方兜底——否则 `None` 会落到
/// `activity_summary` 的区间校验里被判成空区间，活动条永远不出现。
#[cfg(desktop)]
fn activity_window(from: Option<i64>, to: Option<i64>) -> (i64, i64) {
    use chrono::{Local, TimeZone};

    let now = Local::now();
    let start = from.unwrap_or_else(|| {
        let midnight = now
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .expect("00:00:00 恒为合法时刻");
        Local
            .from_local_datetime(&midnight)
            .single()
            .map(|dt| dt.timestamp_millis())
            /* 夏令时回拨的那一小时 `single()` 会给 None：退化成「按 UTC 零点」也比 panic 强，
            这条数据是旁证，不值得为它让整个面板失败。 */
            .unwrap_or_else(|| midnight.and_utc().timestamp_millis())
    });
    (start, to.unwrap_or_else(|| now.timestamp_millis()))
}

#[cfg(all(test, desktop))]
mod tests {
    use super::activity_window;

    #[test]
    fn explicit_range_is_passed_through_untouched() {
        assert_eq!(activity_window(Some(100), Some(200)), (100, 200));
    }

    #[test]
    fn missing_bounds_fall_back_to_a_usable_window() {
        // 缺省不能退化成空区间（空区间会让活动条恒不显示），必须 from < to。
        let (start, end) = activity_window(None, None);
        assert!(end > start, "缺省窗口必须非空：{start}..{end}");
    }
}

#[tauri::command]
pub async fn update_record(
    state: State<'_, AppState>,
    id: i64,
    patch: RecordPatch,
) -> AppResult<TimeRecord> {
    let record = services::record::update(&state.pool, id, patch).await?;
    services::md_sync::dirty::mark("record");
    Ok(record)
}

#[tauri::command]
pub async fn delete_record(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    services::record::delete(&state.pool, id).await?;
    services::md_sync::dirty::mark("record");
    Ok(())
}
