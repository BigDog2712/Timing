//! 后端测试入口（QA 新增，仅 `cargo test` 编入）。
//!
//! 断言来源：`docs/Spec-v1.md` §6 / §9 与 `docs/phase2/IPC-CONTRACT-v2.md`，
//! 以行为（输入→可观测输出/错误码）为准，不绑定实现内部细节。

mod support;

mod appdata_migrate;
mod appdata_migrate_edges;
mod boot_timing;
mod countdown;
mod daily_status;
/* [V0.11.15] 数据根指针与搬迁（指针优先于 optout；`VACUUM INTO` 的参数绑定）。 */
mod data_root_pointer;
mod data_root_transfer;
/* 假 WebDAV 服务器（V0.11.15 从 `md_webdav.rs` 搬出）：`Fake` / `serve` / `serve_412_on_put`。 */
mod fake_webdav;
/* 路由式假服务器（V0.11.15）：409 补建的判据要「目录存不存在」这个真实状态。 */
mod fake_webdav_dir;
mod item;
mod item_batch2;
mod md_backup_restore;
mod md_backup_target;
mod md_cloud_autosync;
mod md_cloud_conflict;
mod md_cloud_folder;
mod md_cloud_pending;
mod md_cloud_round;
/* [V0.11.19] 变更 B：围栏状态机（洞 1 / 洞 2）与三档诊断的单元判据。 */
mod md_section_fence;
/* [V0.11.19] J15：别人的围栏里有逐字标题时，那一块必须逐字节不变。 */
mod md_section_fence_j15;
/* [QA 独立验收 V0.11.19] T01 边界补例：CRLF/BOM、围栏标记尾随空格、闭合标记带
   语言标注、标题缩进、~~~ 交叉、三句逐字文案（变异自检的两处靶子在这里）。 */
mod qa_t01_fence_edges;
/* [QA 独立验收 V0.11.19] T01 真实一轮同步：洞 1 / 洞 2 / P1 三处，全部走
   `services::md_sync::run`，查文件字节与 SQL 软删，不靠纯函数自证。 */
mod qa_t01_sync_attack;
/* [V0.11.19 批 1] 两条链的纯判据（C5/C6/C7/C8 与 D2/D4/D5/D6/D8/D9）。
   桌面独占：被测的 `jobs::md_sync` / `jobs::md_cloud` 都是 `#[cfg(desktop)]`。 */
#[cfg(desktop)]
mod md_sync_wake;
#[cfg(desktop)]
mod md_cloud_tier;
mod md_sync;
/* [V0.11.18] 合并语义的**现状快照**（PRD C9 / 设计 §6）：五条「已知限制」的回归测试。
   拍照，不是修复——行为代码零改动，改行为前先改那个文件里的断言。 */
mod md_sync_conflict_semantics;
/* [V0.11.18] C9 的续篇（第 2、3 条）：为 300 行门禁拆出，夹具从上面那份 `pub(super)` 复用。 */
mod md_sync_conflict_merge_rules;
mod md_sync_disabled_gate;
mod md_sync_duration;
mod md_sync_edges;
mod md_sync_format;
mod md_sync_legacy_config;
mod md_sync_live;
mod md_sync_live_guard;
mod md_sync_notes;
mod md_sync_notes_guard;
/* [V0.11.16] B4 的持久化层证据：三档 `file`/`root` 各不相同时，「什么都没改的保存」
   必须原样落库（`settings` 表里的 JSON 逐字段比，不靠 mock 自证）。 */
mod md_sync_no_touch_save;
/* [V0.11.16] B2 的文件层证据：三档同名的文件名 → 落点目录只有一个 .md、三个标题都在。 */
mod md_sync_one_file;
mod md_sync_pairing;
mod md_sync_todo_edit;
mod md_sync_todo_export;
mod md_sync_todo_import;
mod md_sync_todos;
mod md_sync_upgrade;
mod md_webdav;
/* [V0.11.16] 「测试连接」三关的分诊证据（第 2 关带层级 / 第 3 关拖文件对照实验）。 */
mod md_webdav_probe;
/* MKCOL / 409 补建（V0.11.15，设计 §6.3）。 */
mod md_webdav_dir;
/* [QA G2] `level_path` 搬到 `tag.rs` 之后，「卡在第几级」填的仍是对的那一级。 */
mod md_webdav_level;
/* `fail_text` 的文案判据（状态码零命中）。 */
mod md_webdav_text;
/* [V0.11.16] E8 的本机可验部分：中文远端目录必须**编码一次**上网络（不二次编码）。 */
mod md_webdav_e8_encoding;
/* 「写文件」与「建目录」的 URL 必须同源（MKCOL 的 URL 是 PUT 的路径前缀）。 */
mod md_webdav_url;
mod migration;
mod migration_v2;
mod moyu_settings;
mod note;
mod note_pin;
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
mod reminder;
#[cfg(target_os = "windows")]
mod secret_dpapi;
mod settings_reference;
mod theme;
mod timer;
mod timer_clock;
mod timer_formula;
mod timer_recover_gap;
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
mod window_spec;
