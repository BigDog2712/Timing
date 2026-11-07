//! 云端状态的读侧投影（V0.11.13，设计 §3.2）：设置页要的那两个视图。
//!
//! 从 `mod.rs` 拆出来是为了让那边只剩「判据 + 分派」（它贴着 150 行预算）。这里**只读**：
//! 不跑同步、不碰远端、不落任何状态。
//!
//! `last_error` 取自 `md_sync` 的运行时状态而不是云端自己的：云端这一轮的错误经
//! `report.errors` 返回、**不落库**——落库就要一张新表加一套清理口径，而「上一轮云端
//! 失败了」这件事在下一轮就会自己变成成功或再来一条，没有留档价值。

use sqlx::SqlitePool;

use super::{today, MdSyncViewCloud};
use crate::error::AppResult;
use crate::infra::secret as secret_store;
use crate::models::md_cloud_purge::PurgeChannel;
use crate::models::md_sync_cloud::{CloudMode, MdSyncCloudStatus};
use crate::repositories::md_cloud_pending;
use crate::services::md_sync;

/// 云端通道状态。
pub(super) async fn status(pool: &SqlitePool) -> AppResult<MdSyncCloudStatus> {
    let config = md_sync::config::load(pool).await?;
    let today = today();
    let cloud = config.cloud.as_ref();
    let has_secret = secret_store::get(secret_store::KEY_WEBDAV)
        .await
        .ok()
        .flatten()
        .is_some();
    /* 已上传 = 行存在、无欠账、指纹已记。只看 `pending_since` 会把「远端有 etag 但
    本地又改过」也报成已上传。 */
    let today_pushed = md_cloud_pending::get(pool, &today)
        .await?
        .is_some_and(|row| row.pending_since == 0 && row.last_hash.is_some());
    let pending_dates = md_cloud_pending::pending_dates(pool).await?;
    let last_error = md_sync::get_view(pool).await?.status.last_error;
    /* [V0.11.19 变更 A] 块④ 那一行只读**当前生效通道**的那份记账：另一条通道的失败
       （例如切走前的 WebDAV 认证失败）不该出现在这里，也不该被这里改写。
       通道取法与 `MdSyncCloudStatus.mode` 同源，避免「显示 webdav、读的是 folder」。 */
    let channel = match cloud.map_or(CloudMode::LocalFolder, |cloud| cloud.mode) {
        CloudMode::LocalFolder => PurgeChannel::Folder,
        CloudMode::Webdav => PurgeChannel::Webdav,
    };
    let purge = super::purge::status(pool, channel).await?;
    Ok(MdSyncCloudStatus {
        enabled: cloud.is_some_and(|cloud| cloud.enabled),
        mode: cloud.map_or(CloudMode::LocalFolder, |cloud| cloud.mode),
        has_secret,
        today_pushed,
        pending_dates,
        /* 闸③ 拒绝时的逐字红字走 `last_error` 这个既有出口：`MdCloudPurgeStatus` 不进
           线缆（`#[serde(skip)]`），而块④ 的红字位就是 `status.lastError` —— 新增一个
           DTO 字段等于改契约（78 命令 / 字段只增不改不删，能不加就不加）。 */
        last_error: purge.overlap_note.clone().or(last_error),
        purge,
    })
}

/// 设置页一次拿全：基础视图 + 云端状态。`MdSyncViewCloud` 用 `#[serde(flatten)]`，
/// 所以这里直接拼结构体，**不改** `MdSyncView`（它正好 300 行且本轮零改动）。
pub(super) async fn view(pool: &SqlitePool) -> AppResult<MdSyncViewCloud> {
    let base = md_sync::get_view(pool).await?;
    let cloud = status(pool).await?;
    Ok(MdSyncViewCloud { base, cloud })
}
