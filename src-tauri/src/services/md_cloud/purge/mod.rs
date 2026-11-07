//! 云端往期真删的**骨架**（V0.11.19 变更 A，设计 §3.3 / §3.5 / §3.6 / §3.7）。
//!
//! ## 本文件不许出现任何「候选集怎么算」
//!
//! 两路的取证方式不同（WebDAV 看本地镜像里有同名文件；LocalFolder 看 `md_cloud_pending`
//! 行 + `last_hash` + 当前字节指纹），所以候选集各写一份（`webdav` 与 `folder` 各一个
//! 入口），两者**彼此不调用**、互不 `use`。本文件只做骨架：
//!
//! ```text
//! ① 读 upto / day / state（按通道）→ ② day==today 就返回 → ③ paused 就返回
//! ④ 候选（两路各算各的）→ 升序 → 截断到 MD_CLOUD_PURGE_BATCH
//! ⑤ 逐个删 → ⑥ 成功的逐个 clear → ⑦ 水位只推进到「失败项之前」→ ⑧ 落日志与 state
//! ```
//!
//! 顺序本身就是判据：「排除今天」早于「比水位」在 `gate::past_keep_window` 与两路候选集
//! 里落实；「闸③ 目录重合早于枚举」在 folder 那个入口的第一行落实。
//!
//! ## 为什么不接 `MdSyncReport`
//!
//! 清理是后台维护动作，**任何失败都不许污染主链路**（PRD I11：`report.errors` 里不出现
//! 清理相关句；不弹通知、不弹模态）。接一个 `&mut MdSyncReport` 进来，下一个人迟早顺手
//! 往里 push 一句「清理失败」，于是「今天上传成功」这件事被一条无关的删除失败染红。
//! 用户该看到的那一句走块④（`MdCloudPurgeStatus` + 闸③ 红字），不走这里。
//!
//! ## 六个 KV 键分通道（设计 §3.5）
//!
//! 键名只在 `models::md_cloud_purge::channel_key` 出现，读写全走 `kv`。共用一份的后果都是
//! **永久漏删**：水位共用 → 换通道后水位已过，那一年的文件再也不清；状态共用 → WebDAV
//! 认证失败把根本没有认证的本地目录那条路一起暂停。

pub(crate) mod folder;
mod gate;
mod kv;
mod ledger;
mod webdav;

use std::path::Path;

use chrono::NaiveDate;
use sqlx::SqlitePool;

use self::kv::{day_of, read_day, read_state, read_upto, write_day, write_state};
use super::text;
use crate::error::AppResult;
use crate::infra::md_webdav::{WebdavError, WebdavTarget};
use crate::infra::purge_log;
use crate::models::constants::{MD_CLOUD_PURGE_BATCH, MD_CLOUD_PURGE_KEEP_DAYS};
use crate::models::md_cloud_purge::{PurgeChannel, PurgeState};
use crate::models::md_sync::MdSyncBinding;
use crate::repositories::md_cloud_pending;

pub(crate) use self::kv::{resume, status};
use self::ledger::{advance, finish, Outcome};

/// 本通道这一轮开始前的现场。`None` = ②③ 已决定「这一轮什么都不做」。
struct Plan {
    upto: Option<NaiveDate>,
    state: PurgeState,
}

/// WebDAV 那一轮的 ⑩。只在 ⑧ 的 PUT 真的成功过时由 `round_webdav` 调进来。
pub(crate) async fn run_webdav(
    pool: &SqlitePool,
    target: &WebdavTarget,
    root: &Path,
    today: &str,
) -> AppResult<()> {
    let channel = PurgeChannel::Webdav;
    let Some(today_date) = day_of(today) else {
        return Ok(());
    };
    let Some(plan) = begin(pool, channel, today, today_date).await? else {
        return Ok(());
    };

    let mut batch = webdav::candidates(root, today_date, MD_CLOUD_PURGE_KEEP_DAYS, plan.upto);
    let total = batch.len();
    let truncated = total > MD_CLOUD_PURGE_BATCH;
    if truncated {
        crate::log_info!("md cloud purge: batch={MD_CLOUD_PURGE_BATCH}/{total}");
        batch.truncate(MD_CLOUD_PURGE_BATCH);
    }

    let mut outcome = Outcome::default();
    let mut failed_before = false;
    for (date, name) in &batch {
        let key = date.to_string();
        match webdav::delete_one(target, name).await {
            Ok(code) => {
                crate::log_info!("md cloud purge: {name} status={code}");
                purge_log::append(&key, &format!("status={code}"), "");
                /* 先删成功再清账（PRD §2.6）：先清后删，一旦 DELETE 失败，那天的欠账信息
                   就没了，而远端文件还在。最坏结果只剩「清账失败」→ 下一轮重传（§3.8-4）。 */
                md_cloud_pending::clear(pool, &key).await?;
                outcome.deleted += 1;
                if !failed_before {
                    outcome.contiguous = Some(*date);
                }
            }
            Err(err) => {
                crate::log_warn!("md cloud purge: {name} fail={}", text::fail_tag(&err));
                outcome.failed += 1;
                failed_before = true;
                if let Some(tag) = abort_tag(&err) {
                    /* 401 / 403 / 429 一出现就整批停：逐个试只会把日志刷满、把限流烧掉，
                       而这三档在「同一份凭据 / 同一个配额」下不会因为换一个文件就好。 */
                    crate::log_warn!("md cloud purge: abort={tag}");
                    outcome.aborted = Some(tag);
                    break;
                }
            }
        }
    }
    advance(pool, channel, &outcome).await?;
    finish(pool, channel, today, today_date, plan.state, &outcome, truncated).await
}

