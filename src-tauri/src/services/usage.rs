//! 应用使用统计的服务层（0.13.0）。
//!
//! 两条职责，都只碰 `app_usage` 一张表：
//! 1. `rollup`：把系统给的当天耗时写进库（重复上报取 MAX，不取最后一次 —— 见下）。
//! 2. `read`：读某一天的排行。
//!
//! **为什么重复上报取 MAX 而不是覆盖**：`UsageStatsManager` 给的是「截至查询时刻」的累计。
//! 重扫同一段只会更准（可能补上先前漏掉的切换），不会变小；真变小的情况是系统回收了明细
//! （低于 7 天窗口），那种「变小」是数据丢失，不该覆盖掉已有事实。这条与 md 同步的
//! 「宁可留着，不要悄悄删」是同一条纪律。

use sqlx::SqlitePool;

use crate::error::AppResult;
use crate::models::usage::{UsageAggregate, UsageRowDto};

/// 写一天的聚合。`rows` 为空是合法输入（那天一个应用都没用），此时不写任何行。
///
/// 桌面目标上唯一的调用方（`commands::usage_cmd::usage_stats_get`）在 `#[cfg(mobile)]`
/// 分支里，桌面那条分支直接回 `supported: false`。**不整段 `cfg` 掉**：一旦 `cfg` 掉，
/// 这个函数就永远只在手机包里有，桌面 `cargo test` 编不到它，下一个人重构时编译器
/// 也不提醒他调用点已经断了（`services::overlay_push` 同款口径）。
#[cfg_attr(desktop, allow(dead_code))]
pub async fn rollup(pool: &SqlitePool, date: &str, rows: &[UsageRowDto]) -> AppResult<()> {
    let now = crate::platform::clock::now_ms();
    for row in rows {
        if row.package_name.is_empty() || row.sec <= 0 {
            continue;
        }
        sqlx::query(
            r#"
            INSERT INTO app_usage
                (package_name, local_date, foreground_sec, first_seen_at, last_seen_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(package_name, local_date) DO UPDATE SET
                foreground_sec = MAX(app_usage.foreground_sec, excluded.foreground_sec),
                first_seen_at  = CASE
                    WHEN app_usage.first_seen_at = 0 THEN excluded.first_seen_at
                    WHEN excluded.first_seen_at = 0 THEN app_usage.first_seen_at
                    ELSE MIN(app_usage.first_seen_at, excluded.first_seen_at)
                END,
                last_seen_at   = MAX(app_usage.last_seen_at, excluded.last_seen_at),
                updated_at     = excluded.updated_at
            "#,
        )
        .bind(&row.package_name)
        .bind(date)
        .bind(row.sec)
        .bind(row.first)
        .bind(row.last)
        .bind(now)
        .execute(pool)
        .await?;
    }
    Ok(())
}

/// 读某一天的排行（按时长降序）。
///
/// 与 `rollup` 同一处境：唯一调用点在 `usage_stats_get` 的 `#[cfg(mobile)]` 分支，
/// 桌面不读这张表。**不 `cfg` 掉**，理由同上：桌面 `cargo test` 要能编到它，
/// 纯 SQL 逻辑才不会只在手机包上被验证。
#[cfg_attr(desktop, allow(dead_code))]
pub async fn read(pool: &SqlitePool, date: &str) -> AppResult<Vec<UsageAggregate>> {
    let rows: Vec<(String, i64, i64, i64)> = sqlx::query_as(
        r#"
        SELECT package_name, foreground_sec, first_seen_at, last_seen_at
        FROM app_usage
        WHERE local_date = ?1
        ORDER BY foreground_sec DESC, package_name ASC
        "#,
    )
    .bind(date)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(package_name, sec, first, last)| UsageAggregate {
            package_name,
            sec,
            first,
            last,
        })
        .collect())
}
