//! 平台身份 + 「桌面独占能力」的统一错误口径（V1-Android）。
//!
//! 为什么单开一个叶子模块：移动端的 12 条桩命令都要返回同一种错误，如果各自
//! `AppError::new(ErrorCode::IoError, "…")`，文案与错误码会慢慢漂开。收在一处后，
//! 契约面只剩「`IO_ERROR`」一种，不新增第 17 个错误码（§3.2 闭集）。

use crate::error::{AppError, ErrorCode};

/// 当前平台标识（`windows` / `macos` / `linux` / `android` / `ios`）。
///
/// 只用于启动日志与诊断，**不参与业务分支**：能力差异一律用编译期 `cfg(desktop)` /
/// `cfg(mobile)` 决定，运行期判断会漏掉「编译进去了但没实现」的路径。
pub const OS: &str = std::env::consts::OS;

/// 桌面独占能力在移动端的统一错误（`IO_ERROR` + 一句中文说明）。
///
/// 只在 `mobile` 下编译：桌面侧这些能力都真实实现，多一个 `desktop_only` 等于
/// 留一条「本该能用却回错误」的死路径。
#[cfg(mobile)]
pub fn desktop_only(command: &str) -> AppError {
    AppError::new(
        ErrorCode::IoError,
        format!("{command} 仅桌面端可用，移动端不支持"),
    )
}

/// 移动端独占能力在桌面的统一错误（与 [`desktop_only`] 对称）。
///
/// 只在 `desktop` 下编译：这些能力（SAF 目录、悬浮条）在手机上真实实现，
/// 桌面留一句「不支持」比伪装成空结果诚实。
#[cfg(desktop)]
pub fn mobile_only(command: &str) -> AppError {
    AppError::new(
        ErrorCode::IoError,
        format!("{command} 仅手机端可用，桌面端不支持"),
    )
}
