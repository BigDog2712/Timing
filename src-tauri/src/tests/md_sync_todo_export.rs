//! 待办区块的正向导出口径
//!
//! 断言落在逐字文本 + id 对位，而不是「文件里出现过某个词」。

use sqlx::SqlitePool;

use crate::infra::md_file;
use crate::models::md_sync::MdSyncKind;
use crate::repositories::todo as todo_repo;
use crate::services;

use super::md_sync::{at, binding, env, file_for, save_binding};

const HEADING: &str = "#### 待办事项";

async fn add(pool: &SqlitePool, title: &str, planned: Option<i64>, done: bool, now: i64) -> i64 {
    let id = todo_repo::insert(pool, title, None, planned, None, 0, now)
        .await
        .unwrap();
    if done {
        todo_repo::set_done(pool, id, Some(now), now).await.unwrap();
    }
    id
}

async fn setup(tag: &str) -> (super::md_sync::Env, i64) {
    let env = env(tag).await;
    let now = at(env.date, 8, 0);
    save_binding(
        &env.pool,
        binding(MdSyncKind::Todos, &env.vault, "{date}.md", HEADING),
    )
    .await;
    (env, now)
}

fn block(env: &super::md_sync::Env) -> String {
    let text = std::fs::read_to_string(file_for(env)).unwrap();
    md_file::body_in_text(&text, HEADING).unwrap()
}

#[tokio::test]
async fn a_block_is_exactly_future_overdue_and_unplanned() {
    let (env, now) = setup("qa-a").await;
    let tomorrow = env.date.succ_opt().unwrap();
    let yesterday = env.date.pred_opt().unwrap();

    let future = add(
        &env.pool,
        "写季度总结",
        Some(at(tomorrow, 9, 0)),
        false,
        now,
    )
    .await;
    let overdue = add(
        &env.pool,
        "整理下载目录",
        Some(at(yesterday, 14, 0)),
        false,
        now,
    )
    .await;
    let unplanned = add(&env.pool, "备选方案", None, false, now).await;
    add(
        &env.pool,
        "今天要做的",
        Some(at(env.date, 12, 0)),
        false,
        now,
    )
    .await;
    add(
        &env.pool,
        "明天但已完成",
        Some(at(tomorrow, 9, 0)),
        true,
        now,
    )
    .await;

    let report = services::md_sync::run(&env.pool, &env.app_data)
        .await
        .unwrap();
    assert!(report.errors.is_empty(), "{:?}", report.errors);

    /* 逐字断言：措辞（逾期 / 计划 / 无后缀）、顺序（计划时间升序、未排期最后）、id 对位。 */
    let expected = [
        format!(
            "- [ ] 整理下载目录 · 逾期 {} 14:00 <!-- tb-todo:{overdue} -->",
            yesterday.format("%Y-%m-%d")
        ),
        format!(
            "- [ ] 写季度总结 · 计划 {} 09:00 <!-- tb-todo:{future} -->",
            tomorrow.format("%Y-%m-%d")
        ),
        format!("- [ ] 备选方案 <!-- tb-todo:{unplanned} -->"),
    ]
    .join("\n");
    assert_eq!(block(&env), expected);

    /* 反向断言：今天的那条与已完成的那条确实不在文件里。 */
    let body = block(&env);
    assert!(!body.contains("今天要做的"), "{body}");
    assert!(!body.contains("明天但已完成"), "{body}");
    let alive: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM todos WHERE deleted_at IS NULL")
        .fetch_one(&env.pool)
        .await
        .unwrap();
    assert_eq!(alive, 5, "导出不该改动任何行");
}

/// 文档口径：「逾期」只是渲染措辞，解析规则与「计划」完全一样。
/// 用同一时刻分别写成两种后缀，解析结果必须一致（否则用户把 `逾期` 改成 `计划`
/// 会得到不同的 `planned_at`，甚至被当成标题的一部分）。
#[test]
fn overdue_and_planned_suffixes_parse_identically() {
    use crate::services::md_sync::format::{parse_planned, parse_todos};

    let today = chrono::NaiveDate::from_ymd_opt(2026, 10, 20).unwrap();
    let overdue = parse_todos("- [ ] 甲 · 逾期 2026-10-18 14:00 <!-- tb-todo:1 -->", today);
    let planned = parse_todos("- [ ] 甲 · 计划 2026-10-18 14:00 <!-- tb-todo:1 -->", today);
    assert_eq!(overdue, planned);
    assert_eq!(
        overdue[0].planned_ms,
        Some(parse_planned("2026-10-18 14:00", today).unwrap())
    );
    assert_eq!(overdue[0].title, "甲");
    assert_eq!(overdue[0].id, Some(1));
}
