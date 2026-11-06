//! 格式解析边界 + 写盘稳定性
//!
//! G 的四种边界都是「用户手写会怎么写」：标题里带分隔符、后缀写不出时间、直接抄一行
//! `- [x]`、以及所有待办都落在今天（区块变空）。H 用 mtime 证明「没有变化就不写盘」。

use chrono::{Local, NaiveDate, TimeZone};
use sqlx::SqlitePool;

use crate::infra::md_file;
use crate::models::md_sync::{MdSyncConfig, MdSyncKind};
use crate::models::note::NoteGeometry;
use crate::repositories::note as note_repo;
use crate::repositories::todo as todo_repo;
use crate::services;
use crate::services::md_sync::config;
use crate::services::md_sync::format::{parse_planned, parse_todos, render_todos, TodoRow};

use super::md_sync::{at, binding, env, file_for, save_binding};
use super::md_sync::{NOTES_HEADING, TIMERS_HEADING};
use super::support::{insert_saved, new_item};

const HEADING: &str = "#### 待办事项";

fn text(env: &super::md_sync::Env) -> String {
    std::fs::read_to_string(file_for(env)).unwrap()
}

fn block(env: &super::md_sync::Env) -> String {
    md_file::body_in_text(&text(env), HEADING).unwrap()
}

fn mtime(env: &super::md_sync::Env) -> std::time::SystemTime {
    std::fs::metadata(file_for(env))
        .unwrap()
        .modified()
        .unwrap()
}

async fn add(pool: &SqlitePool, title: &str, planned: Option<i64>, now: i64) -> i64 {
    todo_repo::insert(pool, title, None, planned, None, 0, now)
        .await
        .unwrap()
}

/* --------------------------- G① 标题里带 ` · ` 与「计划」 --------------------------- */

#[test]
fn g1_titles_containing_the_separator_survive_a_roundtrip() {
    let today = NaiveDate::from_ymd_opt(2026, 10, 20).unwrap();
    for title in [
        "复盘 · 计划 下周再定",
        "写周报 · 计划",
        "A · B · C",
        "对齐 · 逾期 的方案",
    ] {
        let rows = vec![TodoRow {
            id: Some(1),
            title: title.into(),
            planned_ms: None,
            done: false,
        }];
        let body = render_todos(&rows, today);
        let parsed = parse_todos(&body, today);
        assert_eq!(parsed.len(), 1, "{body}");
        assert_eq!(parsed[0].title, title, "标题被误剥：{body}");
        assert_eq!(parsed[0].planned_ms, None, "{body}");
    }
}

/* ------------------------------ G② 解析不出的后缀保留 ------------------------------ */

#[test]
fn g2_unparsable_plan_suffix_stays_in_the_title() {
    let today = NaiveDate::from_ymd_opt(2026, 10, 20).unwrap();
    let parsed = parse_todos("- [ ] 整理目录 · 计划 下周 <!-- tb-todo:4 -->", today);
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].title, "整理目录 · 计划 下周");
    assert_eq!(parsed[0].planned_ms, None);
    assert_eq!(parsed[0].id, Some(4));
}

/* --------------------------- G③ 手写 `- [x]` 建成已完成 --------------------------- */

#[tokio::test]
async fn g3_handwritten_checked_line_is_created_as_done() {
    let env = env("qa-g3").await;
    let now = at(env.date, 8, 0);
    save_binding(
        &env.pool,
        binding(MdSyncKind::Todos, &env.vault, "{date}.md", HEADING),
    )
    .await;
    add(
        &env.pool,
        "锚点",
        Some(at(env.date.succ_opt().unwrap(), 9, 0)),
        now,
    )
    .await;
    services::md_sync::run(&env.pool).await.unwrap();

    let edited = format!("{}\n- [x] 手动抄的已完成一条", block(&env));
    let updated = md_file::replace_in_text(&text(&env), HEADING, &edited);
    std::fs::write(file_for(&env), updated).unwrap();

    let report = services::md_sync::run(&env.pool).await.unwrap();
    assert_eq!(report.imported, 1, "{report:?}");
    let done: Option<i64> =
        sqlx::query_scalar("SELECT done_at FROM todos WHERE title = '手动抄的已完成一条'")
            .fetch_one(&env.pool)
            .await
            .unwrap();
    assert!(done.is_some(), "手写 [x] 应直接建成已完成");
    /* 已完成的不会进区块，所以下一轮文件里不该出现它。 */
    services::md_sync::run(&env.pool).await.unwrap();
    assert!(!block(&env).contains("手动抄的已完成一条"));
}

/* ------------------------- G④ 空区块：只剩标题、不反复刷盘 ------------------------- */

