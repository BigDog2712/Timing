//! 待办区块：只写「未完成 + 计划时间不在当天」的待办，且**从不删除**。
//!
//! 这一组用例的重点不是渲染好不好看，而是三条会丢数据的边界：
//! 1. 区块是过滤视图，「文件里没有」不能当成删除（跨天时整批待办会全没）；
//! 2. 勾选 `[x]` 要落库、并在下一轮从区块退场；
//! 3. 手改 `· 计划 <时间>` 要能改到库里的 `planned_at`。

use sqlx::SqlitePool;

use crate::infra::md_file;
use crate::models::md_sync::MdSyncKind;
use crate::repositories::todo as todo_repo;
use crate::services;

use super::md_sync::{at, binding, env, file_for, save_binding};

const TODOS_HEADING: &str = "#### 待办事项";

async fn add_todo(
    pool: &SqlitePool,
    title: &str,
    planned: Option<i64>,
    done: bool,
    now: i64,
) -> i64 {
    let id = todo_repo::insert(pool, title, planned, None, 0, now)
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
        binding(MdSyncKind::Todos, &env.vault, "{date}.md", TODOS_HEADING),
    )
    .await;
    (env, now)
}

fn read(env: &super::md_sync::Env) -> String {
    std::fs::read_to_string(file_for(env)).unwrap()
}

#[tokio::test]
async fn only_future_or_overdue_undone_todos_are_listed() {
    let (env, now) = setup("md-todos").await;
    let tomorrow = at(env.date.succ_opt().unwrap(), 9, 0);
    let yesterday = at(env.date.pred_opt().unwrap(), 14, 0);
    let today_noon = at(env.date, 12, 0);

    let future = add_todo(&env.pool, "明天的会", Some(tomorrow), false, now).await;
    add_todo(&env.pool, "昨天没做完", Some(yesterday), false, now).await;
    add_todo(&env.pool, "还没排期", None, false, now).await;
    add_todo(&env.pool, "今天要做的", Some(today_noon), false, now).await;
    add_todo(&env.pool, "已经做完", Some(tomorrow), true, now).await;

    services::md_sync::run(&env.pool).await.unwrap();
    let text = read(&env);

    assert!(text.contains("明天的会"), "{text}");
    assert!(text.contains("昨天没做完"), "逾期的仍要列出：{text}");
    assert!(text.contains("还没排期"), "未排期的仍要列出：{text}");
    assert!(!text.contains("今天要做的"), "今天的属于当天日程：{text}");
    assert!(!text.contains("已经做完"), "已完成的不该出现：{text}");
    assert!(
        text.contains(&format!("<!-- tb-todo:{future} -->")),
        "{text}"
    );
    assert!(text.contains("· 逾期 "), "逾期要用明确的措辞：{text}");
}

#[tokio::test]
async fn checking_a_box_marks_it_done_and_it_leaves_the_block() {
    let (env, now) = setup("md-todos-done").await;
    let id = add_todo(
        &env.pool,
        "交季度报告",
        Some(at(env.date.succ_opt().unwrap(), 9, 0)),
        false,
        now,
    )
    .await;

    services::md_sync::run(&env.pool).await.unwrap();
    let text = read(&env);
    assert!(text.contains("- [ ] 交季度报告"), "{text}");

    /* 只把勾选框改成 [x]，等于在 Obsidian 里点了一下。 */
    let body = md_file::body_in_text(&text, TODOS_HEADING).unwrap();
    let edited = md_file::replace_in_text(&text, TODOS_HEADING, &body.replace("- [ ]", "- [x]"));
    std::fs::write(file_for(&env), edited).unwrap();

    services::md_sync::run(&env.pool).await.unwrap();

    let done_at: Option<i64> = sqlx::query_scalar("SELECT done_at FROM todos WHERE id = ?")
        .bind(id)
        .fetch_one(&env.pool)
        .await
        .unwrap();
    assert!(done_at.is_some(), "勾选要落库成 done_at");
    assert!(
        !read(&env).contains("交季度报告"),
        "完成之后就该从「未来待办」里退场"
    );
}

