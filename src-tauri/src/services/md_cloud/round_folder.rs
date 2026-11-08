//! LocalFolder 那一轮（V0.11.13，设计 §3.5）。**没有网络代码**。
//!
//! 只把当天那份写进用户选的本地目录，上传交给坚果云 / OneDrive 客户端。这条路的
//! 意义是「不想把账号密码交给 Timing 也能有第二份」：所以它连 `infra::secret` 都不读。
//!
//! ## 没有「待传」，但**要留一次成功态**（[V0.11.14] 修 O3）
//!
//! 目标是真目录，写进去就是同步完了：这条路上不产生任何欠账，`pending_since` 永远是 0，
//! `CloudRoundOutcome.pending` 因此填空。但设置页那一栏「今天已上传」读的正是
//! `md_cloud_pending`（`state::status`：行存在 + 无欠账 + 有指纹），一行都不写的话
//! 本地目录模式永远是「今天还没上传」。所以写成功之后补一次
//! `mark_synced(date, None, hash)`，`etag` 记 `NULL` 是准确的——本地目录没有 ETag。
//!
//! ## 一个已知副作用（可接受，故不额外处理）
//!
//! 模式在 folder 与 webdav 之间来回切时，folder 轮会把该日期的 `etag` 覆盖成 `NULL`
//! （`mark_synced` 的 `etag = excluded.etag`），切回 webdav 后那一天的第一次 PUT 就是
//! 无条件覆盖、没有 `If-Match`。接受它的理由：
//!
//! 1. **今天不受影响**：`round_webdav` 的 ④ 先 GET，PUT 用的是这一轮拿回来的 etag，
//!    根本不看这一行；
//! 2. **只剩「切回 webdav 后又变脏的历史日期」**：那份 `etag` 属于另一个远端（本地
//!    目录压根没有 etag 这个概念），留着它去 `If-Match` 只会稳定 412 并永久跳过那天，
//!    比覆盖一次更糟；
//! 3. 与「远端这次没回 ETag」的既有语义完全一致，见 `repositories::md_cloud_pending::mark_synced`。

use std::fs;
use std::path::{Path, PathBuf};

use sqlx::SqlitePool;

use super::{absorb, pending};
use crate::error::AppResult;
use crate::infra::md_backup;
use crate::models::md_cloud_purge::PurgeChannel;
use crate::models::md_sync::{MdSyncBinding, MdSyncReport};
use crate::models::md_sync_channel::MdSyncCloudChannel;
use crate::platform::clock::now_ms;
use crate::repositories::md_cloud_pending;
use crate::services::md_sync::{self, mirror};

/// 一轮：Obsidian 落点 → 本地镜像落点（同一个目录，写进去即同步完）。
///
/// [V0.11.26] 参数从 `&MdSyncCloud` 改为 `&MdSyncCloudChannel`（folder 通路自己的
/// 那份配置），判据与落点解析全部走通路结构；记账固定带 `PurgeChannel::Folder`。
pub async fn run(
    pool: &SqlitePool,
    channel: &MdSyncCloudChannel,
    /* 只在 `#[cfg(not(mobile))]` 的往期清理那一步用到；手机上不装挂点，参数就没人读。
       不加这个属性，安卓目标会多一条 `unused variable` —— 桌面 0 warning 是项目口径。 */
    #[cfg_attr(mobile, allow(unused_variables))]
    bindings: &[MdSyncBinding],
    today: &str,
) -> AppResult<MdSyncReport> {
    let mut report = MdSyncReport::new(now_ms());
    let root: PathBuf = match channel.resolve_root_folder() {
        Ok(path) => path,
        Err(err) => {
            report.errors.push(err);
            return Ok(report);
        }
    };
    /* 必须在云端那轮**之前**登记：`write_section` 靠注册表决定备份文件名前缀，
    登记晚了本轮的备份就会标成 `obsidian`。 */
    md_backup::register_root(root.clone(), "folder");
    crate::log_info!("md cloud: root={}", root.display());
    if let Err(err) = fs::create_dir_all(&root) {
        report.errors.push(super::root_dir_error(&root, &err));
        return Ok(report);
    }

    /* 顺序不可换：Obsidian 那份的用户手改先入库，云端这份再从「已含手改的 SQL」渲染
    出去（设计 §2.1）。反过来会让写出去的副本缺本轮的手改。 */
    let local = md_sync::run(pool).await?;
    absorb(&mut report, local);

    let cloud_report = mirror::run_in(pool, &root.to_string_lossy()).await?;
    /* 只有云端那一步**真的没出错**才记成功：建目录失败、镜像失败（含「写不进这个
    目录」）都不许记——否则设置页会把一次没写出去的一轮说成「今天已上传」。 */
    let wrote_ok = cloud_report.errors.is_empty();
    absorb(&mut report, cloud_report);
    if wrote_ok {
        let hash = today_hash(pool, &root).await;
        if let Some(hash) = hash.as_ref() {
            md_cloud_pending::mark_synced(pool, PurgeChannel::Folder, today, None, hash).await?;
        }
        /* ⑩' 往期清理：与 WebDAV 的「⑨ 之后」并列，**不是同一个函数**（两路取证不同）。
           复用上面同一个 `wrote_ok`；额外要求 `today_hash` 拿到了 —— `wrote_ok` 为真却
           找不到本轮落点文件，说明「没报错、却不知道写到了哪儿」（模板改成子目录 / 写到
           别处），这一档本身可疑，去做不可逆的删除是唯一不该选的方向。 */
        #[cfg(not(mobile))]
        if hash.is_some() {
            /* 同 `round_webdav` 的 ⑩：清理的任何失败都不许污染这一轮的 report（I11）。 */
            if let Err(err) = super::purge::run_folder(pool, &root, bindings, today).await {
                crate::log_warn!("md cloud purge: 记账失败（不影响本轮同步）{err:?}");
            }
        }
    }
    Ok(report)
}

/// 今天这份在云端目录里的内容指纹；找不到文件就返回 `None`（这一轮什么都没落盘，
/// 没有「已上传」可记）。
///
/// 落点是 `root/file`，`file` 是用户可改的模板（默认 `{date}.md`），**不能**写死成
/// `{today}.md`；所以按本轮真正参与的落点算出相对路径，取第一份真实存在的文件。
async fn today_hash(pool: &SqlitePool, root: &Path) -> Option<String> {
    for rel in mirror::mirror_paths(pool).await.ok()? {
        if let Ok(bytes) = fs::read(root.join(rel)) {
            return Some(pending::fingerprint(&bytes));
        }
    }
    None
}
