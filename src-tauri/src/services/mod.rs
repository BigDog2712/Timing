//! 业务层：计时状态机、事项规则、记录编排、设置读写。所有业务逻辑归属此处。
pub mod countdown;
/* [V0.11.15] 数据根（`%APP_DIR%`）的落点信息与切换。桌面独占：`appdata_dir` 与原生
选目录对话框都只在桌面存在，手机端走 `commands/data_root_cmd_mobile.rs` 的桩。 */
#[cfg(desktop)]
pub mod data_root;
pub mod daily_status;
pub mod item;
pub mod md_backup;
/* [V0.11.23] 备份导出：名字校验 / 路径闸 / 导出名。放 services 才够得着桌面用例。 */
pub mod md_backup_export;
pub mod md_cloud;
pub mod md_sync;
pub mod note;
pub mod plugin;
pub mod plugin_merge;
pub mod record;
pub mod reminder;
pub mod settings;
pub mod theme;
pub mod timer;
pub mod timer_flush;
pub mod timer_split;
pub mod timer_stop;
pub mod timer_time;
pub mod todo;
pub mod todo_nudge;
pub mod todo_start;
