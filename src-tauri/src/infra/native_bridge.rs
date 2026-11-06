//! 移动端原生桥：Rust → Kotlin。
//!
//! Android 的 SAF（选目录、读写 `content://`）与悬浮窗（前台服务 + OVERLAY 窗口）只能由
//! 原生侧实现。Rust 通过 Tauri 的自定义插件把调用送过去，拿回 JSON。
//!
//! 注册在 `lib.rs`：`register_android_plugin("com.timing.app", "TimingNativePlugin")`；
//! Kotlin 侧同名类继承 `app.tauri.plugin.Plugin`、用 `@Command` 暴露方法。
//! 桌面构建不编译本模块——没有原生侧可调。

use serde::de::DeserializeOwned;
use serde::Serialize;
use tauri::plugin::PluginHandle;
use tauri::Runtime;

use crate::error::{AppError, AppResult, ErrorCode};

/// 桥的持有者。插件 `setup` 里 `app.manage` 存进状态，命令层按需取用。
pub struct NativeBridge<R: Runtime> {
    handle: PluginHandle<R>,
}

impl<R: Runtime> NativeBridge<R> {
    pub fn new(handle: PluginHandle<R>) -> Self {
        Self { handle }
    }

    /// 调一条 Kotlin `@Command`。
    ///
    /// 失败一律折成 `IO_ERROR`：桥断了是环境问题（权限被撤、服务没起来），不是业务错误；
    /// 前端只需要一句人话，原始原因留在消息里供日志排查。
    pub async fn call<T: DeserializeOwned>(
        &self,
        command: &str,
        payload: impl Serialize,
    ) -> AppResult<T> {
        self.handle
            .run_mobile_plugin_async::<T>(command, payload)
            .await
            .map_err(|err| {
                AppError::new(ErrorCode::IoError, format!("原生桥 {command} 失败：{err}"))
            })
    }
}
