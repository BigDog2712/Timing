//! 系统通知封装（`tauri-plugin-notification` 2.7.0）。
//!
//! 发送成功返回 `true`；失败返回 `false`（调用方据此回滚 `reminded_at`，K-16 兜底）。
//! 通知为「一次性提示」，不实现点击动作（§1.2 out-of-scope）。

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// 发送一条系统通知。返回是否发送成功。
pub fn notify(app: &AppHandle, title: &str, body: &str) -> bool {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .is_ok()
}
