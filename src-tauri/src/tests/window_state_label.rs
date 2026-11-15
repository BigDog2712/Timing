//! M-9 · `lib.rs::window_state_label` 的映射契约（T04-4 §6）。
//!
//! 主窗 label 从 "patina" 改为 "activity"，`.window-state.json` 的顶层键就是 label，
//! window-state 插件按 label 取值 ⇒ 旧档位只认 "patina"。mapper 的契约是：
//!
//!   · `"activity"` ⇒ `"patina"`（唯一映射，升级首启主窗几何不回默认）；
//!   · 其余一律**恒等**（`map_label` 读写两侧都走 mapper，恒等分支错一个，
//!     那个窗口的几何就会在退出时被写到错误的档位）。
//!
//! 纯函数，不必起 Tauri；用例只测映射本身，不测插件装配。

#[test]
fn m9_activity_maps_to_patina() {
    assert_eq!(crate::window_state_label("activity"), "patina");
}

#[test]
fn m9_every_other_label_is_identity() {
    /* 便利贴窗是 `note-1` 这类带序号的 label，抽一个代表 + 常见窗 + 空串。 */
    for label in ["main", "todos", "note-1", "settings", "mini", ""] {
        assert_eq!(crate::window_state_label(label), label, "label={label:?}");
    }
}
