//! 412 的补救（V0.11.13，任务书 §4.5）：重拉 → 重跑合并 → 再 PUT 一次，**只重试一次**。
//!
//! 从 `round_push` 拆出来是为了行数（那边装着 ⑧⑨ 两条主路，加上这段就贴着 300 行门禁），
//! 也因为这两件事的判据不同：`round_push` 只回答「把终态送上去」，这里回答「远端抢先
//! 改过之后怎么办」。
//!
//! ```text
//! 412 → GET 远端今天那份
//!     → 覆盖写 <cloud_root>/<today>.md（写前留底）
//!     → mirror::run_in(pool, cloud_root)   ← 这就是「重跑合并」
//!     → 重算指纹 → 用 GET 拿到的**新 ETag** 做 If-Match 再 PUT 一次
//!         成功     → mark_synced（欠账清掉）
//!         仍失败   → 跳过、保留 pending_since、记一条 error
//! ```
//!
//! 只做**今天**：历史日期走 `round_push::push_history`，口径仍是「跳过不覆盖」——那天的
//! 合并结果早就在本地文件里，远端也没有值得隔一天再争的现场。
//!
//! ## 锁
//!
//! `mirror::run_in` 内部会拿 `md_sync::runtime::lock()`。这条路径上**没有人持锁**：
//! `round_webdav::run` 的 ⑤⑥ 是顺序 `await`（各自拿、各自放），⑧ 才进到这里，
//! 两轮 `sync_all` 早已返回。所以这里再拿一次是安全的——但**不要**把这段挪进
//! `sync_all` 的调用栈里，那会自己等自己。

use std::fs;
use std::path::Path;

use sqlx::SqlitePool;

use super::round_push::{etag_tag, fail_tag, fail_text};
use super::{backoff, pending};
use crate::error::AppResult;
use crate::infra::md_backup;
use crate::infra::md_webdav::{self, WebdavTarget};
use crate::models::md_sync::MdSyncReport;
use crate::platform::clock::now_ms;
use crate::repositories::md_cloud_pending as repo;
use crate::services::md_sync::mirror;

/// `hash` 是刚才那次 PUT 想送上去的内容指纹（`push_today` 算的，同一份 `text`）。
pub(super) async fn resolve(
    pool: &SqlitePool,
    target: &WebdavTarget,
    today: &str,
    cloud_root: &Path,
    hash: &str,
    report: &mut MdSyncReport,
) -> AppResult<()> {
    let rel = format!("{today}.md");
    let remote = match md_webdav::get(target, &rel).await {
        Ok(remote) => remote,
        Err(err) => {
            backoff::on_failure(now_ms()).await;
            crate::log_warn!("md cloud out: {today}.md fail={}", fail_tag(&err));
            report.errors.push(fail_text(&err, &target.base_path));
            return Ok(());
        }
    };

    /* 远端已经是「刚才要 PUT 的那一份」，只差记账：`clear` 而不是 `mark_synced`——
    这一轮没拿到可信的 ETag，拿旧的去做 `If-Match` 会稳定 412。 */
    if pending::fingerprint(&remote.bytes) == hash {
        repo::clear(pool, today).await?;
        crate::log_info!("md cloud out: {today}.md skip=unchanged");
        return Ok(());
    }

    /* 远端那份成为本地新的一版（写前留底，与 `round_webdav::land` 同一口径）。 */
    let path = cloud_root.join(&rel);
    if let Ok(existing) = fs::read_to_string(&path) {
        md_backup::save(&path, &existing);
    }
    if let Err(err) = fs::write(&path, &remote.bytes) {
        report.errors.push(format!("写不进云端落点文件：{err}"));
        return Ok(());
    }

    /* 重跑合并：远端手改已经进了落点文件，`sync_all` 按「Markdown 赢」把它导进 SQL 再
    整体重渲染——于是这次 PUT 上去的内容含两端改动。 */
    let merged = mirror::run_in(pool, &cloud_root.to_string_lossy()).await?;
    super::absorb(report, merged);
    let text = text_of(cloud_root, today);
    let merged_hash = pending::fingerprint(text.as_bytes());
    if pending::record_if_changed(pool, today, &text, now_ms()).await? {
        crate::log_info!("md cloud out: {today}.md 合并后内容有变化");
    }

    /* 合并结果是空、而远端有内容：这一 PUT 会把远端清空。与「空文件不 PUT」同一口径，
    宁可留着欠账等下一轮。 */
    if text.trim().is_empty() {
        crate::log_warn!("md cloud out: {today}.md skip=empty-after-merge");
        report
            .errors
            .push(format!("{today} 重拉合并后没有内容，本轮没有覆盖远端"));
        return Ok(());
    }

    /* 唯一的重试：用**刚 GET 到的** ETag 做 If-Match，避免拿上一轮的旧值再吃一次 412。 */
    match md_webdav::put(target, &rel, text.as_bytes(), remote.etag.as_deref()).await {
        Ok(outcome) => {
            /* 重试成功=服务端恢复正常：不清掉退避会让下一轮凭空 `skip=backoff`。 */
            backoff::on_success().await;
            repo::mark_synced(pool, today, outcome.etag.as_deref(), &merged_hash).await?;
            crate::log_info!(
                "md cloud out: {today}.md put=ok retry bytes={} etag={}",
                text.len(),
                etag_tag(&outcome.etag)
            );
        }
        Err(err) => {
            crate::log_warn!(
                "md cloud out: {today}.md skip=conflict-retry fail={}",
                fail_tag(&err)
            );
            report.errors.push(format!(
                "{today} 远端也改过，重试一次仍未成功（下一轮自动重试）：{}",
                fail_text(&err, &target.base_path)
            ));
        }
    }
    Ok(())
}

/// 读回落点文件；读不到当空串（与 `round_webdav` 的 ⑦ 同一口径，不让一次 IO 失败
/// 把整轮折成错误）。
fn text_of(cloud_root: &Path, today: &str) -> String {
    fs::read_to_string(cloud_root.join(format!("{today}.md"))).unwrap_or_default()
}
