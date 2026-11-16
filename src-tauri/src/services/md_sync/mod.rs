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

pub mod audit;
pub mod config;
pub mod decision;
/* [V0.11.19] 业务写入信号（命令层白名单，jobs 下 0 处）。 */
pub mod dirty;
pub mod export;
pub mod format;
pub mod import;
pub mod mirror;
pub mod runtime;

mod binding;

/* `sync_all` 用到的三件落点级动作搬到 `binding.rs`（本文件撞 300 行）：
   一轮里「读懂一个落点 → 判定 → 写入」的整段逻辑都在那里。 */
use self::binding::sync_binding;

use chrono::Local;
use sqlx::SqlitePool;

use self::decision::ConflictMode;
use crate::error::{AppError, AppResult};
use crate::infra::md_file;

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

/* [V0.11.21] `poll_secs` 无界面入口，字段保留只为老库原样读回；手机端按三档跑（tier::plan_of）。 */

/// 前台入口：检测到 md 冲突时挂起 `AwaitingDecision`，等用户裁决。
///
/// 生产调用点走 `md_cloud::round`（它自己也是 `Awaiting`）；本函数保留给
/// 同步测试与「不经云端、只刷 Obsidian 落点」的调用方——`src/tests/md/**`
/// 与 `qa_t01_sync_attack.rs` 共 89 处用它，删掉就得让每个用例自己写一遍
/// `run_with(pool, Awaiting)`，等于把产品口径抄进测试。
#[cfg_attr(not(test), allow(dead_code))]
pub async fn run(pool: &SqlitePool) -> AppResult<MdSyncReport> {
    run_with(pool, ConflictMode::Awaiting).await
}

/// 手动「立即同步」。返回本轮报告，不因单个落点失败而整体报错。
///
/// [`mode`] 决定「文件侧被改过」时怎么处置：前台（能弹窗）传 `Awaiting`、
/// 后台轮传 `Pending`、云端内部副本传 `AutoMerge`。**没有默认值**——冲突处置
/// 是产品口径，不该由这个函数的签名替调用方拍板。
pub async fn run_with(pool: &SqlitePool, mode: ConflictMode) -> AppResult<MdSyncReport> {
    sync_all(pool, None, mode).await
}

/// 轮询任务用：只在真的从 Markdown 导入了数据时返回 `Some`，避免空转发事件。
/// 后台入口：检测到 md 冲突时挂起 `PendingDecision`，不静默改写任一端。
pub async fn tick(pool: &SqlitePool) -> AppResult<Option<MdSyncReport>> {
    let report = sync_all(pool, None, ConflictMode::Pending).await?;
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
    sync_all(pool, None, ConflictMode::Awaiting).await?;
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
pub(super) async fn sync_all(
    pool: &SqlitePool,
    root_override: Option<&str>,
    mode: ConflictMode,
) -> AppResult<MdSyncReport> {
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
        match sync_binding(pool, &mut rt, binding, date, &path, &config.diary_template, mode).await {
            Ok(outcome) => {
                status.exists = outcome.exists;
                status.last_direction = Some(outcome.direction.to_string());
                status.last_sync_at = Some(at);
                report.exported += u32::from(outcome.exported);
                report.note_imported(binding.kind, outcome.imported);
                /* 非阻断诊断：落点行显示逐字原文，完成通知里带种类前缀。 */
                let label = binding.kind.label();
                status.last_error = outcome.warnings.first().cloned();
                outcome.warnings.iter().for_each(|warn| report.errors.push(format!("「{label}」{warn}")));
                /* [V0.11.11] 真机排查的唯一现场：`adb logcat -s Timing` 能分清「没找到文件」
                「文件没变」「导入 0 条」——三者在界面上都是同一句「已写入文件」。 */
                crate::log_info!("md sync {}: {} exists={} dir={} imported={} exported={}", binding.kind.label(), status.path, outcome.exists, outcome.direction, outcome.imported, outcome.exported);
            }
            Err(err) => {
                crate::log_warn!("md sync {} 失败：{err}", binding.kind.label());
                status.last_error = Some(err.clone());
                report.errors.push(format!("「{}」{err}", binding.kind.label()));
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
