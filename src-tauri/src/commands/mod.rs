//! 命令层：仅反序列化 -> 调 service -> 序列化，无业务、无 SQL。
//!
//! 命令名就是契约面（`lib.rs` 的 74 条注册 + `check:contract` 静态比对），所以
//! **不能**用 `#[cfg]` 把命令整条剔除。三组「桌面有实现、移动端只能给桩」的命令
//! 改用 `#[path]` 换文件：模块名与函数名一字不变，`lib.rs` 因此零改动。
//! 桩只回 `IO_ERROR`（见 `platform::host::desktop_only`），不新增错误码。

pub mod countdown_cmd;
pub mod daily_status_cmd;
pub mod item_cmd;
pub mod migration_cmd;
pub mod note_cmd;
pub mod plugin_cmd;
pub mod record_cmd;
pub mod reminder_cmd;
pub mod settings_cmd;
pub mod theme_cmd;
pub mod timer_cmd;
pub mod todo_cmd;

/* [V0.11.15] 数据根三条命令（桌面真实实现 / 手机桩）。与 `md_sync_cmd` 同形的
`#[cfg] + #[path]` 手法：模块名与函数名一字不变，`lib.rs` 因此不用挂 `#[cfg]`。 */
#[cfg(desktop)]
pub mod data_root_cmd;
#[cfg(mobile)]
#[path = "data_root_cmd_mobile.rs"]
pub mod data_root_cmd;

#[cfg(desktop)]
pub mod md_sync_cmd;
#[cfg(mobile)]
#[path = "md_sync_cmd_mobile.rs"]
pub mod md_sync_cmd;

/* [V0.11.13] WebDAV 密码的三分语义（`None` 不动 / 空串清空 / 明文写入）。
两平台的 `md_sync_save` / `md_sync_test` 共用这一份：凭据口径分叉过一次就再也对不齐。 */
pub mod md_credential;

/* [V0.12.0] 手机端原生能力（SAF 目录 / 悬浮条）。桌面没有对应语义，
用桩回 `IO_ERROR`，命令名与注册点两平台一致。 */
#[cfg(desktop)]
#[path = "mobile_cmd_desktop.rs"]
pub mod mobile_cmd;
#[cfg(mobile)]
pub mod mobile_cmd;

#[cfg(desktop)]
pub mod system_cmd;
pub mod usage_cmd;
#[cfg(mobile)]
#[path = "system_cmd_mobile.rs"]
pub mod system_cmd;

#[cfg(desktop)]
pub mod window_cmd;
#[cfg(mobile)]
#[path = "window_cmd_mobile.rs"]
pub mod window_cmd;

/* 分析窗的命令面（117 条，桌面独占；与宿主 80 条共用 `ipc_commands.rs` 的一张表）。 */
#[cfg(desktop)]
#[allow(dead_code)]
pub mod insight;
