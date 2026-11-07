//! 一批跑完怎么记账：水位（⑦）与 state / day（⑧）（V0.11.19 变更 A，设计 §3.3 / §3.6）。
//!
//! 从 `purge/mod.rs` 拆出来只为行数：那边是**流程**（谁该不该跑、先删什么后删什么），
//! 这里是**记账规则**。两条规则都极容易写错，而且错法都是「静默永久漏删」，所以它们
//! 各自带一段「为什么不是看起来更自然的那种写法」的说明。

use chrono::{Duration, NaiveDate};
use sqlx::SqlitePool;

use super::kv::{write_day, write_state, write_upto};
use crate::error::AppResult;
use crate::models::constants::MD_CLOUD_PURGE_PAUSE_DAYS;
use crate::models::md_cloud_purge::{PurgeChannel, PurgeState};

/// 一批的记账。水位推进靠 `contiguous`：**最后一个「前面没有失败」的成功项**。
#[derive(Default)]
pub(super) struct Outcome {
    pub(super) contiguous: Option<NaiveDate>,
    pub(super) deleted: u32,
    pub(super) failed: u32,
    /// `Some(tag)` = 被不该自愈的错提前中断（`auth` / `forbidden` / `rate` / `eacces`）。
    pub(super) aborted: Option<&'static str>,
}

/// ⑦ 水位：只推进到「最后一个前面没有失败的成功项」。
///
/// 为什么不是「最后一个成功项」：`upto` 是**单调上界**，语义是「这个日期及更早的都确认
/// 清过了」。若第 3 个失败、第 4 个成功，把水位推到第 4 个就让第 3 个永久漏删。代价是
/// 第 4~20 个下一轮会重删一次 —— 它们已经不在远端，`404` 按成功处理，无副作用。
pub(super) async fn advance(pool: &SqlitePool, channel: PurgeChannel, outcome: &Outcome) -> AppResult<()> {
    if outcome.aborted.is_some() {
        /* 中断 = 后面还有没试过的项，水位一动就是永久漏删。 */
        return Ok(());
    }
    let Some(date) = outcome.contiguous else {
        return Ok(());
    };
    write_upto(pool, channel, date).await
}

/// ⑧ state 与 day。
pub(super) async fn finish(
    pool: &SqlitePool,
    channel: PurgeChannel,
    today: &str,
    today_date: NaiveDate,
    mut state: PurgeState,
    outcome: &Outcome,
    truncated: bool,
) -> AppResult<()> {
    state.last_deleted = outcome.deleted;
    state.last_failed = outcome.failed;
    /* 走到这里说明这一轮**没有被闸③ 拒绝**，闸③ 的红字该收了（用户改好配置后那句要消失）。 */
    state.overlap_note.clear();
    if outcome.failed == 0 && outcome.aborted.is_none() {
        state.fail_days = 0;
        state.last_fail_day.clear();
    } else {
        let yesterday = (today_date - Duration::days(1)).format("%Y-%m-%d").to_string();
        if state.last_fail_day == today {
            /* 同一天内多轮失败只算一天，否则一个下午就能把自己暂停掉。 */
        } else if state.last_fail_day == yesterday {
            state.fail_days += 1;
            state.last_fail_day = today.to_string();
        } else {
            state.fail_days = 1;
            state.last_fail_day = today.to_string();
        }
        if state.fail_days >= MD_CLOUD_PURGE_PAUSE_DAYS {
            state.paused = true;
        }
    }
    write_state(pool, channel, &state).await?;
    /* day 的语义是「**整遍**扫过了」，不是「跑过一次」：
       - 成功且没截断 → 写（今天不再扫，I3）；
       - 提前中断 → 写（中断是「今天别再试了」，不是「明天再说」）；
       - 普通失败 → 不写，下一轮接着试（设计 §8.3）；
       - **被截断 → 不写**：还有 candidates 没处理，写下去就等于让首轮大扫（200 天）
         拖成 10 天（I15 的收敛路径）。 */
    if outcome.aborted.is_some() || (outcome.failed == 0 && !truncated) {
        write_day(pool, channel, today).await?;
    }
    Ok(())
}
