//! 「保存之后要不要顺手同步一轮」的判据（[V0.11.14] 修 N2）。
//!
//! 真正的调用点（`commands::md_sync_cmd::md_sync_save`）要 `AppHandle`：数据目录、原生
//! 桥、事件，为它造夹具比这段判断本身贵得多。所以判据抽成纯函数
//! `md_cloud::should_autosync`，这里只钉它的**真值表**。

use crate::services::md_cloud;

/// 只配 WebDAV、**没授权 SAF** 的用户必须走到自动同步。
///
/// 回滚修复这条用例就红：旧口径把 SAF 授权当成前置条件，这类用户保存后永远不同步
/// （`sync_once` 的云端分支其实排在 SAF 检查之前，根本不需要授权）。
#[test]
fn cloud_usable_syncs_even_without_saf_grant() {
    assert!(
        md_cloud::should_autosync(true, true, false),
        "云端可用时不该被 SAF 授权挡住"
    );
}

/// 其余三条：开关关着不同步；云端不可用时才看 SAF 授权。
#[test]
fn autosync_truth_table() {
    assert!(
        !md_cloud::should_autosync(false, true, true),
        "总开关关着时同步只会得到一份空报告"
    );
    assert!(
        md_cloud::should_autosync(true, false, true),
        "云端不可用 + 已授权 → 走 SAF 那三步"
    );
    assert!(
        !md_cloud::should_autosync(true, false, false),
        "云端不可用 + 未授权 → 那一轮只可能回「同步目录未授权」，没必要发"
    );
}
