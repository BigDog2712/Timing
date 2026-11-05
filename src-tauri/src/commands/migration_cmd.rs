//! 迁移可见性命令（V0.5.0 / ADR-037）：`get_migration_info` / `open_legacy_dir`。
//!
//! ## 为什么必须新增两条命令，而不是复用现有 65 条
//!
//! 逐条查过（ADR-037 记录全部依据）：
//! - `plugin_list` / `plugin_open_dir` 绑死 `<app_data>/plugins`，语义是「插件」；
//! - `md_sync_*` 绑死用户在设置里配的外部落点；
//! - 诊断快照 `logs/diagnostics.txt` **只有写没有读**，而且根本不是 IPC 命令；
//! - `settings` 是业务配置的 KV 表，把「数据从哪来」塞进去属于一次**门禁看不见的
//!   契约变更**（`check:contract` 只比对命令名，不会提醒 DTO 多了字段）。
//!
//! 因此新增 2 条只读/打开目录命令（命令 65 → 67），**不新增错误码**：
//! 失败一律 `IO_ERROR`（PRD 铁律：错误码只在 `error.rs` 定义且数量不变）。

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::infra::appdata_migrate::{self as mig, MigrationOutcome};
use crate::infra::db;
use crate::models::migration::{MigrationInfo, MigrationSource};

/// 查询「当前数据从哪来」。纯查询：幂等、无副作用、不写任何文件。
#[tauri::command]
pub async fn get_migration_info(app: AppHandle) -> AppResult<MigrationInfo> {
    let app_data_dir = app.path().app_data_dir().map_err(AppError::io)?;
    let marker = mig::read_marker(&app_data_dir);
    let pending = mig::read_pending(&app_data_dir);
    let legacy_dir = mig::legacy_dir_of(&app_data_dir);
    let legacy_exists = legacy_dir.as_ref().is_some_and(|dir| dir.is_dir());
    let legacy_has_data = legacy_dir
        .as_ref()
        .is_some_and(|dir| mig::has_legacy_data(dir));
    let target_has_db = db::resolve_db_path(&app_data_dir).exists();
    let skipped = matches!(mig::outcome(), Some(MigrationOutcome::Skipped));

    let source = resolve_source(
        marker.is_some(),
        pending.is_some(),
        legacy_has_data,
        target_has_db,
        skipped,
    );

    Ok(MigrationInfo {
        source,
        migrated_at: marker.as_ref().map(|m| m.at.clone()),
        app_version_at_migration: marker.as_ref().map(|m| m.app_version.clone()),
        legacy_dir: legacy_dir.map(|dir| dir.display().to_string()),
        legacy_exists,
        db_bytes: marker.as_ref().map(|m| m.db_bytes),
        row_counts: marker.as_ref().map(|m| m.row_counts),
    })
}

/// 在资源管理器里打开旧数据目录。
///
/// **路径一律重算，绝不使用 `MigrationInfo.legacyDir` 的回传值**（安全，见
/// ARCHITECTURE §7 N13）：标记文件是用户目录下的明文 JSON，谁改了它就能让应用
/// `explorer` 打开任意目录。这里用「权威 `app_data_dir` 的父目录 + 固定旧 identifier」
/// 现算，前端即使传路径也无处可用（本命令不接受参数）。
///
/// 目录不存在时返回 `IO_ERROR`，**不创建目录**（与 `plugin_open_dir` 的「先建后用」
/// 有意不同：那是宿主拥有的目录，这是用户的旧数据，替用户造一个空目录只会误导）。
#[tauri::command]
pub async fn open_legacy_dir(app: AppHandle) -> AppResult<()> {
    let app_data_dir = app.path().app_data_dir().map_err(AppError::io)?;
    let legacy = mig::legacy_dir_of(&app_data_dir)
        .ok_or_else(|| AppError::io("无法推断旧数据目录（app_data_dir 没有父目录）"))?;
    if !legacy.is_dir() {
        return Err(AppError::io(format!(
            "旧数据目录不存在：{}",
            legacy.display()
        )));
    }
    crate::infra::shell_open::open_dir(&legacy).map_err(AppError::io)
}

/// `source` 判定（纯函数，顺序即优先级；与 ARCHITECTURE §3.3 的表逐行对应）。
///
/// | 条件（按序优先） | 结果 |
/// | --- | --- |
/// | 有迁移标记 | `legacy` |
/// | 有待迁移标记且旧目录仍有数据 | `pending` |
/// | 本次进程跳过了迁移 | `skipped` |
/// | 目标无库且旧目录无数据 | `fresh` |
/// | 目标有库且旧目录有数据（无标记） | `unattached` |
pub fn resolve_source(
    has_marker: bool,
    has_pending: bool,
    legacy_has_data: bool,
    target_has_db: bool,
    skipped: bool,
) -> MigrationSource {
    if has_marker {
        return MigrationSource::Legacy;
    }
    if has_pending && legacy_has_data {
        return MigrationSource::Pending;
    }
    if skipped {
        return MigrationSource::Skipped;
    }
    if !target_has_db && !legacy_has_data {
        return MigrationSource::Fresh;
    }
    if target_has_db && legacy_has_data {
        return MigrationSource::Unattached;
    }
    MigrationSource::Fresh
}