#[tokio::test]
async fn g4_empty_block_leaves_heading_only_and_stops_writing() {
    let env = env("qa-g4").await;
    let now = at(env.date, 8, 0);
    save_binding(
        &env.pool,
        binding(MdSyncKind::Todos, &env.vault, "{date}.md", HEADING),
    )
    .await;
    let id = add(
        &env.pool,
        "明天的事",
        Some(at(env.date.succ_opt().unwrap(), 9, 0)),
        now,
    )
    .await;
    services::md_sync::run(&env.pool).await.unwrap();
    assert!(block(&env).contains("明天的事"));

    /* 把它挪进今天：按用户口径，今天要执行的不再出现在待办区块里 → 区块变空。 */
    sqlx::query("UPDATE todos SET planned_at = ? WHERE id = ?")
        .bind(at(env.date, 12, 0))
        .bind(id)
        .execute(&env.pool)
        .await
        .unwrap();

    let report = services::md_sync::run(&env.pool).await.unwrap();
    assert!(report.exported >= 1, "有变化要写盘：{report:?}");
    assert_eq!(block(&env), "");
    assert!(text(&env).contains(HEADING), "标题行要保留");
    assert!(
        !text(&env).contains("明天的事"),
        "空区块不能残留内容：{}",
        text(&env)
    );

    let before = mtime(&env);
    let again = services::md_sync::run(&env.pool).await.unwrap();
    assert_eq!(again.exported, 0, "空区块不该每轮重写：{again:?}");
    assert_eq!(mtime(&env), before, "文件 mtime 不该变");
}

/* -------------------------------- H 写盘稳定性 -------------------------------- */

#[tokio::test]
async fn h_two_idle_runs_leave_mtime_untouched() {
    let env = env("qa-h").await;
    let now = at(env.date, 8, 0);
    let item = new_item(&env.pool, "写代码").await;
    insert_saved(
        &env.pool,
        item,
        at(env.date, 9, 0),
        at(env.date, 9, 30),
        1800,
    )
    .await;
    note_repo::insert(
        &env.pool,
        None,
        "一条便利贴",
        NoteGeometry {
            pos_x: 160.0,
            pos_y: 160.0,
            width: 280.0,
            height: 200.0,
        },
        at(env.date, 9, 10),
    )
    .await
    .unwrap();
    add(
        &env.pool,
        "明天的会",
        Some(at(env.date.succ_opt().unwrap(), 9, 0)),
        now,
    )
    .await;

    /* 三个落点写在同一个文件里：这正是用户的真实配置。 */
    config::save(
        &env.pool,
        &MdSyncConfig {
            poll_secs: 900,
            enabled: true,
            bindings: vec![
                binding(MdSyncKind::Timers, &env.vault, "{date}.md", TIMERS_HEADING),
                binding(MdSyncKind::Notes, &env.vault, "{date}.md", NOTES_HEADING),
                binding(MdSyncKind::Todos, &env.vault, "{date}.md", HEADING),
            ],
        },
    )
    .await
    .unwrap();

    let first = services::md_sync::run(&env.pool).await.unwrap();
    assert!(first.exported >= 1, "{first:?}");
    let baseline_text = text(&env);
    let before = mtime(&env);

    let second = services::md_sync::run(&env.pool).await.unwrap();
    assert_eq!(second.exported, 0, "无改动不该写盘：{second:?}");
    assert_eq!(second.imported, 0);
    assert_eq!(mtime(&env), before, "mtime 变了说明空转了一轮写盘");
    assert_eq!(text(&env), baseline_text);
    assert!(baseline_text.contains("#### 待办事项"));
    assert!(baseline_text.contains("<!-- tb-todo:"));
}

/* ------------------------- 计划时间解析：确定性纯函数 ------------------------- */

#[test]
fn planned_time_parsing_rules() {
    let today = NaiveDate::from_ymd_opt(2026, 10, 20).unwrap();
    let at_ms = |y, m, d, h, min| {
        Local
            .from_local_datetime(
                &NaiveDate::from_ymd_opt(y, m, d)
                    .unwrap()
                    .and_hms_opt(h, min, 0)
                    .unwrap(),
            )
            .earliest()
            .unwrap()
            .timestamp_millis()
    };

    assert_eq!(
        parse_planned("2026-10-21 09:00", today),
        Some(at_ms(2026, 10, 21, 9, 0))
    );
    assert_eq!(
        parse_planned("10-25 15:30", today),
        Some(at_ms(2026, 10, 25, 15, 30)),
        "省略年份按今天所在年份补"
    );
    assert_eq!(
        parse_planned("2026-10-24", today),
        Some(at_ms(2026, 10, 24, 0, 0)),
        "只有日期时补 00:00"
    );

    /* 12 月写 01-05 = 明年：这是跨年日记能被读懂的关键。 */
    let december = NaiveDate::from_ymd_opt(2026, 12, 20).unwrap();
    assert_eq!(
        parse_planned("01-05", december),
        Some(at_ms(2027, 1, 5, 0, 0))
    );
    /* 反之，刚过去几天的日期不该被推到明年。 */
    assert_eq!(
        parse_planned("10-18", today),
        Some(at_ms(2026, 10, 18, 0, 0))
    );
    assert_eq!(parse_planned("下周", today), None);
    assert_eq!(parse_planned("", today), None);
}
