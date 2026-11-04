//! 改计划时间回写、无 id 行新建

use chrono::NaiveDate;
use sqlx::SqlitePool;

use crate::infra::md_file;
use crate::models::md_sync::MdSyncKind;
use crate::repositories::todo as todo_repo;
use crate::services;

use super::md_sync::{at, binding, env, file_for, save_binding};

const HEADING: &str = "#### 待办事项";

async fn add(pool: &SqlitePool, title: &str, planned: Option<i64>, now: i64) -> i64 {
    todo_repo::insert(pool, title, planned, None, 0, now)
        .await
        .unwrap()
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

fn edit(env: &super::md_sync::Env, body: &str) {
    let edited = md_file::replace_in_text(&text(env), HEADING, body);
    std::fs::write(file_for(env), edited).unwrap();
}

fn stamp(date: NaiveDate, hhmm: &str) -> String {
    format!("{} {hhmm}", date.format("%Y-%m-%d"))
}

async fn planned_of(pool: &SqlitePool, id: i64) -> Option<i64> {
    sqlx::query_scalar("SELECT planned_at FROM todos WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

/* ---------------------------- D 改计划时间回写 ---------------------------- */

#[tokio::test]
async fn d_plan_suffix_updates_planned_at_including_year_omitted_form() {
    let (env, now) = setup("qa-d").await;
    let tomorrow = env.date.succ_opt().unwrap();
    let id = add(&env.pool, "对齐方案", Some(at(tomorrow, 9, 0)), now).await;
    services::md_sync::run(&env.pool).await.unwrap();

    /* ① 完整时间戳：明天 09:00 → 后天 15:30。 */
    let later = tomorrow.succ_opt().unwrap();
    edit(
        &env,
        &block(&env).replace(&stamp(tomorrow, "09:00"), &stamp(later, "15:30")),
    );
    let report = services::md_sync::run(&env.pool).await.unwrap();
    assert_eq!(report.imported, 1, "{report:?}");
    assert_eq!(planned_of(&env.pool, id).await, Some(at(later, 15, 30)));

    /* ② 省略年份：`MM-DD HH:MM` 按今天所在年份补（跨年规则由纯函数用例确定性覆盖）。
    注意必须同时改时刻——只把 `2026-10-22 15:30` 写成 `10-22 15:30` 是**同一个值**，
    `apply_todos` 的 `old == new` 短路会正确地什么都不做（这本身就是幂等性证据，
    见下面第三段）。 */
    let short = format!("{} 16:45", later.format("%m-%d"));
    edit(&env, &block(&env).replace(&stamp(later, "15:30"), &short));
    let report = services::md_sync::run(&env.pool).await.unwrap();
    assert_eq!(report.imported, 1, "省略年份也要能回写：{report:?}");
    assert_eq!(planned_of(&env.pool, id).await, Some(at(later, 16, 45)));
    /* 导入后重新渲染会把写法规范化回 `YYYY-MM-DD HH:MM`。 */
    assert!(
        block(&env).contains(&stamp(later, "16:45")),
        "{}",
        block(&env)
    );
    /* ③ 等价写法不产生假导入：把完整时间戳改成省略年份的同值写法，应当「无变化」。 */
    edit(
        &env,
        &block(&env).replace(
            &stamp(later, "16:45"),
            &format!("{} 16:45", later.format("%m-%d")),
        ),
    );
    let report = services::md_sync::run(&env.pool).await.unwrap();
    assert_eq!(report.imported, 0, "同值写法不该触发导入：{report:?}");
}

/* ----------------------------- E 无 id 行新建 ----------------------------- */

#[tokio::test]
async fn e_handwritten_lines_create_todos_once() {
    let (env, now) = setup("qa-e").await;
    let tomorrow = env.date.succ_opt().unwrap();
    let target = tomorrow.succ_opt().unwrap();
    add(&env.pool, "锚点", Some(at(tomorrow, 9, 0)), now).await;

    services::md_sync::run(&env.pool).await.unwrap();
    let added = format!(
        "{}\n- [ ] 手写带计划 · 计划 {}\n- [ ] 手写不带后缀",
        block(&env),
        stamp(target, "10:00")
    );
    edit(&env, &added);

    let report = services::md_sync::run(&env.pool).await.unwrap();
    assert_eq!(report.imported, 2, "两条新行都要建：{report:?}");

    /* 注意必须 `fetch_one` + `Option<i64>`：用 `fetch_optional` 时泛型会被推成
    `i64`，SQLite 把 NULL 解成 0，`None` 断言会假通过（本用例第一版就踩了这个坑）。 */
    let planned: Option<i64> =
        sqlx::query_scalar("SELECT planned_at FROM todos WHERE title = '手写带计划'")
            .fetch_one(&env.pool)
            .await
            .unwrap();
    assert_eq!(planned, Some(at(target, 10, 0)));
    let unplanned: Option<i64> =
        sqlx::query_scalar("SELECT planned_at FROM todos WHERE title = '手写不带后缀'")
            .fetch_one(&env.pool)
            .await
            .unwrap();
    assert_eq!(unplanned, None, "不带后缀 = 未排期（planned_at IS NULL）");

    let alive: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM todos WHERE deleted_at IS NULL")
        .fetch_one(&env.pool)
        .await
        .unwrap();
    assert_eq!(alive, 3);

    /* 建完之后重新渲染会补上 id；下一轮不能再建一遍（去重靠 id）。 */
    let again = services::md_sync::run(&env.pool).await.unwrap();
    assert_eq!(again.imported, 0, "重复导入必须幂等：{again:?}");
    assert_eq!(again.exported, 0, "补上 id 后不该再写盘");
    assert!(block(&env).contains("<!-- tb-todo:"), "新行应带上 id");
    let alive: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM todos WHERE deleted_at IS NULL")
        .fetch_one(&env.pool)
        .await
        .unwrap();
    assert_eq!(alive, 3);
}
