//! Markdown 双向同步编排（V0.11.5 起是**内核功能**，不再是插件贡献点）。
//!
//! 落点默认值来自 `models::md_sync_config::default_bindings()`，用户可在
//! 「设置 → 同步」里覆盖；读写、冲突判定、数据库更新全在这里。
//!
//! 落点有三种：`timers`（事项计时，按 `started_at` 归日）、`notes`（便利贴，按「当天
//! 动过」归日）、`todos`（待办，未完成且计划时间不在当天）。每一种的取数口径写在
//! `export.rs`；三种都走同一套冲突判定。
//!
//! ## 一次同步的判定顺序
//!
//! 1. 计算 SQL 应该长什么样（`expected`）与该范围最大 `updated_at`；
//! 2. 读文件当前区块（`current`）与 mtime；
//! 3. 取上次写出的基线（`baseline`）定方向：文件变了 → 导入；只有 SQL 变了 → 导出；
//!    两边都变 → **Markdown 赢**（V0.11.3 起不再比 mtime，理由见 `sync_binding`）；
//! 4. 导入后重新渲染，把规范化结果写回文件（时间格式、分组顺序）；
//! 5. 更新基线，供下一轮判定。标题 / 文件不存在时**不导入**，只按 SQL 补写，
//!    避免用户改标题时误删数据。

pub mod config;
pub mod export;
pub mod format;
pub mod import;
pub mod mirror;
pub mod runtime;

use std::path::Path;

use chrono::Local;
use sqlx::SqlitePool;

use self::runtime::Runtime;
use crate::error::{AppError, AppResult};
use crate::infra::md_file::{self, SectionState};
use crate::models::md_sync::{
    MdSyncBinding, MdSyncBindingStatus, MdSyncKind, MdSyncReport, MdSyncStatus, MdSyncView,
};
use crate::platform::clock::now_ms;

/// 设置页读取：配置 + 最后一次运行状态 + 今日日期。
pub async fn get_view(pool: &SqlitePool) -> AppResult<MdSyncView> {
    let config = config::load(pool).await?;
    let status = runtime::lock().await.status.clone();
    Ok(MdSyncView {
        today: Local::now().format("%Y-%m-%d").to_string(),
        config,
        status,
    })
}

/// 自动同步间隔（秒）——实现放在 `config`（它才是读配置的地方）。
pub use config::poll_secs;

/// 手动「立即同步」。返回本轮报告，不因单个落点失败而整体报错。
pub async fn run(pool: &SqlitePool) -> AppResult<MdSyncReport> {
    sync_all(pool, None).await
}

/// 轮询任务用：只在真的从 Markdown 导入了数据时返回 `Some`，避免空转发事件。
pub async fn tick(pool: &SqlitePool) -> AppResult<Option<MdSyncReport>> {
    let report = sync_all(pool, None).await?;
    Ok(report.touched().then_some(report))
}

/// 打开某个种类的今日文件；文件还没生成时先同步一次。
pub async fn open(pool: &SqlitePool, kind: MdSyncKind) -> AppResult<()> {
    let config = config::load(pool).await?;
    let binding = config
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
    sync_all(pool, None).await?;
    if !path.exists() {
        return Err(AppError::io("今日文件尚未生成，请先保存并同步"));
    }
    /* [V0.11.3] 开文件交给 `infra::shell_open::open_file`：原先这里自己拼了一份
    `Command::new("explorer")`，与 infra 那份是同一件事的复制。安全口径也统一到一处
    ——`explorer` / `open` / `xdg-open` 只吃一个参数、不经 shell 解析
    （`cmd /C start` 才会把路径里的 `&`/`|` 当命令执行，V0.11.2 已弃用）。 */
    crate::infra::shell_open::open_file(&path).map_err(AppError::io)
}

/// 一轮同步。[`root_override`] 只给移动端用：Android 的落点是 SAF 的 `content://`
/// 目录，Rust 不认，由原生侧把当天文件镜像到沙箱内再交给这里，于是根目录换成镜像目录、
/// 其余（文件模板 / 标题 / 合并规则）原样来自配置——规则只此一份。
pub(super) async fn sync_all(pool: &SqlitePool, root_override: Option<&str>) -> AppResult<MdSyncReport> {
    /* 先拿锁再读配置：防止上一轮 tick 的旧配置在新配置保存后又写一次旧落点。 */
    let mut rt = runtime::lock().await;
    let config = config::load(pool).await?;
    let at = now_ms();
    let mut report = MdSyncReport::new(at);
    let mut next_status = MdSyncStatus {
        last_sync_at: Some(at),
        last_error: None,
        bindings: Vec::new(),
    };

    if !config.enabled {
        rt.status = next_status;
        rt.initialized = true;
        return Ok(report);
    }

    let date = Local::now().date_naive();
    for binding in &config.bindings {
        /* 移动端把根目录换成镜像目录；`is_configured()` 因此也能通过——手机上用户
        从未填过 root，配置里那一栏是空的。 */
        let binding = &match root_override {
            Some(root) => MdSyncBinding {
                root: root.to_string(),
                ..binding.clone()
            },
            None => binding.clone(),
        };
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
                report.exported += u32::from(outcome.exported);
                report.note_imported(binding.kind, outcome.imported);
                /* [V0.11.11] 真机排查的唯一现场：`adb logcat -s Timing` 能分清「没找到文件」
                「文件没变」「导入 0 条」——三者在界面上都是同一句「已写入文件」。 */
                crate::log_info!("md sync {}: {} exists={} dir={} imported={} exported={}", binding.kind.label(), status.path, outcome.exists, outcome.direction, outcome.imported, outcome.exported);
            }
            Err(err) => {
                crate::log_warn!("md sync {} 失败：{err}", binding.kind.label());
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
    /* mtime 仍读出来（`SectionState` 的一部分），但冲突判定不再用它：
    见下面「Markdown 永远赢」的注释。 */
    let (current, _mtime) = match &section {
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
            /* [V0.11.3] 两边都改过时 **Markdown 赢**。
            用户口径：「md 文档是第一优先级资料，sql 是第二级」。原先这里是
            `mtime > expected.latest_update`（最后写入者胜），但两边的时基根本不是一回事：
            `latest_update` 是应用写库的毫秒墙钟，`mtime` 取决于谁最后碰过文件——
            Obsidian 关闭时补写、同步盘回写、甚至一次「无改动保存」都会把它推后。
            结果就是「偶尔 SQL 反向覆盖掉用户手改的日记」，对一份声明为权威的资料不可接受。
            只有「文件没变、SQL 变了」才导出，其余一律以文件为准。 */
            if file_changed {
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
