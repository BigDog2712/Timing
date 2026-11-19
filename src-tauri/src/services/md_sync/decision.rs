//! md 覆盖提醒的裁决状态机（架构 §1.4 / §4.2 / §5.2 T03）。
//!
//! ## 状态机
//!
//! `sync_binding` 检测到 `file_changed`（`baseline != body`，只看正文 trim，架构 §7）后，
//! 不再静默 import，而是按 [`ConflictMode`] 分派：
//!
//! - [`ConflictMode::AutoMerge`]：云端落点（内部副本）→ 保持「Markdown 赢」现状
//!   （不进本模块，`sync_binding` 直接 import）；
//! - [`ConflictMode::Awaiting`]：前台（能弹窗）→ [`ConflictState::AwaitingDecision`]，
//!   等用户选 A/B/C；
//! - [`ConflictMode::Pending`]：后台（不能弹窗）→ [`ConflictState::PendingDecision`]，
//!   挂起，不静默改写任一端。
//!
//! A「覆盖 Timing」→ `import_and_render`（md → SQL）；B「保留 Timing」→ 重渲染
//! （SQL → md）；C「暂不处理」→ 回 `PendingDecision`。每次选择都 append 到
//! `md_decision_audit`（架构 §7：只 append，不读回来改后续默认行为）。
//!
//! 注册表（挂起现场）在 [`registry`]：进程内、不落库。

pub mod registry;

#[cfg(test)]
mod tests;

use sqlx::SqlitePool;

use super::audit;
use super::binding::{import_and_render, render_expected};
use crate::error::{AppError, AppResult};
use crate::infra::md_file;
use crate::models::md_sync::{Decision, MdSyncKind};
use crate::platform::clock::now_ms;

pub use registry::{awaiting, pending, promote_all, register};

/// 冲突的裁决状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictState {
    /// 前台：已弹窗 / 可弹窗，等用户选 A/B/C。
    AwaitingDecision,
    /// 后台：挂起，不静默改写任一端。
    PendingDecision,
}

/// 冲突处理模式：`sync_binding` 的 `file_changed` 分支按它分派。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictMode {
    /// 云端落点（内部副本）：file_changed → 自动「Markdown 赢」（现状不变）。
    AutoMerge,
    /// 前台（能弹窗）：file_changed → `AwaitingDecision`。
    Awaiting,
    /// 后台（不能弹窗）：file_changed → `PendingDecision`。
    Pending,
}

impl ConflictMode {
    /// 纯判定：模式 → 冲突状态；`AutoMerge` 无裁决（`None`）。
    pub const fn state(self) -> Option<ConflictState> {
        match self {
            Self::AutoMerge => None,
            Self::Awaiting => Some(ConflictState::AwaitingDecision),
            Self::Pending => Some(ConflictState::PendingDecision),
        }
    }
}

/// 一个裁决后的动作。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// A：md → SQL（`import_and_render`）。
    Import,
    /// B：SQL → md（重渲染覆盖）。
    Export,
    /// C：暂不处理（回 `PendingDecision`）。
    Defer,
}

/// 纯判定：`Decision` → `Action`。
pub const fn action_for(decision: Decision) -> Action {
    match decision {
        Decision::OverwriteTiming => Action::Import,
        Decision::KeepTiming => Action::Export,
        Decision::Deferred => Action::Defer,
    }
}

/// 待裁决冲突（前端弹窗的一行 / 设置页「有 N 处待确认」的一行）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingConflict {
    /// 稳定 id：`binding.key()`（kind|root|file|heading），进程内唯一。
    pub id: String,
    pub kind: MdSyncKind,
    pub heading: String,
    /// 解析后的文件路径（展示用）。
    pub path: String,
    /// 本地日 `YYYY-MM-DD`。
    pub date: String,
    pub state: ConflictState,
}

/// 裁决结果（前端弹窗收尾后用的回执）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveOutcome {
    pub imported: u32,
    pub exported: bool,
    pub direction: &'static str,
}

/// 执行裁决：记审计 → A/B 写文件 + 更新基线 → 移除；C 只回挂起。
pub async fn resolve(pool: &SqlitePool, id: &str, decision: Decision) -> AppResult<ResolveOutcome> {
    let Some(entry) = registry::snapshot(id) else {
        return Err(AppError::md_sync_config_invalid("该冲突已处理或不再存在"));
    };

    /* 先落审计再动手：万一后面写文件失败，事后也能查到用户选过什么。
    审计失败则整条裁决中止——不留「改了文件但没记录」的状态。 */
    audit::record(
        pool,
        entry.binding.kind,
        &entry.binding.heading,
        decision.as_str(),
        now_ms(),
    )
    .await?;

    match action_for(decision) {
        Action::Defer => {
            registry::set_state(id, ConflictState::PendingDecision);
            Ok(ResolveOutcome {
                imported: 0,
                exported: false,
                direction: "pending",
            })
        }
        Action::Import => {
            let (body, count) = import_and_render(
                pool,
                &entry.binding,
                entry.date,
                &entry.old_body,
                &entry.new_body,
            )
            .await
            .map_err(AppError::io)?;
            write_resolved(&entry, &body).await?;
            Ok(ResolveOutcome {
                imported: count,
                exported: true,
                direction: "import",
            })
        }
        Action::Export => {
            let rendered = render_expected(pool, &entry.binding, entry.date)
                .await
                .map_err(|err| AppError::io(err.to_string()))?;
            write_resolved(&entry, &rendered.body).await?;
            Ok(ResolveOutcome {
                imported: 0,
                exported: true,
                direction: "export",
            })
        }
    }
}

/// A/B 共用收尾：写文件、更新基线、移除注册表条目。
///
/// 基线必须**当场**更新：留着旧基线，下一轮还会判出同一个 `file_changed`，
/// 用户刚裁完的冲突会立刻再弹一次。
async fn write_resolved(entry: &registry::Entry, body: &str) -> AppResult<()> {
    let path = md_file::resolve_path(&entry.binding.root, &entry.binding.file, entry.date);
    md_file::write_section(&path, &entry.binding.heading, body).map_err(AppError::io)?;
    {
        let mut rt = super::runtime::lock().await;
        rt.set_baseline(
            entry.binding.kind,
            &path,
            &entry.binding.heading,
            body.to_string(),
        );
    }
    registry::remove(&entry.binding.key());
    Ok(())
}
