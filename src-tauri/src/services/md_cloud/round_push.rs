//! PUT 与补传（V0.11.13，设计 §2.3 的 ⑧⑨）。
//!
//! 从 `round_webdav` 拆出来（单文件 ≤300 行纪律；那边光是 GET → 两轮 `sync_all` →
//! 算指纹就已经把预算用掉大半）。这里只做「把一份已经是合并结果的文件送上去」，
//! 不再合并——理由见设计 §2.3：欠账那天的合并结果早在本地 `<cloud_root>/<date>.md` 里
//! 了，补传只是把终态送上去。
//!
//! ## 412 分两种，口径不能混（[V0.11.13] 补齐今天那一支）
//!
//! - **今天**（任务书 §4.5）：重拉 → 重跑合并 → 再用新 ETag PUT 一次，**只重试一次**；
//!   正文在 `round_conflict`（那边要动合并，与「只送终态」是两件事）。
//!   理由：今天那份还在长，两端的手改都该留下，等下一轮不代表谁赢，只是把冲突往后推。
//! - **历史**（`push_history`）：跳过、不覆盖、记一条 error。那天的合并结果早就在本地
//!   文件里，没必要隔一天再去争远端。
//!
//! 两种都**不会**静默丢掉一端的手改——这是「宁可晚一天同步，也不要丢」的底线。
//!
//! ## 远端错误文案在 `text.rs`
//!
//! 前端把 `message` 原样透出（设计 §6-6），所以 `HTTP 401` 这种给开发者看的话不许
//! 出去。`fail_text` 是唯一出口，`fail_tag` 是给日志的分类型词（`fail=Auth`）。
//! [V0.11.16] 那张表搬去了 `text.rs`（「测试连接」的三关也用同一张），本文件只 re-export。

use std::fs;
use std::path::Path;

use sqlx::SqlitePool;

use super::round_conflict;
use super::{backoff, pending};
use crate::error::AppResult;
use crate::infra::md_webdav::{self, WebdavError, WebdavTarget};
use crate::models::md_sync::MdSyncReport;
use crate::platform::clock::now_ms;
use crate::repositories::md_cloud_pending as repo;

/* [V0.11.16] 文案表整段搬去 `text.rs`（「测试连接」的三关也要用同一张表：一张表两处
复制，403 迟早出现两套解释）。这里 `pub(crate) use` 回来，于是本文件的 3 个调用点与
`tests/md_webdav_text.rs` 的 `round_push::fail_text` 路径**一字不用改**。
`dir_label` 不在其中：本文件一次都没用过它（它的调用方是 `probe.rs`），re-export 一个
没人用的名字只会换来一条 `unused_imports` 警告。 */
pub(crate) use super::text::{fail_tag, fail_text};

/// 这一轮还能不能继续碰远端：鉴权 / 权限 / 限流属于「继续也是白费」，
/// 超时与 5xx 只影响这一次动作，本地两步照跑。
pub(super) fn fatal(err: &WebdavError) -> bool {
    matches!(
        err,
        WebdavError::Auth | WebdavError::Forbidden | WebdavError::RateLimited
    )
}

/// `etag=<some|none>`：日志里不要把 ETag 原文打出来（各家格式不一，且它对本机无意义）。
pub(super) fn etag_tag(etag: &Option<String>) -> &'static str {
    if etag.is_some() {
        "some"
    } else {
        "none"
    }
}

/// ⑧ 传今天：成功清账，412 走「重拉 → 再合并 → 再 PUT 一次」，其余保留欠账。
///
/// 指纹在这里现算（不占一个参数）：它永远是 `text` 的指纹，让调用方另算一份只是给了
/// 「传进来的 hash 与 text 不是同一份内容」的出错机会。
///
/// `cloud_root` 只为 412 那条路准备（重跑合并要把它当落点根）。`pub(crate)` 是给
/// 「412 重试仍失败」那条单测的入口：整条链路（真 HTTP + 真合并 + 真落库）才算证据。
pub(crate) async fn push_today(
    pool: &SqlitePool,
    target: &WebdavTarget,
    today: &str,
    text: &str,
    etag: Option<&str>,
    cloud_root: &Path,
    report: &mut MdSyncReport,
) -> AppResult<()> {
    let rel = format!("{today}.md");
    let hash = pending::fingerprint(text.as_bytes());
    match md_webdav::put(target, &rel, text.as_bytes(), etag).await {
        Ok(outcome) => {
            backoff::on_success().await;
            repo::mark_synced(pool, today, outcome.etag.as_deref(), &hash).await?;
            crate::log_info!(
                "md cloud out: {}.md bytes={} etag={}",
                today,
                text.len(),
                etag_tag(&outcome.etag)
            );
        }
        Err(WebdavError::Precondition) => {
            round_conflict::resolve(pool, target, today, cloud_root, &hash, report).await?
        }
        Err(err) => {
            backoff::on_failure(now_ms()).await;
            crate::log_warn!("md cloud out: {}.md fail={}", today, fail_tag(&err));
            report.errors.push(fail_text(&err, &target.base_path));
        }
    }
    Ok(())
}

/// ⑨ 历史欠账：升序逐个 PUT。本地没有那天的文件就清账（再攒着也不会产生内容）。
pub(super) async fn push_history(
    pool: &SqlitePool,
    target: &WebdavTarget,
    cloud_root: &Path,
    today: &str,
    report: &mut MdSyncReport,
) -> AppResult<()> {
    for date in pending::dates(pool).await? {
        if date == today {
            continue;
        }
        let rel = format!("{date}.md");
        let path = cloud_root.join(&rel);
        if !path.exists() {
            repo::clear(pool, &date).await?;
            crate::log_info!("md cloud out: {date}.md skip=missing");
            continue;
        }
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(err) => {
                report.errors.push(format!("读不到 {rel}：{err}"));
                crate::log_warn!("md cloud out: {date}.md fail=Read");
                continue;
            }
        };
        let etag = repo::get(pool, &date).await?.and_then(|row| row.etag);
        let hash = pending::fingerprint(&bytes);
        match md_webdav::put(target, &rel, &bytes, etag.as_deref()).await {
            Ok(outcome) => {
                backoff::on_success().await;
                repo::mark_synced(pool, &date, outcome.etag.as_deref(), &hash).await?;
                crate::log_info!(
                    "md cloud out: {date}.md put=ok bytes={} etag={}",
                    bytes.len(),
                    etag_tag(&outcome.etag)
                );
            }
            Err(WebdavError::Precondition) => {
                crate::log_warn!("md cloud out: {date}.md skip=conflict");
                report.errors.push(format!("{date} 远端也改过，本轮没有覆盖"));
            }
            Err(err) => {
                backoff::on_failure(now_ms()).await;
                crate::log_warn!("md cloud out: {date}.md fail={}", fail_tag(&err));
                report.errors.push(fail_text(&err, &target.base_path));
                /* 鉴权/限流之后每个历史日期都会得到同一句错误：一条足够，
                剩下的留给下一轮，别把日志和报告刷成几十行同义句。 */
                if fatal(&err) {
                    break;
                }
            }
        }
    }
    Ok(())
}
