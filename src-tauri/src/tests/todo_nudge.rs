//! 待办提醒链路（V0.3.12 / ADR-030）：两级提醒的时刻口径、阶段单调、过期不补弹、自动开始候选。
//!
//! 断言来源：用户口径（开始前 15 分钟轻提醒 / 5 分钟自动开始询问；关机一夜后不补弹）与
//! `models/constants.rs` 的三个窗口常量。以行为为准，不绑定 SQL 细节。

use crate::services::todo;
use crate::services::todo_nudge::{self, STAGE_AUTOSTART, STAGE_LIGHT};
use crate::tests::support::{exec, fresh_pool, scalar_i64, scalar_opt_str};

const MIN: i64 = 60_000;

async fn stage_of(pool: &sqlx::SqlitePool, id: i64) -> i64 {
    scalar_i64(
        pool,
        &format!("SELECT remind_stage FROM todos WHERE id = {id}"),
    )
    .await
}

/// 迁移把两个新列补上，版本推到 4。
#[tokio::test]
async fn migration_adds_nudge_columns() {
    let pool = fresh_pool("nudge-cols").await;
    assert_eq!(
        scalar_i64(
            &pool,
            "SELECT COUNT(*) FROM pragma_table_info('todos') WHERE name IN ('remind_stage','auto_start')"
        )
        .await,
        2
    );
    assert_eq!(
        scalar_opt_str(
            &pool,
            "SELECT value FROM settings WHERE key = 'schema.version'"
        )
        .await
        .as_deref(),
        Some("6")
    );
}

/// 开始前 15 分钟整命中轻提醒；置位后不再重复弹；5 分钟档此时还没到。
#[tokio::test]
async fn light_nudge_fires_at_fifteen_minutes() {
    let pool = fresh_pool("nudge-light").await;
    let now = 1_700_000_000_000;
    let t = todo::create(&pool, "写周报", None, None, Some(now + 15 * MIN))
        .await
        .unwrap();

    let due = todo_nudge::due(&pool, STAGE_LIGHT, now).await.unwrap();
    assert_eq!(due.len(), 1, "T-15 应弹轻提醒");
    assert_eq!(due[0].todo_id, t.id);
    assert_eq!(due[0].stage, STAGE_LIGHT);
    assert_eq!(due[0].remind_at, now + 15 * MIN);

    todo_nudge::mark(&pool, &due, now).await.unwrap();
    assert_eq!(stage_of(&pool, t.id).await, 1, "阶段推进到 1");
    assert!(
        todo_nudge::due(&pool, STAGE_LIGHT, now)
            .await
            .unwrap()
            .is_empty(),
        "同一级不重复弹"
    );
    assert!(
        todo_nudge::due(&pool, STAGE_AUTOSTART, now)
            .await
            .unwrap()
            .is_empty(),
        "T-5 还没到，不该弹第二级"
    );
}

/// 到 T-5 才弹第二级；已经弹过第一级的行照样会命中。
#[tokio::test]
async fn start_nudge_fires_at_five_minutes() {
    let pool = fresh_pool("nudge-start").await;
    let now = 1_700_000_000_000;
    let start = now + 3 * MIN;
    let t = todo::create(&pool, "写周报", None, None, Some(start))
        .await
        .unwrap();
    exec(
        &pool,
        &format!("UPDATE todos SET remind_stage = 1 WHERE id = {}", t.id),
    )
    .await;

    let due = todo_nudge::due(&pool, STAGE_AUTOSTART, now).await.unwrap();
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].stage, STAGE_AUTOSTART);

    todo_nudge::mark(&pool, &due, now).await.unwrap();
    assert_eq!(stage_of(&pool, t.id).await, 2);
    assert!(
        todo_nudge::due(&pool, STAGE_AUTOSTART, now)
            .await
            .unwrap()
            .is_empty(),
        "阶段只升不降、且不重复弹"
    );
}

