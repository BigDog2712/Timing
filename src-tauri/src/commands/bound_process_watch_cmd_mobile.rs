//! 「绑定应用进程退出 → 结束自动接管段」—— **移动端桩**（V1-Android）。
//!
//! ## 为什么是 `Ok(())` 而不是 `IO_ERROR`
//!
//! 与 `window_cmd_mobile.rs::get_foreground_window` 回 `Ok(None)` 同一条口径：
//! 安卓端**根本没有**「前台应用」这个概念（`services::insight` 整棵是 `#[cfg(desktop)]`，
//! 真正的追踪引擎一行都不编进来），所以「没有可监视的进程」本来就是**正确的成功**，
//! 不是错误。回错误只会在控制台刷一条被前端吞掉的噪声。
//!
//! 更要紧的是：`useAppBindingAutoTimer` 挂在 `if (IS_MOBILE) return <MobileShell />`
//! 之后，移动端**永远不会**调用这条命令。这里回什么都没人看，所以选语义最诚实的那个。
//!
//! ## 用户看到什么
//!
//! **什么都没变**。安卓端从来就没有「切到绑定应用就自动接管计时」，因此也不存在
//! 「应用退出后该自动结束」的期待落空。这不是本次的功能降级，是既有能力面本身如此。
//!
//! 函数名与参数签名必须与 `bound_process_watch_cmd.rs` 完全一致 —— 命令名是契约面。

use tauri::AppHandle;

use crate::error::AppResult;
use crate::models::bound_process_watch::BoundProcessWatchInput;

#[tauri::command]
pub async fn set_bound_process_watch(
    _app: AppHandle,
    watch: Option<BoundProcessWatchInput>,
) -> AppResult<()> {
    if watch.is_some() {
        crate::log_info!(
            "bound process watch ignored on mobile: there is no foreground-app tracking here"
        );
    }
    Ok(())
}
