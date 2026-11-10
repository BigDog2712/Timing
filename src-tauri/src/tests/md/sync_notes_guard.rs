//! 便利贴「按天归日」的数据安全
//!
//! 这一组是本轮最容易丢数据的地方：导出范围从「全部便利贴」收窄成「当天相关」，
//! 一旦同步器把「今天不该列出」误当成「文件里被删了」，跨天那一刻就会批量软删。
//! 所以每条用例的断言都落在**库里还有几行、`deleted_at` 是不是 NULL**。

use crate::infra::md_file;
use crate::models::md_sync::MdSyncKind;
use crate::models::note::NoteGeometry;
use crate::repositories::note as note_repo;
use crate::services;

use super::sync::{at, binding, env, file_for, save_binding, NOTES_HEADING};

fn geometry() -> NoteGeometry {
    NoteGeometry {
        pos_x: 160.0,
        pos_y: 160.0,
        width: 280.0,
        height: 200.0,
    }
}

fn text(env: &super::sync::Env) -> String {
    std::fs::read_to_string(file_for(env)).unwrap()
}

fn block(env: &super::sync::Env) -> String {
    md_file::body_in_text(&text(env), NOTES_HEADING).unwrap()
}

async fn note_rows(pool: &sqlx::SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM notes")
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn alive_rows(pool: &sqlx::SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL")
        .fetch_one(pool)
        .await
        .unwrap()
}

/* ①② 归日口径：昨天没动过的不进来，昨天创建今天改过的要进来。 */
#[tokio::test]
async fn f1_only_notes_touched_today_belong_to_today() {
    let env = env("qa-f1").await;
    let today_note = note_repo::insert(&env.pool, None, "今天新建", geometry(), at(env.date, 9, 0))
        .await
        .unwrap();
    let yesterday = at(env.date.pred_opt().unwrap(), 9, 0);
    let untouched = note_repo::insert(&env.pool, None, "昨天创建且没改过", geometry(), yesterday)
        .await
        .unwrap();
    let touched = note_repo::insert(&env.pool, None, "昨天创建今天改过", geometry(), yesterday)
        .await
        .unwrap();
    sqlx::query("UPDATE notes SET updated_at = ? WHERE id = ?")
        .bind(at(env.date, 8, 30))
        .bind(touched)
        .execute(&env.pool)
        .await
        .unwrap();

    save_binding(
        &env.pool,
        binding(MdSyncKind::Notes, &env.vault, "{date}.md", NOTES_HEADING),
    )
    .await;
    services::md_sync::run(&env.pool).await.unwrap();

    let body = block(&env);
    assert!(body.contains("今天新建"), "{body}");
    assert!(body.contains("昨天创建今天改过"), "{body}");
    assert!(
        !body.contains("昨天创建且没改过"),
        "昨天没动过的属于昨天那篇：{body}"
    );
    assert!(body.contains(&format!("<!-- tb-note:{today_note} -->")));
    /* 不列出 ≠ 删除：昨天那张必须还在库里。 */
    assert_eq!(alive_rows(&env.pool).await, 3);
    let untouched_row: Option<i64> =
        sqlx::query_scalar("SELECT deleted_at FROM notes WHERE id = ?")
            .bind(untouched)
            .fetch_one(&env.pool)
            .await
            .unwrap();
    assert!(untouched_row.is_none(), "没被列出不代表被删");
}

/* ③ 同一天内先导出、再让「今天」判定失效（模拟换天）：不许软删、行数不变。 */
#[tokio::test]
async fn f2_day_rollover_after_export_must_not_soft_delete() {
    let env = env("qa-f2").await;
    let id = note_repo::insert(
        &env.pool,
        None,
        "跨天前贴的",
        geometry(),
        at(env.date, 9, 0),
    )
    .await
    .unwrap();
    save_binding(
        &env.pool,
        binding(MdSyncKind::Notes, &env.vault, "{date}.md", NOTES_HEADING),
    )
    .await;

    services::md_sync::run(&env.pool).await.unwrap();
    assert!(block(&env).contains("跨天前贴的"), "第一轮应导出");
    let before = note_rows(&env.pool).await;

    /* 模拟「换了一天」：这张便利贴的创建 / 更新时间都落到昨天，
    今天这个范围再也选不到它 —— 期望区块变成空，而文件里还留着那一行。 */
    let yesterday = at(env.date.pred_opt().unwrap(), 23, 0);
    sqlx::query("UPDATE notes SET created_at = ?, updated_at = ? WHERE id = ?")
        .bind(yesterday)
        .bind(yesterday)
        .bind(id)
        .execute(&env.pool)
        .await
        .unwrap();

    let report = services::md_sync::run(&env.pool).await.unwrap();
    assert!(report.errors.is_empty(), "{:?}", report.errors);
    assert_eq!(report.imported, 0, "这一轮不该产生任何导入：{report:?}");

    assert_eq!(note_rows(&env.pool).await, before, "行数不能变");
    assert_eq!(alive_rows(&env.pool).await, 1, "旧便利贴不能被软删");
    let deleted: Option<i64> = sqlx::query_scalar("SELECT deleted_at FROM notes WHERE id = ?")
        .bind(id)
        .fetch_one(&env.pool)
        .await
        .unwrap();
    assert!(deleted.is_none(), "deleted_at 必须仍是 NULL");

    /* 区块被清空是预期（过滤结果），库里那条才是事实来源。 */
    assert!(!block(&env).contains("跨天前贴的"));
    let content: String = sqlx::query_scalar("SELECT content FROM notes WHERE id = ?")
        .bind(id)
        .fetch_one(&env.pool)
        .await
        .unwrap();
    assert_eq!(content, "跨天前贴的");
}

/* ③' 更狠的一条：模拟进程重启（内存基线丢失）时，文件里留着「今天不该列出」的行。 */
#[tokio::test]
async fn f3_missing_baseline_does_not_turn_stale_rows_into_deletes() {
    let env = env("qa-f3").await;
    /* 昨天创建、今天没动过：今天这个范围选不到它。 */
    let yesterday_at = at(env.date.pred_opt().unwrap(), 9, 0);
    let id = note_repo::insert(&env.pool, None, "昨天的便条", geometry(), yesterday_at)
        .await
        .unwrap();

    /* 手工造出「上一轮（或别的进程）已经写过的文件」——此时内存里没有基线。 */
    std::fs::write(
        file_for(&env),
        format!(
            "#### 便利贴\n\n| 更新时间 | 事项 | 内容 |\n|---|---|---|\n| 2026-01-01 00:00:00 | — | 昨天的便条 <!-- tb-note:{id} --> |\n"
        ),
    )
    .unwrap();
    save_binding(
        &env.pool,
        binding(MdSyncKind::Notes, &env.vault, "{date}.md", NOTES_HEADING),
    )
    .await;

    let report = services::md_sync::run(&env.pool).await.unwrap();
    assert!(report.errors.is_empty(), "{:?}", report.errors);
    assert_eq!(alive_rows(&env.pool).await, 1, "没有基线也不能当成删除");
    let deleted: Option<i64> = sqlx::query_scalar("SELECT deleted_at FROM notes WHERE id = ?")
        .bind(id)
        .fetch_one(&env.pool)
        .await
        .unwrap();
    assert!(deleted.is_none());
    /* 导入不该顺手改写这张便签的 updated_at（否则它会「复活」进今天的区块）。 */
    let updated: i64 = sqlx::query_scalar("SELECT updated_at FROM notes WHERE id = ?")
        .bind(id)
        .fetch_one(&env.pool)
        .await
        .unwrap();
    assert_eq!(updated, yesterday_at);
}

/* 对照组：用户**真的删掉**表格行时必须软删（否则上面的「不删」就成了功能缺失）。 */
#[tokio::test]
async fn f4_a_row_the_user_really_deletes_is_soft_deleted() {
    let env = env("qa-f4").await;
    let keep = note_repo::insert(&env.pool, None, "留着的", geometry(), at(env.date, 9, 0))
        .await
        .unwrap();
    let drop = note_repo::insert(&env.pool, None, "要删的", geometry(), at(env.date, 9, 5))
        .await
        .unwrap();
    save_binding(
        &env.pool,
        binding(MdSyncKind::Notes, &env.vault, "{date}.md", NOTES_HEADING),
    )
    .await;
    services::md_sync::run(&env.pool).await.unwrap();

    let body = block(&env);
    let kept: Vec<&str> = body
        .lines()
        .filter(|line| !line.contains("要删的"))
        .collect();
    let edited = md_file::replace_in_text(&text(&env), NOTES_HEADING, &kept.join("\n"));
    std::fs::write(file_for(&env), edited).unwrap();

    let report = services::md_sync::run(&env.pool).await.unwrap();
    assert_eq!(report.imported, 1, "便利贴删行是导入：{report:?}");
    let dropped: Option<i64> = sqlx::query_scalar("SELECT deleted_at FROM notes WHERE id = ?")
        .bind(drop)
        .fetch_one(&env.pool)
        .await
        .unwrap();
    assert!(dropped.is_some(), "用户手删的行要软删");
    let kept_row: Option<i64> = sqlx::query_scalar("SELECT deleted_at FROM notes WHERE id = ?")
        .bind(keep)
        .fetch_one(&env.pool)
        .await
        .unwrap();
    assert!(kept_row.is_none());
}
