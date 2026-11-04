//! 待办区块的导入：把「文件差异」落成 `todos` 的增改。
//!
//! 从 `import.rs` 拆出（单文件 ≤300 行纪律）。与计时 / 便利贴最大的不同写在这里。
//!
//! ## 这里**不删任何东西**
//!
//! 待办区块是**过滤后的视图**：排除了今天要执行的、排除了已完成的。所以「文件里
//! 少了某一行」有太多可能——它可能只是计划时间落进了今天、可能刚被勾完、也可能是
//! 用户换了一天打开新文件。按「缺失即删除」处理，会在跨天的那一秒把整批待办删光。
//!
//! 因此只做三件事：
//! - `- [x]` → 回写 `done_at`（下一轮导出它自然消失，因为完成的不再列出）；
//! - 标题 / `· 计划 <时间>` 变了 → 回写 `title` / `planned_at`；
//! - 没有 id 的新行 → 新建待办。
//!
//! 删待办请回 Timing 的待办窗口——那里是明确的删除动作，这里不是。

use chrono::NaiveDate;
use sqlx::SqlitePool;

use crate::error::AppResult;
use crate::models::constants::TODO_TITLE_MAX_LEN;
use crate::platform::clock::now_ms;
use crate::repositories::md_sync_todo as repo;
use crate::repositories::todo as todo_repo;

use super::super::format;
use super::{truncate_chars, ImportStats};

/// 应用待办区块的编辑。
pub async fn apply_todos(
    pool: &SqlitePool,
    date: NaiveDate,
    old_body: &str,
    new_body: &str,
) -> AppResult<ImportStats> {
    let old = format::parse_todos(old_body, date);
    let new = format::parse_todos(new_body, date);
    /* 编辑只改了措辞（计划/逾期）、顺序或缩进时，解析结果相同 → 什么都不用写。 */
    if old == new {
        return Ok(ImportStats::default());
    }

    let now = now_ms();
    let mut stats = ImportStats::default();

    for row in &new {
        let title = truncate_chars(row.title.trim(), TODO_TITLE_MAX_LEN);
        /* 空标题不能建（`todos.title` 有 CHECK length>0），也不能把已有待办改成空。 */
        if title.is_empty() {
            continue;
        }

        let existing = match row.id {
            Some(id) => todo_repo::find_by_id(pool, id).await?,
            None => None,
        };

        match existing {
            Some(todo) => {
                /* 勾选即「完成于此刻」；取消勾选清空完成时刻。已经完成的保留原完成时间，
                不做无意义的刷新（同一文件被重复导入时保持幂等）。 */
                let done_at = if row.done {
                    todo.done_at.or(Some(now))
                } else {
                    None
                };
                if todo.title != title
                    || todo.planned_at != row.planned_ms
                    || todo.done_at != done_at
                {
                    repo::update_todo_from_sync(
                        pool,
                        todo.id,
                        &title,
                        row.planned_ms,
                        done_at,
                        now,
                    )
                    .await?;
                    stats.updated += 1;
                }
            }
            None => {
                repo::insert_todo_from_sync(
                    pool,
                    &title,
                    row.planned_ms,
                    row.done.then_some(now),
                    now,
                )
                .await?;
                stats.created += 1;
            }
        }
    }

    Ok(stats)
}
