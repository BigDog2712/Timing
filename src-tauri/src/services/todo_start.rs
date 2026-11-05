//! 待办 → 计时（ADR-030）：把一条待办**变成**一次计时，并立刻从待办区撤走。
//!
//! 用户口径（V0.3.12）：「待办事项开始计时后自动挪至计时区，不再在待办区」。
//! 所以软删除发生在**开始**这一刻，而不是保存记录之后（`timer::stop` 里的同名清理
//! 仍然保留：那管的是「手动起了同名事项」的历史路径）。
//!
//! 事项映射沿用既有约定：**按标题匹配**（`items.name = todos.title`），没有就新建一条
//! —— 与 `soft_delete_for_saved_record` 的匹配口径一致，避免出现「同名两个事项」。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::models::record::TimeRecord;
use crate::platform::clock::now_ms;
use crate::repositories::item as item_repo;
use crate::repositories::record_session as session;
use crate::repositories::todo as todo_repo;
use crate::repositories::todo_nudge as nudge_repo;
use crate::services::{item, timer};

/// 开始待办对应的计时：校验 → 取绑定事项 → `timer::start` → 软删待办。
///
/// 已在计时中 → `TIMER_ALREADY_RUNNING`（调用方据此提示，不改动任何数据）；
/// 待办不存在（或已完成 / 已删）→ `TODO_NOT_FOUND`。
///
/// ## 事项归属：绑定优先，标题兜底（V0.11.3）
///
/// 以前一律按标题匹配，问题是**改个标题就裂成两个事项**：待办「写周报」已经计过三小时，
/// 用户把它改成「写周报（二稿）」，再开始就新建一个同名事项，统计里成了两件事。
/// 现在 `todos.item_id` 非空就认它；空着才按标题匹配/新建，**并回填**——
/// 这条待办从此固定绑定，改名不再影响归属（老数据也因此不需要一次性回填）。
pub async fn start(pool: &SqlitePool, todo_id: i64) -> AppResult<TimeRecord> {
    let todo = todo_repo::find_by_id(pool, todo_id)
        .await?
        .ok_or_else(AppError::todo_not_found)?;
    if todo.done_at.is_some() {
        return Err(AppError::todo_not_found());
    }
    if session::find_active(pool).await?.is_some() {
        return Err(AppError::timer_already_running());
    }
    let item_id = match todo.item_id {
        /* 绑过的事项可能已被删：删了就回落到标题匹配，不要让「开始」直接失败。 */
        Some(bound) if item_repo::find_by_id(pool, bound).await?.is_some() => bound,
        _ => {
            let resolved = match item_repo::find_by_name(pool, &todo.title).await? {
                Some(found) => found.id,
                None => item::create(pool, &todo.title, None).await?.id,
            };
            todo_repo::update(
                pool,
                todo.id,
                None,
                Some(Some(resolved)),
                None,
                None,
                None,
                None,
                now_ms(),
            )
            .await?;
            resolved
        }
    };
    let record = timer::start(pool, Some(item_id)).await?;
    // 开始即移出待办区（用户口径：不再在待办区）
    todo_repo::soft_delete(pool, todo.id, now_ms()).await?;
    Ok(record)
}

/// 「当前事项结束后自动开始」：会话结束（`services::timer_stop::stop`）后立刻顶上最早一条。
///
/// 不受 `remind_at` 的宽限窗口限制 —— 这是用户**显式答应**过的动作，长会话跑完也该开始。
/// 失败只记日志：自动开始失败绝不能把「结束计时」本身变成失败。
pub async fn after_stop(pool: &SqlitePool) {
    let pending = match nudge_repo::autostart_pending(pool).await {
        Ok(value) => value,
        Err(err) => {
            crate::log_warn!("read auto-start todo failed: {err}");
            return;
        }
    };
    let Some(todo) = pending else {
        return;
    };
    if let Err(err) = start(pool, todo.id).await {
        crate::log_warn!("auto start todo after stop failed: {err}");
    }
}