#[tokio::test]
async fn removing_a_line_never_deletes_the_todo() {
    let (env, now) = setup("md-todos-nodelete").await;
    let tomorrow = at(env.date.succ_opt().unwrap(), 9, 0);
    add_todo(&env.pool, "要保留的", Some(tomorrow), false, now).await;
    add_todo(&env.pool, "被手删掉的", Some(tomorrow), false, now).await;

    services::md_sync::run(&env.pool).await.unwrap();
    assert!(read(&env).contains("被手删掉的"));

    /* 用户在 Obsidian 里删掉那一行。区块是过滤视图，「没有」不等于「删掉」。 */
    let text = read(&env);
    let body = md_file::body_in_text(&text, TODOS_HEADING).unwrap();
    let kept_line = body
        .lines()
        .find(|line| line.contains("要保留的"))
        .expect("要保留的那行应在区块里")
        .to_string();
    let edited = md_file::replace_in_text(&text, TODOS_HEADING, &kept_line);
    std::fs::write(file_for(&env), edited).unwrap();

    services::md_sync::run(&env.pool).await.unwrap();

    let alive: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM todos WHERE deleted_at IS NULL")
        .fetch_one(&env.pool)
        .await
        .unwrap();
    assert_eq!(alive, 2, "删掉一行不能软删待办");
    let deleted: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM todos WHERE deleted_at IS NOT NULL")
            .fetch_one(&env.pool)
            .await
            .unwrap();
    assert_eq!(deleted, 0, "这里从不产生软删");
    /* 下一轮导出会把它写回区块：这正是「视图」与「数据」的区别。 */
    assert!(read(&env).contains("被手删掉的"));
    assert!(read(&env).contains("要保留的"));
}

#[tokio::test]
async fn editing_the_plan_suffix_updates_planned_at() {
    let (env, now) = setup("md-todos-plan").await;
    let tomorrow = at(env.date.succ_opt().unwrap(), 9, 0);
    let id = add_todo(&env.pool, "对齐方案", Some(tomorrow), false, now).await;

    services::md_sync::run(&env.pool).await.unwrap();
    let text = read(&env);
    let body = md_file::body_in_text(&text, TODOS_HEADING).unwrap();
    /* 把「明天 09:00」改成后天 15:30 —— 后缀是计划时间的唯一事实来源。 */
    let old_stamp = format!("{} 09:00", env.date.succ_opt().unwrap().format("%Y-%m-%d"));
    let later = env.date.succ_opt().unwrap().succ_opt().unwrap();
    let new_stamp = format!("{} 15:30", later.format("%Y-%m-%d"));
    let edited =
        md_file::replace_in_text(&text, TODOS_HEADING, &body.replace(&old_stamp, &new_stamp));
    std::fs::write(file_for(&env), edited).unwrap();

    services::md_sync::run(&env.pool).await.unwrap();

    let planned: Option<i64> = sqlx::query_scalar("SELECT planned_at FROM todos WHERE id = ?")
        .bind(id)
        .fetch_one(&env.pool)
        .await
        .unwrap();
    assert_eq!(planned, Some(at(later, 15, 30)));
}

#[tokio::test]
async fn a_line_without_id_creates_a_todo() {
    let (env, now) = setup("md-todos-create").await;
    add_todo(
        &env.pool,
        "锚点",
        Some(at(env.date.succ_opt().unwrap(), 9, 0)),
        false,
        now,
    )
    .await;

    services::md_sync::run(&env.pool).await.unwrap();
    let text = read(&env);
    let body = md_file::body_in_text(&text, TODOS_HEADING).unwrap();
    let target = env.date.succ_opt().unwrap().succ_opt().unwrap();
    let added = format!(
        "{body}\n- [ ] 手写的新待办 · 计划 {} 10:00",
        target.format("%Y-%m-%d")
    );
    let edited = md_file::replace_in_text(&text, TODOS_HEADING, &added);
    std::fs::write(file_for(&env), edited).unwrap();

    services::md_sync::run(&env.pool).await.unwrap();

    /* 用 `fetch_one` 而不是 `fetch_optional`：SQLite 上 `query_scalar::<Option<i64>>`
    配 `fetch_optional` 会把 NULL 解成 `Some(0)`，`assert_eq!(x, None)` 会假通过。 */
    let planned: Option<i64> =
        sqlx::query_scalar("SELECT planned_at FROM todos WHERE title = '手写的新待办'")
            .fetch_one(&env.pool)
            .await
            .unwrap();
    assert_eq!(planned, Some(at(target, 10, 0)));
}
