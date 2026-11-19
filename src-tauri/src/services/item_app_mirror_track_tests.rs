//! 启动补镜像的**「不计入」口径**（从 `item_app_mirror_tests.rs` 拆出 —— 那个文件正好 300 行，
//! `check:size` 棘轮只许减不许增，所以新判据必须另起一个文件）。
//!
//! 守的是一条**用户明说过的话被静默推翻**的失效：
//! `track: false`（「仅观察」）写在 `__app_override::` 里，而 `__app_item_binding::`
//! （应用卡 / 事项栏那一份）**没有** track 的概念。口径 3 让单事项键覆盖"**哪些事项**"，
//! 但如果连"计不计入"也一起覆盖，用户在应用设置弹窗里标的「仅观察」就会在每次开机被翻回
//! 接管 —— 药丸于是重新自动计时，全程零日志。
//!
//! 口径（主理人拍）：**「不计入」是用户的明确决定，任何路径都不许把它翻回 1。**
//!   · Rust（这里）：`collect_wanted` 先收一遍 `track_off` 集合，单事项键补行时用它决定
//!     `track`；**已有行一律不改 track**（口径 1，别动）。
//!   · 前端：`loadAppItemBindingUnions` 的 `trackOff` 用 **OR** 合并（见
//!     `features/dashboard/services/appItemBindingMirror.ts` 头注：归一后成员 exe 与父应用
//!     是同一个统计应用，没法只对成员生效）。前端判据 `ai12`。
use crate::services::item_app_mirror::mirror;

use super::item_app_mirror_tests::{fixture, new_item, put, rows_for};

/// 口径 3 让位的是**哪些事项**，不是"计不计入"：应用在 override 里标了 `track: false`，
/// 单事项键补出来的那一行也必须带 `track = 0`。
///
/// 变异自证：把 1:1 那一路改回恒 `1` → 本条红（实收 `track = 1`）。
#[test]
fn single_item_key_keeps_the_track_off_flag() {
    tauri::async_runtime::block_on(async {
        let (business, kv) = fixture().await;
        let watched = new_item(&business, "读文档").await;
        let bound = new_item(&business, "写代码").await;
        put(
            &kv,
            "__app_override::code.exe",
            &format!(
                "{{\"enabled\":true,\"track\":false,\"itemBindings\":[{{\"itemId\":{watched}}}]}}"
            ),
        )
        .await;
        put(
            &kv,
            "__app_item_binding::code.exe",
            &format!("{{\"itemId\":{bound}}}"),
        )
        .await;

        mirror(&business, &kv).await.unwrap();

        /* 口径 3 仍然生效：只认单事项键那条（`watched` 不补进来）；
        但它必须带 `track = 0`（用户说过不计入）。 */
        assert_eq!(rows_for(&business, "code.exe").await, vec![(bound, 0)]);
    });
}
