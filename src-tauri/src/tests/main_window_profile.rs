//! main 窗口的 WebView **数据目录**口径（[0.12.1 修复]）。
//!
//! 守的是「建窗路径的两处一致」：`tauri.conf.json` 静态创建的 main 用 Tauri 默认数据目录，
//! 而 `ensure_main_window_once`（闲置销毁后的重建路径）曾钉 `webview_root`。**localStorage
//! 按数据目录分区**，所以窗口被销毁重建一次，悬浮条的 `timing.handles.v1` 与
//! `timing.appearance.v1` 就整份换成另一套 —— 用户看到「设置自己变了」，零日志。
//! 同一个根因的另一半是「设置页写了药丸读不到」（见 `lib/pillAppearance.ts::PILL_PREFS_EVENT`）。
//!
//! 为什么是源码哨兵而不是行为测试：`data_directory` 在类型上完全合法，`WebviewWindowBuilder`
//! 也不会因此报错；要观测它必须真建窗、真销毁、再真重建，跑不动。只能钉「函数体里没有它」。
//! 代价是约束写法，所以每条断言只钉「不许回到哪条路」，不钉具体怎么写。
//!
//! ⚠️ 注释里刻意不出现那个调用的完整字样（本项目的门禁/哨兵会扫到注释，`brand-gate` 扫
//! `TickBar` 就踩过）：改注释时别把带前导点的写法补回去，否则这条哨兵会红在自己身上。

const MAIN_WINDOW_RS: &str = include_str!("../app/insight/main_window.rs");
const MINI_WINDOW_RS: &str = include_str!("../app/insight/mini_window/native.rs");
const TOOL_NOTIFICATION_RS: &str = include_str!("../app/insight/tool_notifications/native.rs");

#[test]
fn main_window_never_pins_its_own_webview_profile() {
    /* 重建路径建的必须和 conf 建的是**同一个目录**：只有"什么都不设"才天然等于 conf 的默认。 */
    assert!(
        !MAIN_WINDOW_RS.contains(".data_directory("),
        "main 窗口的建窗路径不许再钉 data_directory ——\n\
         它与 tauri.conf 静态创建时用的 Tauri 默认目录不是一处，localStorage 会分成两份，\n\
         窗口闲置销毁重建后悬浮条的手柄绑定与外观会整份换掉（0.12.1 实测）。\n\
         要改缓存落点，改 conf 与这里**同时**，别只改一边。"
    );
}

#[test]
fn patina_windows_keep_their_own_profile() {
    /* 反向：patina / mini / 桌面通知弹窗要的是 Patina 自己的 profile，
       不能被人"顺手统一"到 main 的目录里 —— 那会让 Patina 的 UI 偏好与 Timing 的
       药丸偏好住进同一份 localStorage，键名一旦撞车就是互相覆盖。 */
    for (name, src) in [
        ("mini_window/native.rs", MINI_WINDOW_RS),
        ("tool_notifications/native.rs", TOOL_NOTIFICATION_RS),
    ] {
        assert!(
            src.contains(".data_directory("),
            "{name} 必须继续钉自己的 webview_root —— 它属于 Patina 的 profile，不是 main 的。\n\
             真要合并进 main 的目录，先去读 lib/pillAppearance.ts 的 PILL_PREFS_EVENT 注释再动。"
        );
    }
}
