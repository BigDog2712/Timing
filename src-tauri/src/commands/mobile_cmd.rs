//! 移动端原生能力命令（SAF 目录 / 悬浮条）。
//!
//! 这一层只做转发：参数交给 Kotlin 的 `@Command`，结果按 `models::native` 的形状回来。
//! 真正的系统交互（系统目录选择器、前台服务、OVERLAY 窗口）在
//! `gen/android/app/src/main/java/com/timing/app/` 下，Rust 侧不重复实现。

use tauri::State;

use crate::error::AppResult;
use crate::infra::native_bridge::NativeBridge;
use crate::models::native::{OverlayStatus, SafStatus};

/// 弹系统目录选择器。用户取消时 `granted = false`，不是错误——
/// 取消是正常操作，报错会让设置页弹出无意义的红字。
#[tauri::command]
pub async fn md_saf_pick(
    bridge: State<'_, NativeBridge<tauri::Wry>>,
) -> AppResult<SafStatus> {
    bridge.call("safPickFolder", serde_json::json!({})).await
}

/// 当前授权是否仍然有效。用户可能去系统设置里撤销，也可能把目录删了。
#[tauri::command]
pub async fn md_saf_status(
    bridge: State<'_, NativeBridge<tauri::Wry>>,
) -> AppResult<SafStatus> {
    bridge.call("safStatus", serde_json::json!({})).await
}

/// 开关悬浮条。开启时若缺「显示在其他应用上层」权限，Kotlin 侧会拉起系统授权页。
#[tauri::command]
pub async fn overlay_set(
    bridge: State<'_, NativeBridge<tauri::Wry>>,
    enabled: bool,
) -> AppResult<OverlayStatus> {
    bridge
        .call("overlaySet", serde_json::json!({ "enabled": enabled }))
        .await
}

#[tauri::command]
pub async fn overlay_status(
    bridge: State<'_, NativeBridge<tauri::Wry>>,
) -> AppResult<OverlayStatus> {
    bridge.call("overlayStatus", serde_json::json!({})).await
}
