//! 云端状态的读侧投影（V0.11.13，设计 §3.2；V0.11.26 按通路参数化）。**只读**：不跑同步、
//! 不碰远端、不落任何状态。`last_error` 取自 `md_sync` 的运行时状态而不是云端自己的：
//! 云端这一轮的错误经 `report.errors` 返回、**不落库**——「上一轮云端失败了」在下一轮
//! 就会自己变成成功或再来一条，没有留档价值。

use sqlx::SqlitePool;

use super::{today, MdSyncViewCloud};
use crate::error::AppResult;
use crate::infra::secret as secret_store;
use crate::models::md_cloud_purge::PurgeChannel;
use crate::models::md_sync_cloud::{CloudMode, MdSyncCloudStatus};
use crate::repositories::md_cloud_pending;
use crate::services::md_sync;

/// 某一条通路的状态（[V0.11.26] `status` → `status_for(pool, channel)`）。
///
/// `mode` 按通路固定填（`Folder→"localfolder"`、`Webdav→"webdav"`），契约
/// 「字段只增不改不删」；`has_secret` 无条件读 `KEY_WEBDAV`（现状）：块④ 不渲染
/// 密码句，v0.11.18 的前端门控先例平移。
pub(super) async fn status_for(
    pool: &SqlitePool,
    channel: PurgeChannel,
) -> AppResult<MdSyncCloudStatus> {
    let config = md_sync::config::load(pool).await?;
    let today = today();
    let channel_cfg = match channel {
        PurgeChannel::Folder => config.cloud_folder.as_ref(),
        PurgeChannel::Webdav => config.cloud_webdav.as_ref(),
    };
    let has_secret = secret_store::get(secret_store::KEY_WEBDAV)
        .await
        .ok()
        .flatten()
        .is_some();
    /* 已上传 = 行存在、无欠账、指纹已记。只看 `pending_since` 会把「远端有 etag 但
    本地又改过」也报成已上传。记账按通路隔离（[V0.11.26]）。 */
    let today_pushed = md_cloud_pending::get(pool, channel, &today)
        .await?
        .is_some_and(|row| row.pending_since == 0 && row.last_hash.is_some());
    let pending_dates = md_cloud_pending::pending_dates(pool, channel).await?;
    let last_error = md_sync::get_view(pool).await?.status.last_error;
    let purge = super::purge::status(pool, channel).await?;
    Ok(MdSyncCloudStatus {
        enabled: channel_cfg.is_some_and(|cfg| cfg.enabled),
        mode: match channel {
            PurgeChannel::Folder => CloudMode::LocalFolder,
            PurgeChannel::Webdav => CloudMode::Webdav,
        },
        has_secret,
        today_pushed,
        pending_dates,
        /* 闸③ 拒绝时的逐字红字走 `last_error` 这个既有出口：`MdCloudPurgeStatus` 不进
           线缆（`#[serde(skip)]`），而块④ 的红字位就是 `status.lastError`。 */
        last_error: purge.overlap_note.clone().or(last_error),
        purge,
    })
}

/// 设置页一次拿全：基础视图 + 两块状态。`MdSyncViewCloud` 用 `#[serde(flatten)]`，
/// 所以这里直接拼结构体，**不改** `MdSyncView`（它正好 300 行且红线零改动）。
pub(super) async fn view(pool: &SqlitePool) -> AppResult<MdSyncViewCloud> {
    let base = md_sync::get_view(pool).await?;
    let cloud = status_for(pool, PurgeChannel::Webdav).await?;
    let local = status_for(pool, PurgeChannel::Folder).await?;
    Ok(MdSyncViewCloud { base, cloud, local })
}
