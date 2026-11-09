//! 装配层（app）：把 services 与平台适配接起来。
//!
//! 这一层解决的问题是「谁都想要、但谁都不该拥有」的那类胶水：
//! - `events`：读业务状态再广播（services 不该知道 Tauri 事件，infra 又不许依赖 services）；
//! - `tray`：原生菜单装配 + 菜单项 -> 计时动作的派发；
//! - `bootstrap`：启动顺序；
//! - `diagnostics`：启动现场快照。
//!
//! 允许依赖：`services` / `infra` / `platform` / `models`。
//! 禁止：被 `infra` 反向依赖（否则又成环）。

pub mod bootstrap;
pub mod events;
/* [V0.11.27] 计时快照 → 安卓悬浮条：与 `events` 分文件，因为桌面那边是空实现而
`events` 本身要常年保持桌面可编（推送只在手机端有消费者）。 */
pub mod overlay_push;
/* [V0.12.0] 手机端一轮同步（镜像 → 合并 → 写回）：命令层与调度层共用这一份编排。 */
#[cfg(mobile)]
pub mod md_sync_mobile;

/* 桌面独占（V1-Android）：
- `tray`：`TrayIconBuilder` / 原生菜单在 Android 上不存在；
- `diagnostics`：快照里要枚举显示器与各窗口 label，两者都是桌面概念；
- `preboot`：迁移在桌面才有（移动端换包名 = 新应用，系统层面没有「旧目录」），
  且它要用 `rfd` 阻塞式原生对话框 —— 必须在事件循环启动前跑，移动端无此阶段；
- `autostart_takeover`：清理 `HKCU\\...\\Run` 注册表，Android 无开机自启概念。
移动端不写这两份快照——出问题时看日志与 `boot_timing` 即可。 */
#[cfg(desktop)]
pub mod autostart_takeover;
/* [V0.11.15] 自定义数据根的启动期接线（拆出 `portable_boot` 是为了那边的 300 行门禁）。 */
#[cfg(desktop)]
pub mod data_root_boot;
#[cfg(desktop)]
pub mod diagnostics;
#[cfg(desktop)]
pub mod portable_boot;
#[cfg(desktop)]
pub mod portable_prompt;
#[cfg(desktop)]
pub mod preboot;
/* Patina 子系统的宿主侧接线（数据落点 + 首启导入）。桌面独占：Patina 自身依赖
WebView2 / Win32，Android 上根本编不进来。 */
#[cfg(desktop)]
pub mod patina_bridge;
#[cfg(desktop)]
pub mod tray;
/* [V0.11.18] 托盘「退出」之前那一轮同步（PRD §13.3）。与 `tray_sync` 拆开：那边是
「点同步之后做什么」，这里是「点退出之前做什么」，两者改动的理由不同。 */
#[cfg(desktop)]
pub mod tray_quit;
/* [V0.11.7] 托盘「Markdown 同步」点完之后做的事（拆出 `tray` 以满足单文件 ≤300 行）。 */
#[cfg(desktop)]
pub mod tray_sync;
/* [V0.11.26] 托盘同步项的三态标签 + blocked 拦截判据（从 `tray_sync` 迁出）。 */
#[cfg(desktop)]
pub mod tray_label;
