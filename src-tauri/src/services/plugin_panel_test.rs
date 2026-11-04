//! `services::plugin_panel` 的测试（拆出以守住单文件 ≤300 行）。

use super::*;
use crate::tests::support::fresh_pool;

#[test]
fn duration_is_rendered_in_hours_and_minutes() {
    assert_eq!(format_duration(30), "不到 1 分");
    assert_eq!(format_duration(60), "1 分");
    assert_eq!(format_duration(45 * 60), "45 分");
    assert_eq!(format_duration(3600), "1 小时");
    assert_eq!(format_duration(3600 + 20 * 60), "1 小时 20 分");
}

#[test]
fn relative_days_read_naturally() {
    let now = crate::platform::clock::now_ms();
    assert_eq!(format_day(now, now), "今天");
    assert_eq!(format_day(now + 24 * 3600 * 1000, now), "明天");
    assert_eq!(format_day(now - 24 * 3600 * 1000, now), "昨天");
    /* 更远的日期给具体日子，不再说「3 天前」——面板是给人看计划，不是看差异 */
    let far = format_day(now + 10 * 24 * 3600 * 1000, now);
    assert!(far.contains("月") && far.contains("日"), "{far}");
}

#[tokio::test]
async fn an_unknown_source_returns_empty_instead_of_failing() {
    /* 正常路径上不可能出现（清单加载已校验白名单）。走到这里说明有人绕过校验，
    空列表比整窗报错温和：面板其余块还能用。 */
    let pool = fresh_pool("panel-src").await;
    let rows = query(&pool, "records.everything", &QueryParams::default())
        .await
        .unwrap();
    assert!(rows.is_empty());
}

#[tokio::test]
async fn an_unknown_action_reports_instead_of_panicking() {
    let pool = fresh_pool("panel-act").await;
    let outcome = run_action(&pool, "shell.run", &ActionParams::default())
        .await
        .unwrap();
    assert!(outcome.message.contains("未知动作"), "{}", outcome.message);
}

#[tokio::test]
async fn adding_a_todo_actually_writes_one() {
    let pool = fresh_pool("panel-todo").await;
    let params = ActionParams {
        title: Some("面板加的待办".into()),
        ..Default::default()
    };
    let outcome = run_action(&pool, "todo.add", &params).await.unwrap();
    assert!(
        outcome.message.contains("面板加的待办"),
        "{}",
        outcome.message
    );

    let rows = query(
        &pool,
        "todos.pending",
        &QueryParams {
            days: None,
            limit: Some(5),
        },
    )
    .await
    .unwrap();
    assert!(
        rows.iter().any(|row| row.label == "面板加的待办"),
        "{rows:?}"
    );
}

#[tokio::test]
async fn starting_a_timer_creates_the_item_when_missing() {
    let pool = fresh_pool("panel-timer").await;
    let params = ActionParams {
        item: Some("面板新事项".into()),
        ..Default::default()
    };
    let outcome = run_action(&pool, "timer.start", &params).await.unwrap();
    assert!(
        outcome.message.contains("面板新事项"),
        "{}",
        outcome.message
    );

    let state = crate::services::timer::state(&pool).await.unwrap();
    assert_eq!(state.status, "running", "应当已在计时");
}

#[tokio::test]
async fn pending_todos_respect_the_limit() {
    let pool = fresh_pool("panel-limit").await;
    for title in ["一", "二", "三"] {
        let params = ActionParams {
            title: Some(title.into()),
            ..Default::default()
        };
        run_action(&pool, "todo.add", &params).await.unwrap();
    }
    let rows = query(
        &pool,
        "todos.pending",
        &QueryParams {
            days: None,
            limit: Some(2),
        },
    )
    .await
    .unwrap();
    assert_eq!(rows.len(), 2);
}
