//! 勾选回写与「删行不删数据」
//!
//! C 是本轮的**最高优先级**：待办区块是过滤视图，用户从文件里删掉一行有太多种解释，
//! 同步器一次误判就会把整批待办软删。这里不仅断言「数据还在」，还要证明
//! **导入路径真的被执行了**（否则「没删」可能只是因为它压根没跑）。

use chrono::Datelike;
use sqlx::SqlitePool;

use crate::infra::md_file;
use crate::models::md_sync::MdSyncKind;
use crate::repositories::todo as todo_repo;
use crate::services;
use crate::services::md_sync::export;

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

fn text(env: &super::md_sync::Env) -> String {
    std::fs::read_to_string(file_for(env)).unwrap()
}

fn block(env: &super::md_sync::Env) -> String {
    md_file::body_in_text(&text(env), HEADING).unwrap()
}

/// 用 `body` 覆写区块，等价于用户在 Obsidian 里编辑。
fn edit(env: &super::md_sync::Env, body: &str) {
    let edited = md_file::replace_in_text(&text(env), HEADING, body);
    std::fs::write(file_for(env), edited).unwrap();
}

fn stamp(date: chrono::NaiveDate, hhmm: &str) -> String {
    format!("{} {hhmm}", date.format("%Y-%m-%d"))
}

async fn alive(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM todos WHERE deleted_at IS NULL")
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn deleted(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM todos WHERE deleted_at IS NOT NULL")
        .fetch_one(pool)
        .await
        .unwrap()
}

/* ------------------------------ B 勾选回写 ------------------------------- */

#[tokio::test]
async fn b_checking_the_box_writes_done_at_and_the_line_leaves() {
    let (env, now) = setup("qa-b").await;
    let tomorrow = env.date.succ_opt().unwrap();
    let id = add(
        &env.pool,
        "交季度报告",
        Some(at(tomorrow, 9, 0)),
        false,
        now,
    )
    .await;

    services::md_sync::run(&env.pool, &env.app_data)
        .await
        .unwrap();
    assert!(block(&env).contains("- [ ] 交季度报告"));

    /* 只动勾选框：等价于在 Obsidian 里点了一下。 */
    edit(&env, &block(&env).replace("- [ ]", "- [x]"));
    let report = services::md_sync::run(&env.pool, &env.app_data)
        .await
        .unwrap();
    assert_eq!(report.imported, 1, "勾选必须走导入路径：{report:?}");
    assert_eq!(report.kinds, vec![MdSyncKind::Todos]);

    let done_at: Option<i64> = sqlx::query_scalar("SELECT done_at FROM todos WHERE id = ?")
        .bind(id)
        .fetch_one(&env.pool)
        .await
        .unwrap();
    assert!(done_at.is_some(), "done_at 应有值");

    /* 第二轮：完成的待办从区块退场，且不再产生导入 / 写盘（幂等）。 */
    let again = services::md_sync::run(&env.pool, &env.app_data)
        .await
        .unwrap();
    assert_eq!(again.imported, 0);
    assert_eq!(again.exported, 0, "退场已写进文件，不该再写一轮");
    assert!(!block(&env).contains("交季度报告"));
}

/* --------------------------- C1 纯删一行 --------------------------- */

/// 纯删一行：数据必须留下、下一轮行要长回来。
/// 单看这条**不能**排除「`file == expected` 早退」——真正排除它的是 `c2`。
#[tokio::test]
async fn c1_deleting_a_line_never_soft_deletes_and_the_line_comes_back() {
    let (env, now) = setup("qa-c1").await;
    let tomorrow = env.date.succ_opt().unwrap();
    add(&env.pool, "要保留的", Some(at(tomorrow, 9, 0)), false, now).await;
    add(
        &env.pool,
        "被手删掉的",
        Some(at(tomorrow, 10, 0)),
        false,
        now,
    )
    .await;

    services::md_sync::run(&env.pool, &env.app_data)
        .await
        .unwrap();
    let body = block(&env);
    let kept = body
        .lines()
        .find(|line| line.contains("要保留的"))
        .expect("应在区块里")
        .to_string();
    edit(&env, &kept);

    let report = services::md_sync::run(&env.pool, &env.app_data)
        .await
        .unwrap();
    assert!(report.errors.is_empty(), "{:?}", report.errors);
    assert_eq!(alive(&env.pool).await, 2, "删一行不能软删待办");
    assert_eq!(deleted(&env.pool).await, 0, "待办区块从不产生软删");

    services::md_sync::run(&env.pool, &env.app_data)
        .await
        .unwrap();
    assert!(block(&env).contains("被手删掉的"), "下一轮应写回来");
}

/* ---------------------- C2 删一行 + 同轮改另一行 ---------------------- */

/// 同一次编辑里「删掉一行」+「改另一行的计划时间」：
/// - `imported == 1` 证明 `import::apply_todos` 真的执行了；
/// - 同一轮里被删的那行没有丢，下一轮回到文件；
/// - 上一轮写回的计划时间不会被「重新渲染」打回旧值。
#[tokio::test]
async fn c2_import_really_runs_and_still_deletes_nothing() {
    let (env, now) = setup("qa-c2").await;
    let tomorrow = env.date.succ_opt().unwrap();
    let kept = add(&env.pool, "要保留的", Some(at(tomorrow, 9, 0)), false, now).await;
    add(
        &env.pool,
        "被手删掉的",
        Some(at(tomorrow, 10, 0)),
        false,
        now,
    )
    .await;

    services::md_sync::run(&env.pool, &env.app_data)
        .await
        .unwrap();

    let later = tomorrow.succ_opt().unwrap();
    let edited = block(&env)
        .lines()
        .filter(|line| !line.contains("被手删掉的"))
        .collect::<Vec<_>>()
        .join("\n")
        .replace(&stamp(tomorrow, "09:00"), &stamp(later, "11:00"));
    edit(&env, &edited);

    /* 先证明此刻「文件 ≠ 期望」：`body == expected` 的早退分支不可能命中。 */
    let expected = export::todos(&env.pool, env.date).await.unwrap();
    assert_ne!(
        block(&env).trim(),
        expected.body.trim(),
        "文件与期望一致时无法证明导入被执行"
    );

    let report = services::md_sync::run(&env.pool, &env.app_data)
        .await
        .unwrap();
    assert_eq!(report.imported, 1, "导入必须真的执行：{report:?}");

    let planned: Option<i64> = sqlx::query_scalar("SELECT planned_at FROM todos WHERE id = ?")
        .bind(kept)
        .fetch_one(&env.pool)
        .await
        .unwrap();
    assert_eq!(planned, Some(at(later, 11, 0)), "计划时间应回写");

    assert_eq!(alive(&env.pool).await, 2, "同一次导入也不能少一行");
    assert_eq!(deleted(&env.pool).await, 0);

    services::md_sync::run(&env.pool, &env.app_data)
        .await
        .unwrap();
    let body = block(&env);
    assert!(body.contains("被手删掉的"), "{body}");
    assert!(
        body.contains(&stamp(later, "11:00")),
        "改过的计划时间要保持：{body}"
    );
    /* 跨年那份格式化在 D 用例里覆盖；这里只用年份断言一下没写错年。 */
    assert_eq!(later.year(), env.date.year());
}
