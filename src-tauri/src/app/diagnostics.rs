//! 启动诊断快照：一份「用户报障时直接发过来」的纯文本现场。
//!
//! 为什么不走 IPC 命令：诊断是排障工具，不需要 UI 交互，也不该为它增加一条
//! 需要长期维护的契约。启动时写一次到 `logs/diagnostics.txt`，用户发日志时一起发。
//!
//! 内容刻意只收「定位问题必需、且不含隐私」的项：版本、路径、显示器、窗口、
//! 数据库大小。**不采集**事项名、记录内容、便利贴正文。

use std::fmt::Write as _;
use std::path::Path;

use tauri::{AppHandle, Manager};

use crate::infra::window_spec;
use crate::platform::log;

/// 写一份快照到 `<app_data_dir>/logs/diagnostics.txt`（覆盖式）。
pub fn write_snapshot(app: &AppHandle, app_data_dir: &Path) {
    let mut out = String::new();
    let _ = writeln!(out, "TickBar diagnostics");
    let _ = writeln!(out, "version      : {}", env!("CARGO_PKG_VERSION"));
    let _ = writeln!(
        out,
        "built        : {}",
        option_env!("TICKBAR_BUILD_TIME").unwrap_or("n/a")
    );
    let _ = writeln!(
        out,
        "os           : {} {}",
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    let _ = writeln!(out, "app_data_dir : {}", app_data_dir.display());
    if let Some(dir) = log::log_dir() {
        let _ = writeln!(out, "log_dir      : {}", dir.display());
    }
    let db_path = app_data_dir.join("tickbar.db");
    let db_size = std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);
    let _ = writeln!(
        out,
        "database     : {} ({} bytes)",
        db_path.display(),
        db_size
    );

    match app.available_monitors() {
        Ok(monitors) => {
            let _ = writeln!(out, "monitors     : {}", monitors.len());
            for (i, m) in monitors.iter().enumerate() {
                let p = m.position();
                let s = m.size();
                let _ = writeln!(
                    out,
                    "  [{i}] {} {}x{} @({},{}) scale={}",
                    m.name().map(|n| n.as_str()).unwrap_or("-"),
                    s.width,
                    s.height,
                    p.x,
                    p.y,
                    m.scale_factor()
                );
            }
        }
        Err(err) => {
            let _ = writeln!(out, "monitors     : <枚举失败: {err}>");
        }
    }

    let expect: Vec<&str> = vec![
        "main",
        window_spec::SETTINGS.label,
        window_spec::TODOS.label,
        window_spec::TIMER.label,
    ];
    let _ = writeln!(out, "singleton windows:");
    for label in expect {
        match app.get_webview_window(label) {
            Some(w) => {
                let size = w
                    .outer_size()
                    .map(|s| format!("{}x{}", s.width, s.height))
                    .unwrap_or_else(|_| "?".into());
                let visible = w
                    .is_visible()
                    .map(|v| v.to_string())
                    .unwrap_or_else(|_| "?".into());
                let _ = writeln!(out, "  {label:<10} visible={visible} size={size}");
            }
            None => {
                let _ = writeln!(out, "  {label:<10} <not created>");
            }
        }
    }

    let _ = writeln!(out, "log level    : {:?}", log::current_level());
    if let Some(dir) = log::log_dir() {
        let _ = std::fs::create_dir_all(dir);
        let _ = std::fs::write(dir.join("diagnostics.txt"), out);
    }
}
