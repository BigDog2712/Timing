//! 业务层：计时状态机、事项规则、记录编排、设置读写。所有业务逻辑归属此处。
pub mod countdown;
/* [0.13] 「绑定应用的进程退出 → 结束这一段自动接管开出来的计时」。
   桌面独占：安卓端没有任何前台应用 / 进程枚举能力（`services::insight` 整棵
   `#[cfg(desktop)]`），这条链路在手机上本来就不存在。 */
#[cfg(desktop)]
pub mod bound_process_watch;
/* 判据矩阵 + 替换不泄漏（纯判据，不碰真进程）；真进程端到端（真 spawn / 真句柄 /
   真停表）在下面那个文件。两个都不是产品代码，与 `item_app_mirror_tests` 同形。 */
#[cfg(all(test, desktop))]
#[path = "bound_process_watch_tests.rs"]
mod bound_process_watch_tests;
#[cfg(all(test, desktop))]
#[path = "bound_process_watch_win_tests.rs"]
mod bound_process_watch_win_tests;
/* [0.13.x] 本机身份（install_id）的落盘读写 + 进程级缓存 + 本地日键。
   跨平台：计时事件流（`repositories::timer_ops`）在两端都要写 `device_id`，
   而原先的实现藏在 `insight`（`#[cfg(desktop)]`）里，手机端够不着。
   `activity::schema_core::device` 留了转发壳，老调用点不变。 */
pub mod identity;
/* [0.12.2] 设备维度的**启动接线**（认领哨兵行 / 标记本机）。桌面独占 —— 它依赖
   `services::activity::schema_core`，而 `activity` 整体是 `#[cfg(desktop)]`。 */
#[cfg(desktop)]
pub mod device;
/* 设备维度的启动判据（认领哨兵行 / 发 uid / 四张 uid 表全覆盖）。拆出来是因为
   `device.rs` 正文贴着单文件 300 行门禁，与 `timer_ops_tests` 同一套挂法。 */
#[cfg(all(test, desktop))]
mod device_tests;
/* [V0.11.15] 数据根（`%APP_DIR%`）的落点信息与切换。桌面独占：`appdata_dir` 与原生
选目录对话框都只在桌面存在，手机端走 `commands/data_root_cmd_mobile.rs` 的桩。 */
#[cfg(desktop)]
pub mod data_root;
pub mod daily_status;
pub mod item;
/* [0.13.x] 事项 ↔ 应用绑定（校验后委托仓储）。 */
pub mod item_app;
/* [0.13 fix] 存量绑定的**启动补镜像**（分析窗配置表 → `item_app`）：药丸的自动接管只读
   后面这张表，而本轮之前没有任何代码往它写过行，老用户的绑定因此完全不生效。
   桌面独占 —— `app_key` 的归一实现与分析窗配置表都只在桌面存在。 */
#[cfg(desktop)]
pub mod item_app_mirror;
#[cfg(all(test, desktop))]
mod item_app_mirror_tests;
/* [R1] 「解绑」的端到端边界（两处真源都清干净才不复活）：从上面那个文件分出来，
   因为它正好 300 行（`check:size` 硬限，棘轮只许减不许增）。 */
#[cfg(all(test, desktop))]
mod item_app_mirror_unbind_tests;
/* 「不计入」口径（`track: false` 不许被单事项键翻回 1）：同样因为上一个文件正好 300 行。 */
#[cfg(all(test, desktop))]
mod item_app_mirror_track_tests;
/* [0.13.x] 事项树（2 层硬限）与绑定的判据：断言落库后的 `parent_id`/`depth`，
   而不是只断言调用返回 Ok（两者不同步时全链路零报错）。 */
#[cfg(test)]
mod item_tests;
/* [0.14] `delete_item` 级联软删的判据（从 item_tests.rs 分出：那边 272 行，加级联四条会顶穿 300）。 */
#[cfg(test)]
mod item_cascade_delete_tests;
pub mod md_backup;
/* [V0.11.23] 备份导出：名字校验 / 路径闸 / 导出名。放 services 才够得着桌面用例。 */
pub mod md_backup_export;
pub mod md_cloud;
pub mod md_sync;
/* [0.14.x] 同步事件流：计时事件的跨端增量传输（分段 JSONL + 下载游标）。
   T01 只落 schema / 类型 / 游标 SQL，编排（push/pull/fold）在 T02 —— 故先
   `allow(dead_code)` 遮住「类型与 SQL 原语尚无调用方」的告警，与 `activity`
   模块同款口径；T02 接线后按需摘掉。 */
#[allow(dead_code)]
pub mod sync_stream;
pub mod note;
/* [R1] 手柄「启动应用」的授权名单：执行前必须命中，写入只有原生对话框一条路。
   桌面独占 —— 手机没有「启动一个外部程序」这件事，命令本身也不注册（见 `ipc_commands`）。 */
#[cfg(desktop)]
pub mod handle_launch;
/* [V0.11.27] 悬浮条快照组装（状态机 + 事项名 → 推送载荷）。仅手机端有消费者。 */
pub mod overlay_push;
pub mod plugin;
pub mod plugin_merge;
/* [0.12.1 归一] 悬浮条外观 / 手柄绑定的 KV 读写（`services/settings.rs` 只剩 2 行门禁余量）。 */
pub mod pill_prefs;
pub mod record;
pub mod reminder;
pub mod settings;
pub mod theme;
pub mod timer;
/* [0.13.x] 计时操作日志：事件真源与折叠（`fold_session`）。跨端同步只传这里的事件，
   状态由两端各自折叠得出 —— 详见 `docs/design/PLAN-20261114-事项为中心的计时模型.md` §7。 */
pub mod timer_ops;
/* [0.13.x] 事件接线：`timer` 的 start/pause/resume/stop/discard 落成 `timer_ops` 事件。
   单独一层是因为它同时依赖 `repositories::timer_ops`（写库）与 `timer_time`（口径），
   塞进 `timer.rs` 会把它顶过 300 行硬限。 */
pub mod timer_events;
pub mod timer_flush;
pub mod timer_recover;
pub mod timer_split;
pub mod timer_stop;
pub mod timer_time;
pub mod todo;
pub mod todo_nudge;

/* 应用使用统计（0.13.0，安卓；0.12.5 加使用时段；0.12.8 改成整天重算）：只碰
   app_usage / app_usage_span 两张表。判据两组：`usage_tests.rs` 管纯函数，
   `usage_rollup_tests.rs` 管落库与读库（各自都在 `check:size` 的 300 行以内）。 */
pub mod usage;
#[cfg(test)]
mod usage_rollup_tests;
#[cfg(test)]
mod usage_tests;
pub mod todo_start;

/* 分析窗的服务层（原 patina/data + patina/engine：自带 sqlx 池的完整持久化栈 + 调度器）。
   二者互相引用（16 / 32 次），必须同层；详见 docs/refactor/patina-structural-merge.md §1.2。 */
#[cfg(desktop)]
#[allow(dead_code)]
pub mod activity;
