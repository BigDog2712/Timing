//! 启动前的迁移决策（桌面独占）：跑迁移 → 失败时用原生对话框三选一。
//!
//! ## 为什么在 `Builder::run()` 之前，而不是 `setup` 里
//!
//! `tauri-2.12.4/src/app.rs` 的 `fn setup(app)` 是**先**按 config 建窗口
//! （`WebviewWindowBuilder::from_config(...).build()`）**再**调用户钩子。而
//! `window-state` 插件的 `on_window_ready` 在窗口创建那一刻就回填了位置 —— 迁移若写在
//! `setup` 里，首启拿到的永远是「新的空目录」，窗口位置回默认（M-11 必失败）。
//!
//! ## 为什么用 `rfd` 而不是 `tauri-plugin-dialog`
//!
//! 该插件的 `blocking_show` 源码注释明写「should NOT be used when running on the main
//! thread context」，而 `run()` 就在主线程 —— 调它等于自锁（应用启动即挂、无窗口无日志）。
//! `rfd 0.16` 是 dialog 插件的传递依赖（零新编译单元），`MessageDialog::show()` 同步阻塞；
//! 此刻事件循环尚未启动，主线程阻塞是安全的。
//!
//! ## 用户的三条出路（PRD §4.4）
//!
//! - **重试**：重新跑一次迁移（内部先清临时目录）；
//! - **以空白数据启动**：写 `pending-migrate.json`，本次以空库启动，下次启动走覆盖式迁移
//!   （不写这个标记的话，本次新建的空库会让「目标已有库」永久成立 —— ARCHITECTURE §7 N1）；
//! - **退出**：`std::process::exit(2)`（事件循环未启动，无需清理）。

use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};

use crate::infra::appdata_migrate::{self as mig, MigrationOutcome, Paths};

/// 退出码：迁移失败且用户选择「退出」。与「启动即崩溃」区分开，便于排查。
pub const EXIT_MIGRATION_ABORTED: i32 = 2;

/// 启动决策的结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BootChoice {
    /// 继续启动（迁移成功 / 无需迁移 / 用户选择空白启动）
    Proceed,
    /// 用户选择退出：调用方应立刻 `std::process::exit(2)`
    Abort,
}

/// 执行迁移并在失败时询问用户。返回是否继续启动。
///
/// `target_id` 是当前的 identifier（由 `lib.rs` 从 `Context` 取）；本函数只用它做
/// 一致性断言 —— 真正的路径已经由 `Paths` 算好，这里不再重算，避免「两处推断」。
pub fn prepare(paths: Option<Paths>, target_id: &str) -> BootChoice {
    debug_assert!(!target_id.is_empty(), "identifier 不应为空");
    let Some(paths) = paths else {
        /* 拿不到 `%APPDATA%`（极端环境）：没有可推断的路径，跳过迁移而不是瞎猜一个。 */
        return BootChoice::Proceed;
    };

    let mut outcome = mig::run_once(&paths, skip_requested());
    loop {
        let MigrationOutcome::Failed(failure) = &outcome else {
            return BootChoice::Proceed;
        };
        /* 失败明细先落盘再问人：用户在对话框上看到的只有一句话，细节要留给排查。 */
        let _ = mig::marker::write_failure(&paths.source, failure, &paths);
        match ask(&failure.reason, &paths.source.display().to_string()) {
            Choice::Retry => outcome = mig::run_once(&paths, false),
            Choice::Blank => {
                /* 内存标记不够：空白会话会在新目录里建库，下次启动「目标已有库」恒为真，
                老数据再也搬不过来。必须落一份待迁移标记，让下次启动走覆盖式迁移。 */
                if mig::marker::write_pending(&paths.target, &paths).is_err() {
                    /* 连标记都写不进去（目录不可写）→ 这一版只能本次以空库启动，
                    下次启动仍会按「目标有库 + 无标记」走 M-05 的提示分支，不会丢数据。 */
                }
                return BootChoice::Proceed;
            }
            Choice::Quit => return BootChoice::Abort,
        }
    }
}

/// 是否跳过迁移。
///
/// - `TIMING_SKIP_MIGRATE=1`：**永远**跳过（开发/QA 逃生开关，PRD R6）；
/// - debug 构建默认跳过，需 `TIMING_FORCE_MIGRATE=1` 才执行（ARCHITECTURE 决策 D-B）。
///   理由：`npm run tauri dev` 与正式版共用同一个 identifier，任何人不带环境变量
///   启动一次 dev 就会搬真实 `%APPDATA%` 数据，「靠记性」防不住，只能「靠机制」。
///   release 构建行为不变。
pub fn skip_requested() -> bool {
    if env_flag("TIMING_SKIP_MIGRATE") {
        return true;
    }
    cfg!(debug_assertions) && !env_flag("TIMING_FORCE_MIGRATE")
}

/// 跳过的**原因**（日志文案用，与 `skip_requested` 判定顺序保持一致）。
pub fn skip_reason() -> &'static str {
    if env_flag("TIMING_SKIP_MIGRATE") {
        "migrate: skipped by TIMING_SKIP_MIGRATE"
    } else {
        "migrate: skipped (debug build; set TIMING_FORCE_MIGRATE=1 to run)"
    }
}

/// 布尔型环境变量（`1/true/yes/on` 均视为真，大小写不敏感）。
fn env_flag(name: &str) -> bool {
    match std::env::var(name) {
        Ok(raw) => matches!(
            raw.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => false,
    }
}

/// 对话框返回值归一化。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Choice {
    Retry,
    Blank,
    Quit,
}

/// 弹原生对话框问用户。文案逐字对齐 PRD §4.4。
fn ask(reason: &str, source: &str) -> Choice {
    let body = format!(
        "检测到旧版本数据，但迁移失败，你的原始数据完整保留在：\n{source}\n原因：{reason}\n\n\
         你可以选择重试，或先以空白数据启动（旧数据不会被修改，稍后可用「重试迁移」再试）。"
    );
    let result = MessageDialog::new()
        .set_level(MessageLevel::Warning)
        .set_title("数据迁移未完成")
        .set_description(body)
        .set_buttons(MessageButtons::YesNoCancelCustom(
            "重试".to_string(),
            "以空白数据启动".to_string(),
            "退出".to_string(),
        ))
        .show();
    match result {
        MessageDialogResult::Yes => Choice::Retry,
        MessageDialogResult::No => Choice::Blank,
        /* Windows 自定义按钮在部分系统语言下会走 `Custom(文案)` 分支，两种都要认。 */
        MessageDialogResult::Custom(text) if text == "重试" => Choice::Retry,
        MessageDialogResult::Custom(text) if text == "以空白数据启动" => Choice::Blank,
        _ => Choice::Quit,
    }
}