/// LocalFolder 那一轮的 ⑩'（六道闸在 `folder.rs`，这里只是骨架）。
pub(crate) async fn run_folder(
    pool: &SqlitePool,
    root: &Path,
    bindings: &[MdSyncBinding],
    today: &str,
) -> AppResult<()> {
    let channel = PurgeChannel::Folder;
    let Some(today_date) = day_of(today) else {
        return Ok(());
    };
    let Some(plan) = begin(pool, channel, today, today_date).await? else {
        return Ok(());
    };

    let mut batch = match folder::candidates(
        pool,
        root,
        bindings,
        today_date,
        MD_CLOUD_PURGE_KEEP_DAYS,
        plan.upto,
    )
    .await
    {
        Ok(list) => list,
        Err(note) => {
            /* 闸③ 重合：**一个文件都不删**（枚举一次都没发生），水位不动，今天不再试。
               红字进块④，日志逐字一行 —— 两处都不是 `report.errors`（见模块头）。 */
            crate::log_warn!("md cloud purge: refused overlap");
            let mut state = plan.state;
            state.overlap_note = note;
            write_state(pool, channel, &state).await?;
            return write_day(pool, channel, today).await;
        }
    };
    let total = batch.len();
    let truncated = total > MD_CLOUD_PURGE_BATCH;
    if truncated {
        crate::log_info!("md cloud purge: batch={MD_CLOUD_PURGE_BATCH}/{total}");
        batch.truncate(MD_CLOUD_PURGE_BATCH);
    }

    let mut outcome = Outcome::default();
    let mut failed_before = false;
    for cand in &batch {
        let key = cand.date.to_string();
        match folder::remove_one(&cand.path, &cand.bytes, crate::infra::md_backup::save_checked) {
            Ok(()) => {
                let abs = cand.path.display();
                /* 一行里同时含 `<date>.md removed` 与绝对路径：I13a 与 I16 两条断言
                   都要在这一行上成立。`(had_unpaid_debt)` 是可见性标记（§3.4-闸⑤），
                   不改变「删不删」。 */
                if cand.had_debt {
                    crate::log_info!(
                        "md cloud purge: {} removed path={abs} (had_unpaid_debt)",
                        cand.name
                    );
                } else {
                    crate::log_info!("md cloud purge: {} removed path={abs}", cand.name);
                }
                purge_log::append(&key, "removed", &abs.to_string());
                /* 留底 → 删 → 再清账（§3.4.2）：那行 `last_hash` 是闸⑤ 的取证依据，
                   先清后删且删失败，这一天就永远进不了候选。 */
                md_cloud_pending::clear(pool, &key).await?;
                outcome.deleted += 1;
                if !failed_before {
                    outcome.contiguous = Some(cand.date);
                }
            }
            Err(folder::RemoveErr::NoBackup) => {
                crate::log_warn!("md cloud purge: {} skip=no_backup", cand.name);
                outcome.failed += 1;
                failed_before = true;
            }
            Err(folder::RemoveErr::Permission) => {
                crate::log_warn!("md cloud purge: abort=eacces");
                outcome.failed += 1;
                outcome.aborted = Some("eacces");
                break;
            }
            Err(folder::RemoveErr::Other(message)) => {
                crate::log_warn!("md cloud purge: {} fail={message}", cand.name);
                outcome.failed += 1;
                failed_before = true;
            }
        }
    }
    advance(pool, channel, &outcome).await?;
    finish(pool, channel, today, today_date, plan.state, &outcome, truncated).await
}

/// ② day 已扫过 → 返回；③ paused → 返回；否则把现场交出去。
async fn begin(
    pool: &SqlitePool,
    channel: PurgeChannel,
    today: &str,
    today_date: NaiveDate,
) -> AppResult<Option<Plan>> {
    if read_day(pool, channel).await.as_deref() == Some(today) {
        /* 一天最多一次：同一轮里被多次调用（手动同步 + 定时那轮撞车）也只会扫一次。 */
        return Ok(None);
    }
    let state = read_state(pool, channel).await?;
    if state.paused {
        crate::log_info!("md cloud purge: paused fail_days={}", state.fail_days);
        return Ok(None);
    }
    let upto = read_upto(pool, channel).await;
    if upto.is_some_and(|upto| upto >= today_date) {
        /* 水位落在今天或未来（被别的设备写脏 / 被手工改成 2099）。今天那份恒不进候选，
           这一轮不可能删掉任何东西；打一行 DEBUG 让排障时看得见，但不刷 INFO 日志
           （I3 / I9b 的判据都是「0 条 purge: 行」）。 */
        crate::log_debug!("md cloud purge: skip=watermark day={today}");
        return Ok(None);
    }
    Ok(Some(Plan { upto, state }))
}

/// 401 / 403 / 429 是「不该自愈」的错，升级为整批中断。
fn abort_tag(err: &WebdavError) -> Option<&'static str> {
    match err {
        WebdavError::Auth => Some("auth"),
        WebdavError::Forbidden => Some("forbidden"),
        WebdavError::RateLimited => Some("rate"),
        _ => None,
    }
}
