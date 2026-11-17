//! 事件流半轮（folder / webdav 两条通路共用）：先 push 本机新增事件、再 pull 对端分段。
//!
//! ## 为什么单独一个文件
//!
//! 两条通路只差一个 [`Transport`]，其余必须逐字一致 —— 「设备身份没建立时怎么报」、
//! 「失败进不进 `report.errors`」、「这一轮算不算成功（退避按它记）」这三件事复制两份，
//! 迟早一边改一边忘。所以编排在这里，通路只负责造出 transport。
//!
//! ## 失败口径
//!
//! 传输层错误一律进 `report.errors`，**不折 `AppError`**（架构 §7）：一轮里 pull 失败
//! 不该让「push 已经成功」这件事跟着变成整体失败，也不该让托盘拿不到本轮的计数。
//! 返回值 `ok` 只回答一件事：**这一轮该不该记退避**。`false` = 至少一处失败，
//! 下一轮按 [`super::backoff`] 的三级阶梯推迟重试（坚果云 600 次 / 30 分钟的窗口）。

use sqlx::SqlitePool;

use super::super::sync_stream::{self, transport::Transport};
use crate::models::md_sync::{MdSyncKind, MdSyncReport};

/// 跑一轮事件流。返回 `false` = 本轮有失败，调用方据此记退避。
pub(super) async fn run(
    pool: &SqlitePool,
    transport: &Transport,
    report: &mut MdSyncReport,
) -> bool {
    /* 没有身份就没有 uid，事件传不出去也认不出对端。这条**必须说出来**：静默跳过会让
       设置页的「今天还没上传」看起来像网络问题，而真正的原因是本机身份没认领。 */
    let Some(device_id) = crate::services::identity::install_id() else {
        report.errors.push(
            "本机设备身份还没建立（install_id 读不到）：这一轮没有传任何事件".into(),
        );
        return false;
    };
    let mut ok = true;

    match sync_stream::push_new_events(pool, transport, device_id).await {
        Ok(summary) => {
            if summary.segment_seq > 0 {
                /* 「导出」= 写出去的分段数（事件流一轮最多写一段），与 md 时代的
                   「写文件的落点数」同一个位置、同一个含义：这一轮往远端写出了几份。 */
                report.exported += 1;
                crate::log_info!(
                    "sync stream push: seq={} events={} bytes={}",
                    summary.segment_seq,
                    summary.events,
                    summary.bytes
                );
            }
            if !summary.errors.is_empty() {
                ok = false;
                report.errors.extend(summary.errors);
            }
        }
        Err(err) => {
            ok = false;
            report.errors.push(err.message);
        }
    }

    match sync_stream::pull_segments(pool, transport, device_id).await {
        Ok(summary) => {
            if summary.applied > 0 {
                /* `imported` 的读者只有两个：`touched()`（决定要不要广播一次刷新）与
                   托盘那句「导入 N 条」。对端事件落库确实改写了 `time_records`，
                   所以这里记的是**实际新落下的事件数**，不是「几台设备」。 */
                report.note_imported(MdSyncKind::Timers, summary.applied as u32);
                crate::log_info!(
                    "sync stream pull: peers={} segments={} events={} applied={}",
                    summary.peers,
                    summary.segments,
                    summary.events,
                    summary.applied
                );
            }
            if !summary.errors.is_empty() {
                ok = false;
                report.errors.extend(summary.errors);
            }
            /* 警告只落日志，**不**改 `ok`：见 `pull::peers_of` 的注释 —— 用它判失败会让
               一个与同步无关的远端条目（坚果云的 `unix-directory`）把整轮拖进退避。 */
            for warning in &summary.warnings {
                crate::log_warn!("sync stream pull: {warning}");
            }
        }
        Err(err) => {
            ok = false;
            report.errors.push(err.message);
        }
    }
    ok
}
