//! 「设置只有一个家」的**源码级**哨兵（[0.12.1] T04b 收尾 · QA 报告 §1）。
//!
//! 为什么是哨兵而不是行为测试：`open_settings_window` 要一个真 `AppHandle` 才能跑，
//! 而这两个用例要守的东西恰好是「**它不再建窗**」——那件事在类型层面看不出来
//! （签名一样、返回值一样），只有函数体里出现了什么/没出现什么能证明。所以照本项目
//! 既有的源码哨兵写法（`portable_dir_qa_source.rs` 的 a1d/a1e 同一口径）：用
//! `include_str!` 把源码**编译期**嵌进来，断言函数体的内容。好处是路径与工作目录无关，
//! 坏处是它约束实现写法——所以每条断言都只钉「不许回到哪条路」，不钉具体怎么写。
//!
//! 背景（QA 实证的死代码带枪）：命令仍注册 → `window_spec::SETTINGS` 仍是
//! `index.html?w=settings` → 前端 `windowApi.openSettingsWindow` 仍在。一旦哪天有人按
//! 老写法把 `open_panel_window` 接回去，桌面上就会多一扇 392×660 的透明置顶窗：
//! 前端 `currentWindowKind()` 把 label `settings` 兜底成 `'main'`，窗里是一条悬浮条，
//! 点哪儿都没反应；`capabilities/default.json` 的 windows 里也没有这个 label，
//! 于是**日志近乎为零**。这比删错命令更难查，所以用哨兵钉住。

const WINDOW_RS: &str = include_str!("../infra/window.rs");
const WINDOW_CMD_RS: &str = include_str!("../commands/window_cmd.rs");
const IPC_COMMANDS_RS: &str = include_str!("../ipc_commands.rs");

/// 抠出一个顶层函数的正文。顶层函数以 `\n}` 收尾（`pub fn` 顶格写，右括号也顶格）。
fn fn_body<'a>(src: &'a str, signature: &str) -> &'a str {
    let start = src
        .find(signature)
        .unwrap_or_else(|| panic!("源码里找不到 `{signature}` —— 函数改名了就把这条哨兵一起改"));
    let rest = &src[start..];
    let end = rest
        .find("\n}\n")
        .expect("顶层函数应以列 0 的 `}` 收尾；写法变了请同步这条哨兵");
    &rest[..end + 2]
}

#[test]
fn settings_entry_delegates_and_never_builds_a_window() {
    let body = fn_body(WINDOW_RS, "pub fn open_settings_window");

    /* ① 必须走托盘那条通道：`open_settings` 内部先写 pending 再 show，冷启动也落得对。 */
    assert!(
        body.contains("tools_navigation::open_settings"),
        "open_settings_window 必须委托给 tools_navigation::open_settings：\n{body}"
    );
    /* ② 不许按 spec 建窗。 */
    assert!(
        !body.contains("open_panel_window"),
        "open_settings_window 里又出现 open_panel_window —— 那会造出一扇没有 capability、\
         前端也认不出 label 的透明置顶窗（QA「死代码带枪」）：\n{body}"
    );
    /* ③ 连规格都不许取：取 spec 是「下一步就建窗」的前兆。 */
    assert!(
        !body.contains("window_spec::SETTINGS"),
        "open_settings_window 里又去取 window_spec::SETTINGS 了：设置已经没有独立窗：\n{body}"
    );
    /* ④ 失败要变成 AppError（命令层签名不变），不许 unwrap/expect —— release 是 panic=abort。 */
    assert!(
        !body.contains("unwrap()") && !body.contains("expect("),
        "open_settings_window 里不许 unwrap/expect（release panic=abort）：\n{body}"
    );
}

#[test]
fn settings_command_and_spec_path_stay_registered() {
    /* 命令**不许**删：81 条命令是冻结契约（`scripts/check-contract.mjs` 也钉着）。
       这条同时是下一条哨兵的防假绿：如果哪天命令被删了，上面那条「别名」就无从谈起。 */
    assert!(
        WINDOW_CMD_RS.contains("pub async fn open_settings_window"),
        "commands/window_cmd.rs 少了 open_settings_window（命令数冻结 81，不许删）"
    );
    assert!(
        WINDOW_CMD_RS.contains("window::open_settings_window(&app)"),
        "命令应转交给 infra::window::open_settings_window"
    );
    assert!(
        IPC_COMMANDS_RS.contains("open_settings_window"),
        "ipc_commands.rs 的 generate_handler! 里少了 open_settings_window"
    );
    /* `SETTINGS` 规格仍在（`spec_for(\"settings\")` 被 label 表与测试引用），
       但它的注释必须写明「已无建窗入口」——文档与代码背离是这轮事故的根源。 */
    let spec = include_str!("../infra/window_spec.rs");
    assert!(
        spec.contains("pub const SETTINGS: WindowSpec"),
        "window_spec::SETTINGS 被删了：spec_for(\"settings\") 会返回 None，调用点全变空指针"
    );
    assert!(
        spec.contains("已经没有建窗入口"),
        "window_spec::SETTINGS 的注释必须写明「已经没有建窗入口」"
    );
}
