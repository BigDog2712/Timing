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

use crate::infra::appdata_migrate::{self as mig, paths::DB_NAME, MigrationOutcome};
use crate::infra::window_spec;
use crate::platform::log;

/// 写一份快照到 `<app_data_dir>/logs/diagnostics.txt`（覆盖式）。
pub fn write_snapshot(app: &AppHandle, app_data_dir: &Path) {
    let mut out = String::new();
    let _ = writeln!(out, "Timing diagnostics");
    let _ = writeln!(out, "version      : {}", env!("CARGO_PKG_VERSION"));
    let _ = writeln!(
        out,
        "built        : {}",
        option_env!("TIMING_BUILD_TIME").unwrap_or("n/a")
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
    let db_path = app_data_dir.join(DB_NAME);
    let db_size = std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);
    let _ = writeln!(
        out,
        "database     : {} ({} bytes)",
        db_path.display(),
        db_size
    );

    /* [V0.5.0] 迁移现场三行：用户报障时第一眼看「数据从哪来 / 该去哪 / 旧目录在哪」。
    这三行是 PRD M-01 的期望输出，也是 M-05（发现未采用的旧数据）的唯一书面证据。 */
    let _ = writeln!(out, "migration    : {}", migration_label(app_data_dir));
    match mig::paths_used() {
        Some(used) => {
            let _ = writeln!(out, "migrate_target: {}", used.target.display());
            let _ = writeln!(out, "legacy       : {} (kept)", used.source.display());
        }
        None => {
            let legacy = mig::legacy_dir_of(app_data_dir)
                .map(|dir| dir.display().to_string())
                .unwrap_or_else(|| "-".into());
            let _ = writeln!(out, "migrate_target: <迁移未运行>");
            let _ = writeln!(out, "legacy       : {legacy} (kept)");
        }
    }

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

/// 迁移来源的一句话标签（`migration    :` 那一行）。
///
/// 判定顺序与 `commands::migration_cmd::resolve_source` 保持一致（那边给前端用、
/// 这边给文本快照用，两处都不该出现「标记文件在但显示 fresh」这种自相矛盾）。
fn migration_label(app_data_dir: &Path) -> &'static str {
    if mig::read_marker(app_data_dir).is_some() {
        return "migrated（已从旧目录迁移）";
    }
    if mig::read_pending(app_data_dir).is_some() {
        return "pending（旧数据待迁移，上次选了以空白数据启动）";
    }
    match mig::outcome() {
        Some(MigrationOutcome::Skipped) => "skipped（本次进程跳过迁移）",
        Some(MigrationOutcome::TargetOccupied(_)) => "unattached（发现未采用的旧数据）",
        Some(MigrationOutcome::Migrated(_)) => "migrated",
        Some(MigrationOutcome::Failed(_)) => "failed（详见旧目录 migration-failed.txt）",
        _ => "fresh（全新数据）",
    }
}
