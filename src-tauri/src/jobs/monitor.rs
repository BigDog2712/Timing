//! 显示器变化监视（轮询方案）。
//!
//! ## 为什么是轮询
//!
//! 已核实 **Tauri 2.12.4 / tao 0.37.1 不提供任何「显示器增删/变化」事件**：
//! - `tauri::RunEvent`（`tauri-2.12.4/src/app.rs`）无显示器相关变体；
//! - `tauri_runtime::WindowEvent`（`tauri-runtime-2.12.2/src/window.rs`）仅有
//!   `Resized` / `Moved` / `CloseRequested` / `Destroyed` / `Focused` /
//!   `ScaleFactorChanged` / `DragDrop` / `ThemeChanged`，无 monitor 变体；
//! - `tao::Event`（`tao-0.37.1/src/event.rs`）grep `MonitorAdded`/`MonitorRemoved` 无命中；
//! - 前端事件常量集（`@tauri-apps/api/event`）亦无 monitor 事件。
//!
//! `ScaleFactorChanged` 仅在 DPI 变化时触发，拔掉一块**同 DPI** 的显示器不会触发；
//! `Moved` 只能在窗口恰好被移动时触发，均**不能可靠覆盖拔屏**。因此选择
//! 「固定间隔轮询 `available_monitors()` 并比对签名」——对拔/插屏、分辨率与排列变化
//! 都能可靠生效，是本版本唯一可保证覆盖 AC-23 的机制。

use std::time::Duration;

use tauri::AppHandle;

use crate::infra::window;

/// 轮询间隔（秒）：显示器拔插为低频操作，秒级延迟可接受，开销仅一次枚举系统调用。
const MONITOR_POLL_SECS: u64 = 3;

/// 显示器集合签名：稳定排序后的 (名称, x, y, 宽, 高, 缩放) 元组。
type Signature = Vec<(Option<String>, i32, i32, u32, u32, u64)>;

/// 采集当前显示器签名；枚举失败返回 `None`（视为「未知」，不触发钳制）。
fn signature(app: &AppHandle) -> Option<Signature> {
    let monitors = app.available_monitors().ok()?;
    let mut sig: Signature = monitors
        .iter()
        .map(|m| {
            let p = m.position();
            let s = m.size();
            (
                m.name().cloned(),
                p.x,
                p.y,
                s.width,
                s.height,
                m.scale_factor().to_bits(),
            )
        })
        .collect();
    // 枚举顺序不保证稳定，排序后再比对。
    sig.sort();
    Some(sig)
}

/// 启动显示器变化监视后台任务：签名变化即把越界窗口钳回可见区（AC-23）。
pub fn spawn_watch(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(MONITOR_POLL_SECS));
        ticker.tick().await; // 消耗首次立即触发
        let mut last = signature(&app);
        loop {
            ticker.tick().await;
            let now = signature(&app);
            if now != last {
                last = now;
                if let Err(err) = window::reclamp_main(&app) {
                    crate::log_warn!("reclamp after monitor change failed: {err}");
                }
            }
        }
    });
}
