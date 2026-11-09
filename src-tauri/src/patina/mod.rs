//! Patina —— 本地优先的时间追踪与使用分析子系统。
//!
//! 本目录整体来自 Patina 1.10.0（MIT），作为 **vendored 子树**挂进 Timing：
//! 内部路径已从 `crate::xxx` 重写为 `crate::patina::xxx`，与宿主 Timing 的
//! `crate::app` / `crate::commands` / `crate::platform` 完全隔开。
//!
//! 接入点只有三处（改这里之外的东西前，先想清楚要不要改 vendored 代码）：
//! 1. `bootstrap::configure` —— 把它的状态 / 插件挂到宿主的 `Builder` 上；
//! 2. `bootstrap::setup` —— 由宿主的 `setup` 钩子调用（Tauri 只允许一个 setup）；
//! 3. `commands` —— 命令列表由宿主 `lib.rs` 的 `generate_handler!` 统一注册。
//!
//! 数据层与 Timing **各用各的库文件**：Patina 走 sqlx，Timing 走 rusqlite，
//! 两个连接池互不相干。合并的是应用外壳，不是数据模型。

/* vendored 子树的死码口径：
上游是独立应用，`single-instance` / 托盘菜单 / mini 窗口这些入口在融合后被宿主接管
（或按产品决定不启用），它们的实现留在原地以便将来接回，但当前没有调用方。
上游自己的 CI 靠「入口都接线」来保证零死码；我们这里做不到，也不该为了消警告去删
上游代码——删了以后就无法与上游对比、也没法吸收它的补丁。
**这条 allow 只覆盖 `src/patina/`**：宿主代码的死码仍由 clippy 严判。 */
#![allow(dead_code)]

pub mod app;
pub mod commands;
pub mod data;
pub mod domain;
pub mod engine;
pub mod platform;

/// 覆盖率检查点（仅专用 coverage 编译器 wrapper 打开）。
///
/// 上游写在 `lib.rs` 的 crate root；本 crate 的 root 是 Timing 的 `lib.rs`，
/// 所以挪到这里，`#[cfg(feature = "patina_coverage")]` 的门槛不变。
#[cfg(feature = "patina_coverage")]
pub(crate) fn flush_coverage() {
    unsafe extern "C" {
        fn __llvm_profile_write_file() -> i32;
    }
    if unsafe { __llvm_profile_write_file() } != 0 {
        eprintln!("native coverage checkpoint failed");
    }
}
