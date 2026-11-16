//! `md_decision_audit` 表的写入（架构 §1.4 / §3 `MdDecisionAudit`）。
//!
//! ## 只 append，不读回来改行为
//!
//! team-lead 决策 #3 / 架构 §7：审计供后查（谁在什么时候对哪个区块选了什么），
//! **绝不**读回来影响后续默认行为。所以本模块**只有** `INSERT`，没有
//! 「读最近一次决定 → 改默认」的入口；排查要读历史时直接对这张表写 SQL。
//!
//! `direction` 是 TEXT（迁移 0012 刻意不加 CHECK）：本任务用
//! `overwrite_timing` / `keep_timing` / `deferred`，未来坑 1 若落地合成事件，
//! 在词汇表里另立 `overwrite_timing_synth` 即可，不改 schema。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::models::md_sync::MdSyncKind;

/// 写一条决策审计。`direction` 传 `Decision::as_str()` 的词汇。
pub async fn record(
    pool: &SqlitePool,
    kind: MdSyncKind,
    heading: &str,
    direction: &str,
    at_ms: i64,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO md_decision_audit (at_ms, kind, heading, direction) VALUES (?, ?, ?, ?)",
    )
    .bind(at_ms)
    .bind(kind.as_str())
    .bind(heading)
    .bind(direction)
    .execute(pool)
    .await
    .map_err(AppError::db)?;
    Ok(())
}
