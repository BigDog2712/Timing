//! 六个 KV 键的读写门面 + 块④ 的读侧（V0.11.19 变更 A，设计 §3.5 / §3.6）。
//!
//! 从 `purge/mod.rs` 拆出来只为行数：那边是**骨架**（谁该不该跑、跑完怎么记），
//! 这里是**存取**（键怎么读、值怎么解析）。拆开之后 `mod.rs` 里再也不会顺手写第二份
//! 键名字面量 —— 全部经过 `channel_key`。
//!
//! 读失败一律按「没有」处理：这些键是同步自身的记账，丢了最多多删一次（远端 `404` 与
//! 本地「文件不在」都算成功，幂等），不该让一整轮同步因为一个 KV 读不出来就失败。

use chrono::NaiveDate;
use sqlx::SqlitePool;

use crate::error::AppResult;
use crate::models::md_cloud_purge::{
    channel_key, MdCloudPurgeStatus, PurgeChannel, PurgeKey, PurgeState,
};
use crate::platform::clock::now_ms;
use crate::repositories::settings;

/// 块④ 那一行的读侧（只读当前生效通道）。
pub(crate) async fn status(
    pool: &SqlitePool,
    channel: PurgeChannel,
) -> AppResult<MdCloudPurgeStatus> {
    Ok(read_state(pool, channel).await?.view())
}

/// 「立即同步」的附带动作：解除本通道的暂停并清零计数（另一条通道的现场不动）。
///
/// 只清暂停位与计数，**不动 `day`**：`day` 说的是「今天扫过了」，与「用户想再试一次」
/// 是两件事；把它一起清掉会让一次手动同步在一天里反复扫同一批文件。
pub(crate) async fn resume(pool: &SqlitePool, channel: PurgeChannel) -> AppResult<()> {
    let mut state = read_state(pool, channel).await?;
    if !state.paused && state.fail_days == 0 {
        return Ok(());
    }
    state.paused = false;
    state.fail_days = 0;
    state.last_fail_day.clear();
    write_state(pool, channel, &state).await
}

/// `yyyy-MM-dd` → 日期。手写 / 被别的设备写脏的值一律当「没有」。
pub(crate) fn day_of(raw: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(raw, "%Y-%m-%d").ok()
}

pub(crate) async fn read_kv(pool: &SqlitePool, key: &str) -> Option<String> {
    settings::get_value(pool, key).await.ok().flatten()
}

pub(crate) async fn set_kv(pool: &SqlitePool, key: &str, value: &str) -> AppResult<()> {
    settings::set_value(pool, key, value, now_ms()).await
}

/// 本通道扫过的自然日（`None` = 从没扫过）。
pub(crate) async fn read_day(pool: &SqlitePool, channel: PurgeChannel) -> Option<String> {
    read_kv(pool, channel_key(channel, PurgeKey::Day)).await
}

pub(crate) async fn write_day(pool: &SqlitePool, channel: PurgeChannel, today: &str) -> AppResult<()> {
    set_kv(pool, channel_key(channel, PurgeKey::Day), today).await
}

pub(crate) async fn read_upto(pool: &SqlitePool, channel: PurgeChannel) -> Option<NaiveDate> {
    read_kv(pool, channel_key(channel, PurgeKey::Upto))
        .await
        .as_deref()
        .and_then(day_of)
}

pub(crate) async fn write_upto(
    pool: &SqlitePool,
    channel: PurgeChannel,
    date: NaiveDate,
) -> AppResult<()> {
    set_kv(pool, channel_key(channel, PurgeKey::Upto), &date.to_string()).await
}

pub(crate) async fn read_state(
    pool: &SqlitePool,
    channel: PurgeChannel,
) -> AppResult<PurgeState> {
    let raw = read_kv(pool, channel_key(channel, PurgeKey::State)).await;
    Ok(raw
        .as_deref()
        .and_then(|text| serde_json::from_str(text).ok())
        .unwrap_or_default())
}

pub(crate) async fn write_state(
    pool: &SqlitePool,
    channel: PurgeChannel,
    state: &PurgeState,
) -> AppResult<()> {
    let body = serde_json::to_string(state).unwrap_or_default();
    set_kv(pool, channel_key(channel, PurgeKey::State), &body).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 水位读不出来必须当成「没有水位」：宁可多扫一次（`404` 幂等），不可永久不扫。
    /// chrono 对「不补零」是宽容的（`2026-1-4` → `2026-01-04`），那也安全 ——
    /// 它只会让水位更早，不会让今天的文件进候选（「排除今天」在候选集里，不在这里）。
    #[test]
    fn a_watermark_only_accepts_real_calendar_dates() {
        assert!(day_of("2026-11-04").is_some());
        assert!(day_of("").is_none(), "空串 = 没有水位");
        assert!(day_of("2099-13-45").is_none(), "不是日历日期就不是水位");
        assert!(day_of("昨天").is_none(), "手写中文不是水位");
    }
}
