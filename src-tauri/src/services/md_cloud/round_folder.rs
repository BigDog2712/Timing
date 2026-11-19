//! LocalFolder 那一轮（V0.11.13；0.14.x 改为**事件流落档**）。**没有网络代码**。
//!
//! 把本机新增的计时事件写进用户选的本地目录，上传交给坚果云 / OneDrive 客户端。这条路
//! 的意义是「不想把账号密码交给 Timing 也能有第二份」：所以它连 `infra::secret` 都不读。
//!
//! ## 落档格式：`<目录>/sync/streams/<设备id>/<目标指纹>/<seq>.jsonl`（旧 `sync/events` 只读）
//!
//! 与 WebDAV 那条路逐字同形（同一套 [`super::round_stream`]），区别只在 transport 是本地
//! 文件系统。这一版**停写 md 快照**，理由见 `round_webdav` 的模块头（三条与传输无关）。
//!
//! 目录里已有的 `{date}.md` 不动，也不会自动删：那是用户自己的文件。本地 Obsidian 落点
//! （`bindings`）照旧由 `md_sync::run_with` 渲染 —— 它写的是用户自己的笔记目录。
//!
//! ## 「今天已上传」从哪来
//!
//! 以前这条通路靠补写一行 `md_cloud_pending`（`mark_synced`）让设置页有东西可读；现在
//! 不写 md 了，也就没有「某天的 md 传上去」这件事。状态改由**事件流的游标**回答：
//! 「本机今天的事件是不是都已经在落点里」（见 `state::status_for`）。
//! 目标仍然是真目录，写进去就是同步完了，这条路上不产生欠账。

use std::fs;
use std::path::PathBuf;

use sqlx::SqlitePool;

use super::round_stream;
/* absorb 只被 Obsidian 那段用（`#[cfg(not(mobile))]`），移动端目标不导入。 */
#[cfg(not(mobile))]
use super::absorb;
use crate::error::AppResult;
use crate::infra::md_backup;
use crate::models::md_sync::MdSyncReport;
use crate::models::md_sync_channel::MdSyncCloudChannel;
use crate::platform::clock::now_ms;
use crate::services::md_sync::decision::ConflictMode;
use crate::services::sync_stream::transport::Transport;
/* 只在桌面存在：手机端 `round_with` 在建轮之前就以 `MD_SYNC_CONFIG_INVALID` 拒绝
folder 通路（`md_cloud/mod.rs` 的 `NO_LOCAL_FOLDER_ON_MOBILE`）。 */
#[cfg(not(mobile))]
use crate::services::md_sync;

/// 一轮：本机新增事件 → 本地目录 → 对端分段 → 折叠，然后渲染本地 Obsidian 落点。
pub async fn run(
    pool: &SqlitePool,
    channel: &MdSyncCloudChannel,
    #[cfg_attr(mobile, allow(unused_variables))] mode: ConflictMode,
) -> AppResult<MdSyncReport> {
    let mut report = MdSyncReport::new(now_ms());
    let root: PathBuf = match channel.resolve_root_folder() {
        Ok(path) => path,
        Err(err) => {
            report.errors.push(err);
            return Ok(report);
        }
    };
    if let Err(err) = fs::create_dir_all(&root) {
        report.errors.push(super::root_dir_error(&root, &err));
        return Ok(report);
    }
    /* 登记这个根属于「本地目录」通路：**不再往这里写 md**，但 `md_backup` 仍要按这个
    归属回答「这份备份该恢复到哪里」（用户在备份列表里点恢复时，落点由它决定）。 */
    md_backup::register_root(root.clone(), "folder");
    crate::log_info!("md cloud: root={}", root.display());

    let transport = Transport::Folder(root);
    /* 返回值只决定「这一轮算不算失败」，本通路没有退避（它不发网络请求）。 */
    let _ok = round_stream::run(pool, &transport, &mut report).await;

    /* 本地 Obsidian 落点：用户的笔记目录，不是传输落点。桌面专属——手机端走不到这里。 */
    #[cfg(not(mobile))]
    {
        let local = md_sync::run_with(pool, mode).await?;
        absorb(&mut report, local);
    }
    Ok(report)
}
