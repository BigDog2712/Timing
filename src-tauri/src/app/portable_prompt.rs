//! 便携落点的原生对话框（V0.11.6，ADR-050 §3）：文案与「按钮 → 语义」的映射。
//!
//! 从 `app/portable_boot.rs` 拆出：那边已有编排 + 探测 + 标记 + 插件搬运，加上四段
//! 逐字文案会破 300 行硬门禁。**判据与顺序在 `portable_boot`，文案在本模块**——
//! 改文案不该碰到流程，改流程也不该顺手改文案。
//!
//! 为什么用 `rfd` 而不是 `tauri-plugin-dialog`：它的 `blocking_show` 源码注释明写
//! 「should NOT be used when running on the main thread context」，而本层跑在
//! `Builder::run()` 之前的主线程上（`app/preboot.rs` 顶部同一段理由）。此刻事件
//! 循环未启动，同步阻塞是安全的。
//!
//! Windows 在部分系统语言下会把自定义按钮回报成 `MessageDialogResult::Custom(文案)`，
//! 因此每个对话框都要同时认 `Yes/No` 与 `Custom("重试")` / `Custom("改用 AppData")`
//! （照抄 `app/preboot.rs::ask` 的 match，那是对着真机调过的）。

use std::path::{Path, PathBuf};

use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};

use crate::platform::app_dir;

/// 用户的选择（语义化，不绑定按钮文案）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Choice {
    /// 重试 / 继续（探测通过、或用户点「重试」）
    Proceed,
    /// 改用 AppData；参数是写进标记文件的一行明细
    AppData(String),
    /// 退出（事件循环未启动，调用方直接 `exit`）
    Quit,
}

/// 「权限不足」三选一（文案逐字对齐 ADR-050 §3）。
pub fn ask_permission(reason: &str, data_dir: &Path) -> Choice {
    let appdata = app_dir::appdata_dir(app_dir::FALLBACK_IDENTIFIER)
        .map(|dir| dir.display().to_string())
        .unwrap_or_else(|| "%APPDATA%\\com.timing.app".into());
    let body = format!(
        "Timing 的数据要放在应用旁边，但当前没有写入权限：\n  {}\n\n\
         原因：{reason}\n\n\
         请任选一种方式授予权限，然后点「重试」：\n  \
         · 右键 Timing.exe 所在文件夹 → 属性 → 安全 → 编辑 → 选中你的用户 → 勾选「完全控制」\n  \
         · 或右键 Timing.exe →「以管理员身份运行」（数据将由管理员账户写入）\n  \
         · 或把整个 Timing 文件夹移到你有写权限的位置（例如 D:\\Tools\\Timing）\n\n\
         确实无法授予权限时，可以点「改用 AppData」：数据会存到\n  {appdata}\n\
         此时数据不再位于应用旁边，Timing 会在该目录留下 {OPTOUT} 记录这个选择。",
        data_dir.display(),
        OPTOUT = super::portable_boot::OPTOUT_FILE,
    );
    tri(
        MessageDialog::new()
            .set_level(MessageLevel::Warning)
            .set_title("无法在应用目录写入数据")
            .set_description(body)
            .set_buttons(MessageButtons::YesNoCancelCustom(
                "重试".to_string(),
                "改用 AppData".to_string(),
                "退出".to_string(),
            ))
            .show(),
        reason,
    )
}

/// 「旧数据没能搬过来」三选一。失败**不阻塞**启动。
pub fn ask_migrate_failed(reason: &str, source: Option<&Path>) -> Choice {
    let source = source
        .map(|dir| dir.display().to_string())
        .unwrap_or_else(|| "（未知）".into());
    let body = format!(
        "检测到旧版本数据，但没能搬到应用旁边。\n\n原因：{reason}\n\n\
         你的原始数据完整保留在：\n  {source}\n\n\
         可以点「重试」；或点「改用 AppData」（数据继续存在该目录，本次不再搬）；\
         或退出后手工处理。"
    );
    tri(
        MessageDialog::new()
            .set_level(MessageLevel::Warning)
            .set_title("旧数据没能搬到应用旁边")
            .set_description(body)
            .set_buttons(MessageButtons::YesNoCancelCustom(
                "重试".to_string(),
                "改用 AppData".to_string(),
                "退出".to_string(),
            ))
            .show(),
        reason,
    )
}

/// 「你设的数据目录现在用不了」三选一（V0.11.15，设计 §3.2）。
///
/// 与 `ask_permission` 的区别：那边问的是「应用旁边能不能写」（optout 的入口），这里问
/// 的是「**用户自己选过**的那个目录还能不能用」。因此文案必须点名那个目录，否则用户
/// 会以为是程序把数据丢了。第三个选项是「这次按默认流程启动」而不是「改用 AppData」：
/// 指针**保留**，下次启动仍先试它（插回移动盘就好）。
pub fn ask_data_root_unavailable(reason: &str, data_dir: &Path, default_data: &Path) -> Choice {
    let body = format!(
        "你指定的数据目录现在用不了：\n  {}\n\n\
         原因：{reason}\n\n\
         请检查它是否被拔掉 / 改名 / 权限被回收，然后点「重试」。\n\n\
         点「这次按默认流程启动」会先按默认位置启动（这次不会再问，也不再搬数据）：\n  {}\n\
         你设的路径会保留，下次启动仍先试它。",
        data_dir.display(),
        default_data.display(),
    );
    tri(
        MessageDialog::new()
            .set_level(MessageLevel::Warning)
            .set_title("指定的数据目录用不了")
            .set_description(body)
            .set_buttons(MessageButtons::YesNoCancelCustom(
                "重试".to_string(),
                "这次按默认流程启动".to_string(),
                "退出".to_string(),
            ))
            .show(),
        reason,
    )
}

