//! Markdown 双向同步编排（插件 API v2 的 `mdSync` 宿主实现）。
//!
//! 插件只声明落点；真正的读写、冲突判定、数据库更新全在这里。这样插件保持
//! **声明式**：不执行任何插件代码，也不给前端直连数据库的能力。
//!
//! 落点有三种：`timers`（事项计时，按 `started_at` 归日）、`notes`（便利贴，按
//! 「当天动过」归日）、`todos`（待办事项，未完成且计划时间不在当天）。每一种的
//! 取数口径写在 `export.rs`；三种都走同一套冲突判定。
//!
//! ## 一次同步的判定顺序
//!
//! 1. 计算 SQL 应该长什么样（`expected`）与该范围最大 `updated_at`；
//! 2. 读文件当前区块（`current`）与 mtime；
//! 3. 取上次写出的基线（`baseline`）：
//!    - 文件 = 基线、SQL ≠ 基线 → 导出（SQL 侧改的）；
//!    - 文件 ≠ 基线、SQL = 基线 → 导入（文件侧改的）；
//!    - 两边都 ≠ 基线 → 比 mtime 与 `updated_at`，最后写入者胜；
//! 4. 导入后重新渲染，把规范化结果写回文件（时间格式、分组顺序）；
//! 5. 更新基线，供下一轮判定。标题 / 文件不存在时**不导入**，只按 SQL 补写，
//!    避免用户改标题时误删数据。

pub mod config;
pub mod export;
pub mod format;
pub mod import;
pub mod runtime;

use std::path::Path;
use std::process::Command;

use chrono::Local;
use sqlx::SqlitePool;

use self::runtime::Runtime;
use crate::error::{AppError, AppResult};
use crate::infra::md_file::{self, SectionState};
use crate::models::md_sync::{
    MdSyncBinding, MdSyncBindingStatus, MdSyncConfig, MdSyncKind, MdSyncReport, MdSyncStatus,
    MdSyncView,
};
use crate::platform::clock::now_ms;

/// 设置页读取：插件身份 + 配置 + 最后一次运行状态 + 今日日期。
pub async fn get_view(pool: &SqlitePool, app_data_dir: &Path) -> AppResult<MdSyncView> {
    let loaded = config::load(pool, app_data_dir).await?;
    let status = runtime::lock().await.status.clone();
    Ok(MdSyncView {
        installed: loaded.installed(),
        plugin_id: loaded.plugin_id,
        plugin_name: loaded.plugin_name,
        plugin_version: loaded.plugin_version,
        today: Local::now().format("%Y-%m-%d").to_string(),
        config: loaded.config,
        status,
    })
}

/// 保存配置并立刻同步一次；返回保存后的视图（含本轮状态）。
pub async fn save_config(
    pool: &SqlitePool,
    app_data_dir: &Path,
    config: &MdSyncConfig,
) -> AppResult<MdSyncView> {
    config::save(pool, config).await?;
    sync_all(pool, app_data_dir).await?;
    get_view(pool, app_data_dir).await
}

/// 手动「立即同步」。返回本轮报告，不因单个落点失败而整体报错。
pub async fn run(pool: &SqlitePool, app_data_dir: &Path) -> AppResult<MdSyncReport> {
    sync_all(pool, app_data_dir).await
}

/// 轮询任务用：只在真的从 Markdown 导入了数据时返回 `Some`，避免空转发事件。
pub async fn tick(pool: &SqlitePool, app_data_dir: &Path) -> AppResult<Option<MdSyncReport>> {
    let report = sync_all(pool, app_data_dir).await?;
    Ok(report.touched().then_some(report))
}

/// 打开某个种类的今日文件；文件还没生成时先同步一次。
pub async fn open(pool: &SqlitePool, app_data_dir: &Path, kind: MdSyncKind) -> AppResult<()> {
    let loaded = config::load(pool, app_data_dir).await?;
    let binding = loaded
        .config
        .bindings
        .iter()
        .find(|binding| binding.kind == kind)
        .ok_or_else(|| {
            AppError::md_sync_config_invalid(format!("未配置「{}」落点", kind.label()))
        })?;
    if !binding.is_configured() {
        return Err(AppError::md_sync_config_invalid(format!(
            "「{}」落点尚未填写完整",
            kind.label()
        )));
    }
    let date = Local::now().date_naive();
    let path = md_file::resolve_path(&binding.root, &binding.file, date);
    if !path.is_absolute() {
        return Err(AppError::md_sync_config_invalid(
            "根目录无法解析为绝对路径：检查盘符 / %VAR% / 开头的 ~",
        ));
    }
    /* 先同步一轮：文件存在但标题还没写出来时，也要先补上区块再打开。 */
    sync_all(pool, app_data_dir).await?;
    if !path.exists() {
        return Err(AppError::io("今日文件尚未生成，请先保存并同步"));
    }
    open_path(&path)
}

