//! 后端测试入口（QA 新增，仅 `cargo test` 编入）。
//!
//! 断言来源：`docs/Spec-v1.md` §6 / §9 与 `docs/phase2/IPC-CONTRACT-v2.md`，
//! 以行为（输入→可观测输出/错误码）为准，不绑定实现内部细节。

/* `pub(crate)`：`src/` 里的模块级单测也要借这份夹具（`purge/folder.rs` 的
   日期名边界用例要真 pool，`infra/md_webdav/remove.rs` 要假服务器）。 */
pub(crate) mod support;

/* MD 同步域的 52 份（2026-11-09 从本层平铺拆进 `md/`，原来光 `md_*` 就占 50 个，
   连同两个假 WebDAV 服务器一起搬）。文件名已去掉 `md_` 前缀——目录说了是 MD 域。 */
mod md;

/* **老路径兼容层，别删**：`qa_*.rs` 与 `src/` 里的模块级单测仍按迁走前的名字引
   （`crate::tests::md_sync::env` / `md_cloud_purge::seed_past` / `fake_webdav::Fake` 等，
   全仓 10 处，其中 1 处在生产代码 `infra/md_webdav/remove.rs`——它借假服务器验删除）。
   这四条重导出就是 `md/mod.rs` 头注释里说的「由 `tests/mod.rs` 的 `pub(crate) use`
   重导出保平」——删掉它们，那 10 处全红。 */
pub(crate) use md::{cloud_purge as md_cloud_purge, fake_webdav, fake_webdav_dir, sync as md_sync};

mod appdata_migrate;
mod appdata_migrate_edges;
mod boot_timing;
mod countdown;
mod daily_status;
/* [V0.11.15] 数据根指针与搬迁（指针优先于 optout；`VACUUM INTO` 的参数绑定）。 */
mod data_root_pointer;
mod data_root_transfer;
mod item;
mod item_batch2;
/* [QA 独立验收 V0.11.19] T04 变更 A：LocalFolder 半场（I9a/I9b/I9c + 闸③父子 + 闸⑤a +
   分通道暂停）与 WebDAV 半场（水位停在失败项之前 + 403/429 同 401 整批停）。
   两份都在验收方手里重写，不复用工程师的机验结论。 */
mod qa_t04_acceptance;
mod qa_t04_audit_log;
mod qa_t04_webdav_failures;
/* [QA 独立验收 V0.11.19] T01 边界补例：CRLF/BOM、围栏标记尾随空格、闭合标记带
   语言标注、标题缩进、~~~ 交叉、三句逐字文案（变异自检的两处靶子在这里）。 */
mod qa_t01_fence_edges;
/* [QA 独立验收 V0.11.19] T01 真实一轮同步：洞 1 / 洞 2 / P1 三处，全部走
   `services::md_sync::run`，查文件字节与 SQL 软删，不靠纯函数自证。 */
mod qa_t01_sync_attack;
/* [QA 独立复验 V0.11.19 批 1] 自己补的 2 条最缺边界：三档等号边界帧
   （covered 同毫秒 / Max 1799-1800 / 连败节流 / 不从 pollSecs 反推）与
   BOM+CRLF 真实文件走 FileWatch::probe。本轮两条变异自检的靶子都在这里。 */
#[cfg(desktop)]
mod qa_batch1_edges;
mod migration;
mod migration_v2;
mod moyu_settings;
mod note;
mod note_pin;
/* [V0.11.27] 悬浮条显示源改成「状态机快照」后的三条易错口径（暂停/待机/原样透传）。 */
mod overlay_snapshot;
/* [0.12.1 归一] 悬浮条外观 / 手柄绑定的单一真源：半份 patch 的合并口径 + KV 往返。 */
mod pill_prefs;
mod plugin_v3_matrix;
mod plugin_v3_wording;
/* [QA V0.11.18] 「老用户云端配置一个字节都不许丢」的后端半场（PRD A3 / A4 / C2）：
   用主人活库的**原串**当夹具，`load → save` 后逐字节比。 */
mod qa_live_config_roundtrip;
/* [QA V0.11.18] 「第 1 关对 403 放行」的反向攻击（上一轮没验完的那条）：
   目录 GET 403 **且** 写探针 403 时必须仍然报红，不许把误报换成漏报。 */
mod qa_probe_403;
/* [QA 复验 V0.11.18] A6 的「填全」判据：前端 `isCloudReady` 与后端 `usable()` 共用一张
   十档表，任何一边改口径都会红在那一侧。 */
mod qa_usable_parity;
/* [QA 复验 V0.11.18] B7b：`build_nodes(quitting=true)` 只改退出项（逐字 `正在同步…`）。 */
mod qa_tray_quitting;
/* [V0.12.0 Patina 融合] 托盘「时间统计…」入口：位置、文案口径、四种状态 × 退出中都不消失。 */
mod qa_tray_stats_entry;
/* [QA 复验 V0.11.18] B4：`blocked_notice` 的十档表 + 「标题取自菜单项常量」。
   与工程师那份的区别：用常量不用字面量、补 `localfolder` 载体、把优先级顺序也钉住。 */
mod qa_blocked_notice;
mod qa_blocked_notice_label;
mod portable_dir;
mod portable_dir_qa;
mod portable_dir_qa_md;
mod portable_dir_qa_plugins;
mod portable_dir_qa_source;
mod portable_dir_scan;
mod record;
/* [P1-01 补记] `services::record::backfill` 的 8 条可变异判据 + 命令层接线（`record.rs` 已 271 行，
   再塞 10 条用例必破 300 行硬上限，故单独成文件）。 */
mod record_backfill;
mod reminder;
#[cfg(target_os = "windows")]
mod secret_dpapi;
mod settings_reference;
mod theme;
mod timer;
mod timer_clock;
mod timer_formula;
mod timer_recover_gap;
/* [V0.11.24 批 2] 异常退出恢复改造：H2 / H3 跨零点 / H5 多 active + 托盘退出 ② 收尾。 */
mod timer_recover_batch2;
mod timer_switch;
mod timer_threshold;
mod timer_todo_link;
mod todo;
mod todo_list;
mod todo_nudge;
mod todo_purge;
mod todo_start;
mod tray_batch2;
mod tray_menu;
mod tray_menu_md_sync;
/* [V0.11.18] 托盘同步项的文案（读「生效通道」而非配置）+ 退出前那一轮。
   桌面独占：`app::tray_sync` 本身就是 `#[cfg(desktop)]`。 */
#[cfg(desktop)]
mod tray_sync_quit;
mod window_geometry;
/* [0.12.1 T04b] 「设置只有一个家」的源码哨兵：`open_settings_window` 是别名、不再建窗。 */
mod main_window_profile;
mod window_settings_alias;
mod window_spec;
