//! 云端编排的纯函数与小判据（从 `mod.rs` 拆出，本文件撞 300 行）。
//!
//! 这里**不碰 I/O**：`usable_*` 判「配置填全了没有」、`should_autosync` 判「保存后要不要
//! 顺手跑一轮」、`absorb` 合两份报告、`today` 出本地日。搬到子模块后由 `mod.rs`
//! `pub use util::*` 原样导出，调用点一个都没改。
//!
//! 为什么单列：这几个函数是**跨模块共用**的判据（托盘标签 / 调度链 / 两条通路都用
//! `usable_*`），写在编排文件里既挤行数，也让「哪些是纯判定」看不出来。

use chrono::Local;

use crate::models::md_sync::MdSyncReport;
use crate::models::md_sync_channel::MdSyncCloudChannel;
use crate::models::md_sync_config::MdSyncConfig;

/// 今天的本地日期。与文件模板的 `{date}`、`md_cloud_pending.date` **同源**：出现 UTC
/// 日期会让「今天」在晚上 8 点变成明天。
pub(crate) fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

/// 把两轮 `sync_all` 的报告并进一份。`at` 保留本轮起点：一份报告只有一个「发生在」。
pub(crate) fn absorb(target: &mut MdSyncReport, extra: MdSyncReport) {
    target.exported += extra.exported;
    target.imported += extra.imported;
    for kind in extra.kinds {
        if !target.kinds.contains(&kind) {
            target.kinds.push(kind);
        }
    }
    target.errors.extend(extra.errors);
}

/// 建落点目录失败的文案：**必须带路径**（[V0.11.26]）。
pub fn root_dir_error(root: &std::path::Path, err: &std::io::Error) -> String {
    format!("建不了云端落点目录 {}：{err}", root.display())
}

/// folder 通路是否「开了且填全了」。托盘标签 / 调度链 / `round` / `plan_of` 共用——
/// 写第二份必然漂移。总开关**不在**这里判（调用方按自己的语义叠加，与 v0.11.18 的
/// `usable` 口径一致）。
pub(crate) fn usable_folder(config: &MdSyncConfig) -> Option<&MdSyncCloudChannel> {
    config
        .cloud_folder
        .as_ref()
        .filter(|channel| channel.is_usable_folder())
}

/// webdav 通路是否「开了且填全了」。与 `usable_folder` 同一口径。
pub(crate) fn usable_webdav(config: &MdSyncConfig) -> Option<&MdSyncCloudChannel> {
    config
        .cloud_webdav
        .as_ref()
        .filter(|channel| channel.is_usable_webdav())
}

/// 保存之后要不要顺手跑一轮同步（手机端 `md_sync_save` 的判据，[V0.11.14] 修 N2）。
///
/// 1. 总开关关着 → 不跑（`sync_once` 对关闭状态只会返回一份空报告）；
/// 2. **云端可用 → 跑，不问 SAF 授权**；
/// 3. 云端不可用 → 才看 SAF：没授权的那一轮只可能回「同步目录未授权」。
pub fn should_autosync(enabled: bool, cloud_usable: bool, saf_granted: bool) -> bool {
    enabled && (cloud_usable || saf_granted)
}