async fn sync_all(pool: &SqlitePool, app_data_dir: &Path) -> AppResult<MdSyncReport> {
    /* 先拿锁再读配置：防止上一轮 tick 的旧配置在新配置保存后又写一次旧落点。 */
    let mut rt = runtime::lock().await;
    let loaded = config::load(pool, app_data_dir).await?;
    let at = now_ms();
    let mut report = MdSyncReport::new(at);
    let mut next_status = MdSyncStatus {
        last_sync_at: Some(at),
        last_error: None,
        bindings: Vec::new(),
    };

    if !loaded.installed() || !loaded.config.enabled {
        rt.status = next_status;
        rt.initialized = true;
        return Ok(report);
    }

    let date = Local::now().date_naive();
    for binding in &loaded.config.bindings {
        let mut status = MdSyncBindingStatus::empty(binding.kind);
        if !binding.enabled {
            next_status.bindings.push(status);
            continue;
        }
        if !binding.is_configured() {
            status.last_error = Some("尚未填写根目录 / 文件 / 标题".into());
            next_status.bindings.push(status);
            continue;
        }

        let path = md_file::resolve_path(&binding.root, &binding.file, date);
        status.path = path.display().to_string();
        status.exists = path.exists();
        /* 未知环境变量会原样留下（如 `%TYPO%\...`），Path::join 后变成相对路径，
        再 create_dir_all 就会写到进程当前目录。这里直接拦下，要求绝对路径。 */
        if !path.is_absolute() {
            status.last_error =
                Some("根目录无法解析为绝对路径：检查盘符 / %VAR% / 开头的 ~".into());
            next_status.bindings.push(status);
            continue;
        }
        match sync_binding(pool, &mut rt, binding, date, &path).await {
            Ok(outcome) => {
                status.exists = outcome.exists;
                status.last_direction = Some(outcome.direction.to_string());
                status.last_sync_at = Some(at);
                if outcome.exported {
                    report.exported += 1;
                }
                report.note_imported(binding.kind, outcome.imported);
            }
            Err(err) => {
                status.last_error = Some(err.clone());
                report
                    .errors
                    .push(format!("「{}」{err}", binding.kind.label()));
            }
        }
        next_status.bindings.push(status);
    }

    if !report.errors.is_empty() {
        next_status.last_error = Some(report.errors.join("；"));
    }
    rt.status = next_status;
    rt.initialized = true;
    Ok(report)
}

struct BindingOutcome {
    exported: bool,
    imported: u32,
    direction: &'static str,
    exists: bool,
}

async fn sync_binding(
    pool: &SqlitePool,
    rt: &mut Runtime,
    binding: &MdSyncBinding,
    date: chrono::NaiveDate,
    path: &Path,
) -> Result<BindingOutcome, String> {
    let section = md_file::read_section(path, &binding.heading)?;
    let expected = render_expected(pool, binding, date)
        .await
        .map_err(|err| err.to_string())?;
    let (current, mtime) = match &section {
        SectionState::MissingFile => (None, 0),
        /* 标题缺失按「文件侧没有这一节」处理：只补写，不把空内容当删除。 */
        SectionState::MissingHeading { mtime_ms } => (None, *mtime_ms),
        SectionState::Present { body, mtime_ms } => (Some(body.clone()), *mtime_ms),
    };

    let baseline = rt.baseline(binding.kind, path, &binding.heading).cloned();
    let mut imported = 0;
    let target = match &current {
        None => expected.body.clone(),
        Some(body) if body.trim() == expected.body.trim() => expected.body.clone(),
        Some(body) => {
            let file_changed = baseline.as_ref().is_none_or(|base| base.body != *body);
            let db_changed = baseline
                .as_ref()
                .is_none_or(|base| base.body != expected.body);
            let should_import = if !file_changed && db_changed {
                false
            } else if file_changed && !db_changed {
                true
            } else {
                mtime > expected.latest_update
            };
            if should_import {
                let old_body = baseline.as_ref().map_or("", |base| base.body.as_str());
                let (rendered, count) =
                    import_and_render(pool, binding, date, old_body, body).await?;
                imported = count;
                rendered
            } else {
                expected.body.clone()
            }
        }
    };

    let needs_write = match &section {
        SectionState::MissingFile | SectionState::MissingHeading { .. } => {
            !target.trim().is_empty()
        }
        SectionState::Present { body, .. } => body.trim_end() != target.trim_end(),
    };
    if needs_write {
        md_file::write_section(path, &binding.heading, &target)?;
    }
    rt.set_baseline(binding.kind, path, &binding.heading, target);

    Ok(BindingOutcome {
        exported: needs_write,
        imported,
        direction: if imported > 0 {
            "import"
        } else if needs_write {
            "export"
        } else {
            "none"
        },
        exists: path.exists(),
    })
}

async fn render_expected(
    pool: &SqlitePool,
    binding: &MdSyncBinding,
    date: chrono::NaiveDate,
) -> AppResult<export::Exported> {
    /* 分发在 `export::by_kind`：这里长一串 match 会越过 300 行硬约束，而种类只会更多。 */
    export::by_kind(pool, binding.kind, date).await
}

async fn import_and_render(
    pool: &SqlitePool,
    binding: &MdSyncBinding,
    date: chrono::NaiveDate,
    old_body: &str,
    new_body: &str,
) -> Result<(String, u32), String> {
    let stats = import::by_kind(pool, binding.kind, date, old_body, new_body)
        .await
        .map_err(|err| err.to_string())?;
    let rendered = render_expected(pool, binding, date)
        .await
        .map_err(|err| err.to_string())?;
    Ok((rendered.body, stats.total()))
}

fn open_path(path: &Path) -> AppResult<()> {
    /* [V0.11.2] Windows 不走 `cmd /C start`：路径由插件 manifest 的 root/file 拼出来，
    含 `&`/`|` 且不带空格时 cmd 会当命令执行（等价任意命令执行）。explorer 只吃一个参数。 */
    #[cfg(target_os = "windows")]
    let spawned = Command::new("explorer").arg(path).spawn();
    #[cfg(target_os = "macos")]
    let spawned = Command::new("open").arg(path).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let spawned = Command::new("xdg-open").arg(path).spawn();

    spawned
        .map(|_| ())
        .map_err(|err| AppError::io(format!("打开文件失败：{err}")))
}
