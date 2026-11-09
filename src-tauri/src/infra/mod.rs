//! 平台适配层（infra）：只碰 OS / Tauri 能力，**不依赖 services**。
//!
//! 分层目标（R5）：`infra` 是「可整体替换的平台叶子」——想把 SQLite 换掉、把托盘换成
//! 自绘，改动应止步于本层。因此这里不允许出现业务判断与用例编排。
//!
//! 已迁出的模块（v0.3 解环）：
//! - `clock` → `platform::clock`（被 services 使用，不需要 Tauri 能力）
//! - `events` / `tray` / `setup` → `app::*`（要读业务状态，属装配层）
//! - `runtime` / `monitor` / `reminder` / `countdown` / `note_windows::restore_open`
//!   → `jobs::*`（定时触发业务动作，属调度层）

pub mod appdata_migrate;
pub mod db;
/* [V0.11.15] 数据根可配：指针文件（`data-root.json`）与剩余空间预检。 */
pub mod disk_space;
pub mod md_backup;
/* 备份目录的读侧（列表 / 读取 / 名字解析）：从 `md_backup` 拆出来的，只为行数。 */
pub mod md_backup_store;
/* [V0.11.33] 日记模板的首次写出：文件不存在且确要写时以模板打底（桌面 only）。 */
pub mod md_diary;
pub mod md_env;
/* [V0.11.19] 代码围栏状态机：全 crate 只有这一份「这一行在不在围栏里」的判定。 */
pub mod md_fence;
pub mod md_file;
/* [V0.11.19] 区块判定（哪些行算标题 / 到哪儿结束 / 三档诊断）：纯函数，无 IO。 */
pub mod md_section;
/* [V0.11.13] WebDAV 传输：只有 GET / PUT / probe，不认 MdSyncCloud，不碰 services（L4）。 */
pub mod md_webdav;
pub mod migrate;
/* [V0.11.19 变更 A] 往期清理的追责面：`md-cloud-purge.log` 追加 + 行数截断。 */
pub mod purge_log;
/* 移动端独占：Android 的 SAF 与悬浮窗只在原生侧有实现，桥也只在移动端编译。 */
#[cfg(mobile)]
pub mod native_bridge;
pub mod notify;
pub mod plugin_fs;
pub mod portable_migrate;
pub mod portable_probe;
pub mod root_pointer;
/* [V0.11.13] WebDAV 应用密码的加密存储（DPAPI / Android Keystore）。
两个实现各占一个文件，`secret` 只做枚举分派；桌面与移动的 cfg 口径与 native_bridge 一致。 */
pub mod secret;
#[cfg(mobile)]
pub mod secret_bridge;
#[cfg(target_os = "windows")]
pub mod secret_dpapi;
pub mod shell_open;

/* 桌面独占（V1-Android）：下面这些模块直接调 tauri 桌面专有 API ——
`WebviewWindowBuilder` 的 `transparent/skip_taskbar/always_on_top/decorations`、
`available_monitors()` / `primary_monitor()`、托盘菜单、注册表自启。
Android 上这些 API 要么不存在，要么无实现，**模块级**门控比逐行撒 `#[cfg]` 更省事，
也让移动端读代码时不会误以为「这里有实现、只是没调用」。 */
#[cfg(desktop)]
pub mod autostart;
#[cfg(desktop)]
pub mod geometry;
#[cfg(desktop)]
pub mod tray_menu;
#[cfg(desktop)]
pub mod window;
#[cfg(desktop)]
pub mod window_note;
#[cfg(desktop)]
pub mod window_rect;
#[cfg(desktop)]
pub mod window_spec;

/* 分析窗的平台适配（原 patina/platform：路径 / 凭据 / WebDAV / 存储控制 / Win32）。 */
#[cfg(desktop)]
#[allow(dead_code)]
pub mod insight;
