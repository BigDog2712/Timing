//! 移动端原生能力命令（SAF 目录 / 悬浮条）。
//!
//! 这一层只做转发：参数交给 Kotlin 的 `@Command`，结果按 `models::native` 的形状回来。
//! 真正的系统交互（系统目录选择器、前台服务、OVERLAY 窗口）在
//! `gen/android/app/src/main/java/com/timing/app/` 下，Rust 侧不重复实现。

use tauri::State;

use crate::error::AppResult;
use crate::infra::native_bridge::NativeBridge;
use crate::models::md_backup_export::MdBackupExport;
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
///
/// `style` 与开关共用一条命令：`dot` / `bar` 切形态，留空表示只改开关。
/// 不为它单开命令是因为命令表有静态契约门禁，多一条要同步改五处，而它并不需要独立语义。
#[tauri::command]
pub async fn overlay_set(
    bridge: State<'_, NativeBridge<tauri::Wry>>,
    enabled: bool,
    style: Option<String>,
) -> AppResult<OverlayStatus> {
    bridge
        .call(
            "overlaySet",
            serde_json::json!({ "enabled": enabled, "style": style.unwrap_or_default() }),
        )
        .await
}

#[tauri::command]
pub async fn overlay_status(
    bridge: State<'_, NativeBridge<tauri::Wry>>,
) -> AppResult<OverlayStatus> {
    bridge.call("overlayStatus", serde_json::json!({})).await
}

/// 导出一份备份（[V0.11.23]）：系统「保存到…」由 Kotlin 拉起，用户自己挑位置。
///
/// 这里只做两件事：让 `services::md_backup_export::source` 把名字验好、路径算好，
/// 再把「文件路径 + 建议文件名」交给原生。**字节不过桥**——Rust 与 Kotlin 在同一个
/// 进程、同一个私有目录里，让 Kotlin 直接读那个文件比 base64 过一遍 JSON 更省事。
///
/// 桌面没有对应能力（备份就在 `data\backups\md\`，卡片上「打开」直接能看），
/// 所以 `mobile_cmd_desktop.rs` 那边是 `mobile_only` 桩。
#[tauri::command]
pub async fn md_backup_export(
    bridge: State<'_, NativeBridge<tauri::Wry>>,
    name: String,
) -> AppResult<MdBackupExport> {
    let (path, export_name) = crate::services::md_backup_export::source(&name)?;
    let ack: ExportAck = bridge
        .call(
            "exportBackup",
            serde_json::json!({
                "name": export_name,
                "path": path.to_string_lossy(),
            }),
        )
        .await?;
    Ok(MdBackupExport {
        saved: ack.saved,
        name: export_name,
    })
}

/// Kotlin 的回执。只有「写没写下去」这一个事实，文件名以 Rust 这份为准（Kotlin 拿的是副本）。
#[derive(serde::Deserialize)]
struct ExportAck {
    saved: bool,
}