/// 关机一夜后：超过宽限窗口的待办直接标成已处理，不补弹、不自动开始。
#[tokio::test]
async fn stale_todo_expires_without_nudging() {
    let pool = fresh_pool("nudge-stale").await;
    let now = 1_700_000_000_000;
    let t = todo::create(&pool, "昨天的待办", None, None, Some(now - 2 * 60 * MIN))
        .await
        .unwrap();

    todo_nudge::expire(&pool, now).await.unwrap();
    assert_eq!(stage_of(&pool, t.id).await, 2, "过期直接记成已处理");
    assert!(todo_nudge::due(&pool, STAGE_LIGHT, now)
        .await
        .unwrap()
        .is_empty());
    assert!(todo_nudge::due(&pool, STAGE_AUTOSTART, now)
        .await
        .unwrap()
        .is_empty());
    assert!(
        todo_nudge::autostart_due(&pool, now)
            .await
            .unwrap()
            .is_empty(),
        "过期的不该在启动瞬间起计时"
    );
}

/// 到点自动开始的候选：刚到点（宽限内）的待办；未到点的不算。
#[tokio::test]
async fn autostart_due_only_for_fresh_arrivals() {
    let pool = fresh_pool("nudge-auto").await;
    let now = 1_700_000_000_000;
    let fresh = todo::create(&pool, "刚到点", None, None, Some(now - MIN))
        .await
        .unwrap();
    exec(
        &pool,
        &format!("UPDATE todos SET remind_stage = 2 WHERE id = {}", fresh.id),
    )
    .await;
    let future = todo::create(&pool, "还没到", None, None, Some(now + 10 * MIN))
        .await
        .unwrap();
    exec(
        &pool,
        &format!("UPDATE todos SET remind_stage = 2 WHERE id = {}", future.id),
    )
    .await;

    let due = todo_nudge::autostart_due(&pool, now).await.unwrap();
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].todo_id, fresh.id);
}

/// 用户应允过「结束后自动开始」的待办：即使早已过点也不受宽限窗口限制。
#[tokio::test]
async fn consented_autostart_ignores_grace_window() {
    let pool = fresh_pool("nudge-consent").await;
    let now = 1_700_000_000_000;
    let t = todo::create(&pool, "长会之后开始", None, None, Some(now - 60 * MIN))
        .await
        .unwrap();
    exec(
        &pool,
        &format!(
            "UPDATE todos SET remind_stage = 2, auto_start = 1 WHERE id = {}",
            t.id
        ),
    )
    .await;

    let due = todo_nudge::autostart_due(&pool, now).await.unwrap();
    assert_eq!(due.len(), 1, "显式应允不受宽限窗口限制");
    assert_eq!(due[0].todo_id, t.id);
}

/// 改开始时间 → 阶段归零、`reminded_at` 清空（两级提醒按新时刻重来）。
#[tokio::test]
async fn changing_start_time_resets_stage() {
    let pool = fresh_pool("nudge-reset").await;
    let now = 1_700_000_000_000;
    let t = todo::create(&pool, "写周报", None, None, Some(now + 15 * MIN))
        .await
        .unwrap();
    let due = todo_nudge::due(&pool, STAGE_LIGHT, now).await.unwrap();
    todo_nudge::mark(&pool, &due, now).await.unwrap();
    assert_eq!(stage_of(&pool, t.id).await, 1);

    let patch = crate::models::todo::TodoPatch {
        remind_at: Some(Some(now + 90 * MIN)),
        ..Default::default()
    };
    todo::update(&pool, t.id, patch).await.unwrap();
    assert_eq!(stage_of(&pool, t.id).await, 0, "改时间后阶段归零");
    assert!(
        todo_nudge::due(&pool, STAGE_LIGHT, now)
            .await
            .unwrap()
            .is_empty(),
        "新时刻还早，不该立刻弹"
    );
}
