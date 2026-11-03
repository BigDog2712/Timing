//! 系统通知封装（`tauri-plugin-notification` 2.7.0）。
//!
//! 发送成功返回 `true`；失败返回 `false`（调用方据此回滚 `reminded_at`，K-16 兜底）。
//! 通知为「一次性提示」，不实现点击动作（§1.2 out-of-scope）。
//!
//! Android 差异（V1-Android）：API 26+ 的通知必须落在**已存在的通道**上，否则系统直接
//! 丢掉。所以移动端启动时建一条固定通道（`timer-reminder`「计时提醒」），发送时显式
//! 指定它 —— 单一通道也符合产品口径（倒计时 / 待办提醒是同一种打断强度）。
//! 桌面没有通道概念，`channel_id` 不会出现（`cfg` 掉，不影响 WinRT Toast 行为）。

use tauri::AppHandle;
#[cfg(target_os = "android")]
use tauri_plugin_notification::Channel;
use tauri_plugin_notification::NotificationExt;

/// 移动端通知通道 id（与 `capabilities/mobile.json` 的放行范围无关，纯粹是系统侧键）。
#[cfg(target_os = "android")]
pub const CHANNEL_ID: &str = "timer-reminder";

/// 建通道（幂等：同名通道重复创建由系统忽略，可每次启动都调）。
///
/// 只在 Android 有实现：桌面 / iOS 没有通道模型，调用点用 `cfg` 门控。
#[cfg(target_os = "android")]
pub fn ensure_channel(app: &AppHandle) {
    let channel = Channel::builder(CHANNEL_ID, "计时提醒")
        .description("倒计时到点与待办提醒")
        .build();
    // 失败不致命：发送时仍会退到插件的默认通道，只是重要性可能不同。
    if let Err(err) = app.notification().create_channel(channel) {
        crate::log_warn!("create notification channel failed: {err}");
    }
}

/// 发送一条系统通知。返回是否发送成功。
pub fn notify(app: &AppHandle, title: &str, body: &str) -> bool {
    let builder = app.notification().builder().title(title).body(body);
    // Android 必须显式指向已建好的通道，否则落到插件默认通道（重要性不同）。
    #[cfg(target_os = "android")]
    let builder = builder.channel_id(CHANNEL_ID);
    builder.show().is_ok()
}