/// 「已改用 AppData」二次显式告知（`Info` + OK）：回退必须可见、必须给出目录位置。
pub fn ask_appdata_notice(appdata: &Path) {
    let body = format!(
        "已改用 AppData\n数据目录：{}\n\n\
         想让数据回到应用旁边：给目录权限后，删除上面目录里的 {OPTOUT}，\n\
         下次启动会自动重新检测并搬过来（旧数据只复制、不删除）。",
        appdata.display(),
        OPTOUT = super::portable_boot::OPTOUT_FILE,
    );
    MessageDialog::new()
        .set_level(MessageLevel::Info)
        .set_title("数据目录已改为 AppData")
        .set_description(body)
        .set_buttons(MessageButtons::Ok)
        .show();
}

/// 两个落点都不可写：说清「为什么启动不了」，然后由调用方 `exit(3)`。
pub fn ask_no_data_dir(why: &str) {
    let body = format!("{why}\n\n没有可写目录就没有日志、没有数据库，Timing 无法启动。");
    MessageDialog::new()
        .set_level(MessageLevel::Error)
        .set_title("没有可写的数据目录")
        .set_description(body)
        .set_buttons(MessageButtons::Ok)
        .show();
}

/// 缺 WebView2：给下载页出口，装完再启动。
pub fn ask_webview2() {
    const URL: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
    let result = MessageDialog::new()
        .set_level(MessageLevel::Error)
        .set_title("缺少 Microsoft Edge WebView2 运行时")
        .set_description(format!(
            "缺少 Microsoft Edge WebView2 运行时，Timing 无法显示界面。\n\n\
             请下载并安装后重新启动 Timing：\n{URL}"
        ))
        .set_buttons(MessageButtons::OkCancelCustom(
            "打开下载页".to_string(),
            "退出".to_string(),
        ))
        .show();
    let open = match result {
        MessageDialogResult::Ok => true,
        MessageDialogResult::Custom(text) => text == "打开下载页",
        _ => false,
    };
    if open {
        if let Err(err) = crate::infra::shell_open::open_url(URL) {
            crate::log_warn!("portable: 打开 WebView2 下载页失败：{err}");
        }
    }
}

/// 便携版是否有 WebView2 运行时（**纯 fs 探测**，零新依赖）。
///
/// 判据：某根目录下存在 `Microsoft\EdgeWebView\Application\<version>\msedgewebview2.exe`
/// 即视为已安装。比读注册表更稳——不受 WOW6432Node 视图影响（ADR-051 §1）。
#[cfg(windows)]
pub fn webview2_ok() -> bool {
    let mut roots: Vec<PathBuf> = Vec::new();
    for key in ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"] {
        if let Ok(value) = std::env::var(key) {
            roots.push(PathBuf::from(value));
        }
    }
    roots.iter().any(|base| has_webview2(base))
}

#[cfg(windows)]
fn has_webview2(base: &Path) -> bool {
    let app = base
        .join("Microsoft")
        .join("EdgeWebView")
        .join("Application");
    let Ok(entries) = std::fs::read_dir(&app) else {
        return false;
    };
    entries
        .filter_map(|entry| entry.ok())
        .any(|entry| entry.path().join("msedgewebview2.exe").is_file())
}

/// 非 Windows：运行时由系统 / 打包方保证，探针恒通过。
#[cfg(not(windows))]
pub fn webview2_ok() -> bool {
    true
}

/// `YesNoCancelCustom` 的三值归一化（两种回报形态都要认）。
///
/// 两个自定义文案各属一个对话框：「改用 AppData」在权限 / 迁移失败的框里，「这次按默认
/// 流程启动」在自定义数据根不可用的框里。两个都归到 `AppData` —— 这个变体的语义是
/// 「这次先走默认流程」，不是「写 optout」（写不写由调用方决定）。
fn tri(result: MessageDialogResult, detail: &str) -> Choice {
    match result {
        MessageDialogResult::Yes | MessageDialogResult::Ok => Choice::Proceed,
        MessageDialogResult::No => Choice::AppData(detail.to_string()),
        MessageDialogResult::Custom(text) if text == "重试" => Choice::Proceed,
        MessageDialogResult::Custom(text)
            if text == "改用 AppData" || text == "这次按默认流程启动" =>
        {
            Choice::AppData(detail.to_string())
        }
        /* 取消 / 关闭窗口 / 未知文案一律按「退出」处理：不替用户做选择。 */
        _ => Choice::Quit,
    }
}
