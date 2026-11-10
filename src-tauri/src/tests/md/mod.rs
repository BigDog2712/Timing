//! MD 同步域的测试（52 份）。
//!
//! 2026-11-09 从 `tests/` 平铺层拆出：原来 114 个文件挤在一层，光 `md_*` 就占 52 个
//! （`md_sync_*` 21 / `md_cloud_*` 14 / `md_webdav_*` 8 / `md_backup_*` 4 / 围栏 2 / 日记模板 1 /
//! 假服务器 2）。拆完文件名去掉 `md_` 前缀——目录已经说了是 MD 域，文件里再说一遍是冗余。
//!
//! 四簇：`sync_*` 本地文件同步语义、`cloud_*` WebDAV 云端与往期删除、`webdav_*` 协议与探针、
//! `backup_*` 备份导出恢复。`fake_webdav*` 是**共享夹具**，组外也在用。
//!
//! 引用规矩：本层内用 `super::…`；跨层用 `crate::tests::md::…`。
//! 组外（`tests/qa_*.rs` 与生产代码）仍引老路径 `crate::tests::md_sync` 等，
//! 由 `tests/mod.rs` 的 `pub(crate) use` 重导出保平——**别把那些重导出删了**。

/* 假 WebDAV 服务器（V0.11.15 从 `md_webdav.rs` 搬出）：`Fake` / `serve` / `serve_412_on_put`。 */
pub(crate) mod fake_webdav;
/* 路由式假服务器（V0.11.15）：409 补建的判据要「目录存不存在」这个真实状态。 */
pub(crate) mod fake_webdav_dir;

/* [V0.11.33] 日记模板三分支（P16/P17/P18）+ `seed_if_missing` 四条短路单元用例。 */
mod diary_template;
mod backup_restore;
mod backup_target;
mod cloud_autosync;
mod cloud_conflict;
/* [V0.11.26] 双通路的两条隔离判据：账本不串、轮次不串（PRD R1 / R2）。 */
mod cloud_dual;
mod cloud_folder;
mod cloud_pending;
mod cloud_round;
/* [V0.11.26] 落点**路径形态**与「建不了目录」文案：`\` 不是 POSIX 的分隔符，
   少一个路径就会让一次故障多绕一轮。 */
mod cloud_root_path;
/* [V0.11.19 变更 A] 往期真删的行为判据。拆成四份，各验一件事：
   六道闸主路径 / 收敛（批上限 + 暂停） / 纯判定（闸③ 路径比较 + 闸⑥ 留底） / WebDAV 路。 */
pub(crate) mod cloud_purge;
mod cloud_purge_batch;
mod cloud_purge_guard;
mod cloud_purge_webdav;
/* [V0.11.19 收口] 闸⑥ 的**接线**判据：删的是主人的文件（永久删除），
   所以「递进去的留底函数是 `save_checked` 本身」必须有机验，不能只靠注入式单测。 */
mod cloud_purge_wiring;
/* [V0.11.19] 变更 B：围栏状态机（洞 1 / 洞 2）与三档诊断的单元判据。 */
mod section_fence;
/* [V0.11.19] J15：别人的围栏里有逐字标题时，那一块必须逐字节不变。 */
mod section_fence_j15;
/* [V0.11.19 批 1] 两条链的纯判据（C5/C6/C7/C8 与 D2/D4/D5/D6/D8/D9）。
   桌面独占：被测的 `jobs::md_sync` / `jobs::md_cloud` 都是 `#[cfg(desktop)]`。 */
#[cfg(desktop)]
mod sync_wake;
#[cfg(desktop)]
mod cloud_tier;
/* [V0.11.21] 手机端与桌面共用的节奏分派：云端可用 → 三档；否则沿用 pollSecs。
   放在 services 里是因为 `jobs/md_sync_mobile` 是 `#[cfg(mobile)]`，桌面用例够不着。 */
mod cloud_tier_plan;
/* [V0.11.22] 手机端备份恢复的归属判据：手机只有 WebDAV 一个落点，
   obsidian__ / 老备份一律拒绝。判据在 services 里，桌面用例才够得着。 */
mod backup_mobile;
/* [V0.11.23] 备份导出的四道闸（名字 / 形态 / 落点 / 存在）。
   与 `backup_mobile` 同一个理由：判据在 `services`，桌面目标够得着。 */
mod backup_export;
pub(crate) mod sync;
/* [V0.11.18] 合并语义的**现状快照**（PRD C9 / 设计 §6）：五条「已知限制」的回归测试。
   拍照，不是修复——行为代码零改动，改行为前先改那个文件里的断言。 */
mod sync_conflict_semantics;
/* [V0.11.18] C9 的续篇（第 2、3 条）：为 300 行门禁拆出，夹具从上面那份 `pub(super)` 复用。 */
mod sync_conflict_merge_rules;
mod sync_disabled_gate;
mod sync_duration;
mod sync_edges;
mod sync_format;
mod sync_legacy_config;
pub(crate) mod sync_live;
mod sync_live_guard;
mod sync_notes;
mod sync_notes_guard;
/* [V0.11.16] B4 的持久化层证据：三档 `file`/`root` 各不相同时，「什么都没改的保存」
   必须原样落库（`settings` 表里的 JSON 逐字段比，不靠 mock 自证）。 */
mod sync_no_touch_save;
/* [V0.11.16] B2 的文件层证据：三档同名的文件名 → 落点目录只有一个 .md、三个标题都在。 */
mod sync_one_file;
mod sync_pairing;
mod sync_todo_edit;
mod sync_todo_export;
mod sync_todo_import;
mod sync_todos;
mod sync_upgrade;
mod webdav;
/* [V0.11.16] 「测试连接」三关的分诊证据（第 2 关带层级 / 第 3 关拖文件对照实验）。 */
mod webdav_probe;
/* MKCOL / 409 补建（V0.11.15，设计 §6.3）。 */
mod webdav_dir;
/* [QA G2] `level_path` 搬到 `tag.rs` 之后，「卡在第几级」填的仍是对的那一级。 */
mod webdav_level;
/* `fail_text` 的文案判据（状态码零命中）。 */
mod webdav_text;
/* [V0.11.16] E8 的本机可验部分：中文远端目录必须**编码一次**上网络（不二次编码）。 */
mod webdav_e8_encoding;
/* 「写文件」与「建目录」的 URL 必须同源（MKCOL 的 URL 是 PUT 的路径前缀）。 */
mod webdav_url;
/* 根证书必须是编译期内置的：平台验证器在 Android 上要 Kotlin 侧初始化，没有就 abort。 */
mod webdav_tls;
