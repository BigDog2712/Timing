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
//! ## 远端错误文案在这里「翻译成人话」
//!
//! 前端把 `message` 原样透出（设计 §6-6），所以 `HTTP 401` 这种给开发者看的话不许
//! 出去。`fail_text` 是唯一出口，`fail_tag` 是给日志的分类型词（`fail=Auth`）。

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

/// 远端错误 → 日志里的分类词（`md cloud out: <date>.md fail=<这个>`）。
pub(super) fn fail_tag(err: &WebdavError) -> &'static str {
    match err {
        WebdavError::Auth => "Auth",
        WebdavError::Forbidden => "Forbidden",
        WebdavError::RateLimited => "RateLimited",
        WebdavError::Precondition => "Precondition",
        WebdavError::NotFound => "NotFound",
        WebdavError::Timeout => "Timeout",
        WebdavError::Network(_) => "Network",
        WebdavError::Server(_) => "Server",
    }
}

/// 远端路径的展示形态（设计 §8-1：**唯一出口**，别处不许自己拼引号）。
///
/// 空串 = 服务地址根目录：直接显示 `「」` 会让用户以为路径丢了。
pub(crate) fn dir_label(dir: &str) -> String {
    let dir = dir.trim();
    if dir.is_empty() {
        "（服务地址根目录）".to_string()
    } else {
        format!("「{dir}」")
    }
}

/// 远端错误 → 给用户看的一句话（前端原样展示，不要二次包装）。
///
/// `remote_dir` 是**规范化后的** `target.base_path`（形如 `/Timing/md`）：PRD 5.2 口径 1
/// 要求文案里带出真实路径，用户才知道该去网盘网页版建哪个目录。空串交给 `dir_label`。
///
/// 口径 2（状态码只进日志）：这里**任何一句都不许出现裸状态码**——`\d{3}` 零命中由
/// `tests/md_webdav_dir.rs::fail_text_carries_real_path` 机器断言。状态码由
/// `fail_tag` 进日志，排障时看日志，用户只看能照做的话。
pub(crate) fn fail_text(err: &WebdavError, remote_dir: &str) -> String {
    let label = dir_label(remote_dir);
    match err {
        WebdavError::Auth => {
            "账号或应用密码不对（坚果云要用应用密码，在网页版 → 账户信息 → 安全选项里添加）".into()
        }
        WebdavError::Forbidden => format!(
            "账号能登录，但没有往{label}写文件的权限。\
             请确认这个目录属于你的账号、没被设成只读，或本月上传量还没用完。"
        ),
        WebdavError::RateLimited => "坚果云限流了，稍后会自动重试".into(),
        WebdavError::Precondition => "远端这份在你上传前被改过，本轮没有覆盖".into(),
        WebdavError::NotFound => format!("远端目录{label}还不存在：请先在坚果云网页版建好目录"),
        WebdavError::Timeout => "连接超时，稍后会自动重试".into(),
        WebdavError::Network(message) => format!("连不上 WebDAV：{message}"),
        /* 409 = 父集合不存在且服务端不让程序建。这是唯一一条用户**当场能自己解决**的
        远端错误，所以要说清「去哪、按什么路径、建几级」。 */
        WebdavError::Server(409) => format!(
            "云端目录{label}还不存在，这台服务器不允许程序自动建。\
             请到网盘网页版按这个路径手动建好目录（含每一级），再点「测试连接」。"
        ),
        /* 400 = 服务端不接受这个名字。字符集是最常见的成因，直接给可照做的规则。 */
        WebdavError::Server(400) => format!(
            "远端目录{label}里有服务端不接受的字符。\
             请把目录名改成只用字母、数字、- 和 _，不要用 ? # % 空格，也不要留全角斜杠。"
        ),
        /* 5xx 是**真的会退避重试**，这句话对用户有用（主理人裁决：保句子、去数字）。 */
        WebdavError::Server(code) if (500..600).contains(code) => {
            "WebDAV 服务暂时出错，稍后会自动重试；\
             如果一直这样，请把日志里带 md cloud out 的那几行发给开发者。"
                .into()
        }
        /* 兜底（其余 4xx、423 Locked 等）：状态码对用户零信息量，只进日志。 */
        WebdavError::Server(_) => {
            "WebDAV 服务拒绝了这次写入，没有给出可读的原因。\
             请把日志里带 md cloud out 的那几行发给开发者。"
                .into()
        }
    }
}

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
