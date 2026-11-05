//! 三份落盘痕迹的读写：`migrated-from-tickbar-app.json` / `pending-migrate.json` /
//! `migration-failed.txt`。
//!
//! 为什么是文件而不是 `settings` 表：迁移跑在 `db::init_pool` **之前**，
//! 那一刻还没有数据库可用（ARCHITECTURE §7 N11）。标记文件同时是 QA 的核对依据。
//!
//! 约定（ARCHITECTURE §6.4）：时间一律本地时区 ISO8601 带偏移；只增字段不改含义，
//! `schema` 递增。

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::paths::{Paths, DB_NAME, LEGACY_DB_NAME};
use super::{Failure, Migrated};
use crate::models::migration::RowCounts;

/// 迁移成功标记（写在目标目录里）。
pub const MARKER_FILE: &str = "migrated-from-tickbar-app.json";
/// 待迁移标记（写在目标目录里；用户选了「以空白数据启动」时写）。
pub const PENDING_FILE: &str = "pending-migrate.json";
/// 失败明细（**写在旧目录里**，PRD §4.4 原文要求；旧目录只读时退化为只写日志）。
pub const FAILURE_FILE: &str = "migration-failed.txt";
/// 落盘 schema 版本（字段只增不改；递增表示读侧要跟着变）。
pub const SCHEMA: u32 = 1;

/// 迁移成功标记的形状（落盘契约，QA 依赖）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationMarker {
    pub schema: u32,
    /// 迁移完成时间（本地时区，`2026-11-04T15:20:31+08:00`）
    pub at: String,
    /// 迁移当时的应用版本
    pub app_version: String,
    /// 旧目录绝对路径（仅供展示）
    pub source: String,
    /// 库文件字节数
    pub db_bytes: u64,
    /// 五表行数
    pub row_counts: RowCounts,
    /// 是否把 `-wal` / `-shm` 一起搬过来了
    pub wal_copied: bool,
    /// 校验口径（人能看懂的一句话，例如 `size+integrity+rows`）
    pub verified: String,
}

/// 待迁移标记的形状（D-C）：用户选择「以空白数据启动」时写下，下次启动覆盖式迁移。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingMigrate {
    pub schema: u32,
    /// 选择空白启动的时刻
    pub blank_started_at: String,
    /// 原因（当前恒为 `user chose blank start`）
    pub reason: String,
    /// 待迁移的旧目录
    pub legacy_dir: String,
}

/// 写迁移成功标记。失败只告警不致命——数据已经搬好了，一份说明文件写不进去
/// 不该让用户看到「迁移失败」（见 `mod.rs::run_at` 的说明）。
pub fn write_marker(dir: &Path, migrated: &Migrated) -> Result<(), String> {
    let marker = MigrationMarker {
        schema: SCHEMA,
        at: migrated.at.clone(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        source: migrated.source.display().to_string(),
        db_bytes: migrated.db_bytes,
        row_counts: migrated.row_counts,
        wal_copied: migrated.wal_copied,
        verified: "size+integrity+rows".to_string(),
    };
    let body =
        serde_json::to_string_pretty(&marker).map_err(|err| format!("序列化标记失败：{err}"))?;
    std::fs::write(dir.join(MARKER_FILE), body).map_err(|err| format!("写标记失败：{err}"))
}

/// 读迁移成功标记（不存在 / 坏文件都返回 `None`：它是展示用信息，不该让命令失败）。
pub fn read_marker(dir: &Path) -> Option<MigrationMarker> {
    let raw = std::fs::read_to_string(dir.join(MARKER_FILE)).ok()?;
    serde_json::from_str(&raw).ok()
}

/// 写「待迁移」标记。目录可能还不存在（用户选了空白启动、此刻目标目录是空的）→ 先建。
pub fn write_pending(dir: &Path, paths: &Paths) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|err| format!("建目录失败：{err}"))?;
    let pending = PendingMigrate {
        schema: SCHEMA,
        blank_started_at: chrono::Local::now().to_rfc3339(),
        reason: "user chose blank start".to_string(),
        legacy_dir: paths.source.display().to_string(),
    };
    let body =
        serde_json::to_string_pretty(&pending).map_err(|err| format!("序列化失败：{err}"))?;
    std::fs::write(dir.join(PENDING_FILE), body).map_err(|err| format!("写待迁移标记失败：{err}"))
}

/// 读「待迁移」标记。
pub fn read_pending(dir: &Path) -> Option<PendingMigrate> {
    let raw = std::fs::read_to_string(dir.join(PENDING_FILE)).ok()?;
    serde_json::from_str(&raw).ok()
}

/// 删除「待迁移」标记（覆盖式迁移成功后调用；不存在也不算错）。
pub fn clear_pending(dir: &Path) {
    let _ = std::fs::remove_file(dir.join(PENDING_FILE));
}

/// 追加一段失败明细到**旧目录**（`migration-failed.txt`）。
///
/// 写到老目录是 PRD §4.4 的原文要求（用户排查时只在老目录里找）；老目录可能
/// 只读或不存在 → 写不进去就返回 Err，由调用方降级为「只写日志」。
pub fn write_failure(source: &Path, failure: &Failure, paths: &Paths) -> Result<(), String> {
    let db_bytes = std::fs::metadata(source.join(DB_NAME))
        .or_else(|_| std::fs::metadata(source.join(LEGACY_DB_NAME)))
        .map(|m| m.len())
        .unwrap_or(0);
    let record = format!(
        "[{}] stage={} reason={}\n  source={}\n  temp  ={}\n  detail=dbBytes={} appVersion={}\n\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
        failure.stage.as_str(),
        failure.reason,
        source.display(),
        paths.temp.display(),
        db_bytes,
        env!("CARGO_PKG_VERSION"),
    );
    std::fs::create_dir_all(source).map_err(|err| format!("旧目录不可写：{err}"))?;
    let path = source.join(FAILURE_FILE);
    let mut existing = std::fs::read_to_string(&path).unwrap_or_default();
    existing.push_str(&record);
    std::fs::write(&path, existing).map_err(|err| format!("写失败明细失败：{err}"))
}
