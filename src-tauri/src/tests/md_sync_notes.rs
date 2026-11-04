//! 便利贴区块按「当天相关」归日。
//!
//! 从 `md_sync.rs` 拆出（那份已到 300 行上限），也因为这组语义值得独立用例：
//! 日记是「那一天的记录」，今天的区块只承载**今天创建或今天改过**的便利贴。
//! 旧实现是把全部便利贴写进每一天，昨天贴的便条会天天跟着出现。

use crate::infra::md_file;
use crate::models::md_sync::MdSyncKind;
use crate::models::note::NoteGeometry;
use crate::repositories::note as note_repo;
use crate::services;

use super::md_sync::{at, binding, env, file_for, save_binding, NOTES_HEADING};

fn geometry() -> NoteGeometry {
    NoteGeometry {
        pos_x: 160.0,
        pos_y: 160.0,
        width: 280.0,
        height: 200.0,
    }
}

#[tokio::test]
async fn today_note_roundtrips_and_yesterdays_stays_out() {
    let env = env("md-notes").await;
    let note_id = note_repo::insert(&env.pool, None, "旧内容", geometry(), at(env.date, 9, 0))
        .await
        .unwrap();
    /* 昨天创建、今天没动过：属于昨天那篇日记，不该在今天的区块里再出现一次。 */
    let yesterday = at(env.date.pred_opt().unwrap(), 9, 0);
    note_repo::insert(&env.pool, None, "昨天的内容", geometry(), yesterday)
        .await
        .unwrap();
    save_binding(
        &env.pool,
        binding(MdSyncKind::Notes, &env.vault, "{date}.md", NOTES_HEADING),
    )
    .await;

    services::md_sync::run(&env.pool, &env.app_data)
        .await
        .unwrap();
    let file = file_for(&env);
    let text = std::fs::read_to_string(&file).unwrap();
    assert!(text.contains("#### 便利贴"));
    assert!(text.contains("旧内容"));
    assert!(text.contains(&format!("<!-- tb-note:{note_id} -->")));
    assert!(
        !text.contains("昨天的内容"),
        "跨天的便利贴不该跟到今天的日记"
    );

    let body = md_file::body_in_text(&text, NOTES_HEADING).unwrap();
    let edited = md_file::replace_in_text(&text, NOTES_HEADING, &body.replace("旧内容", "新内容"));
    std::fs::write(&file, edited).unwrap();

    let report = services::md_sync::run(&env.pool, &env.app_data)
        .await
        .unwrap();
    assert!(report.errors.is_empty(), "{:?}", report.errors);
    assert!(report.kinds.contains(&MdSyncKind::Notes));

    let content: Option<String> =
        sqlx::query_scalar("SELECT content FROM notes WHERE id = ? AND deleted_at IS NULL")
            .bind(note_id)
            .fetch_one(&env.pool)
            .await
            .unwrap();
    assert_eq!(content.as_deref(), Some("新内容"));
}

#[tokio::test]
async fn a_note_touched_today_shows_up_even_if_created_earlier() {
    let env = env("md-notes-touched").await;
    let yesterday = at(env.date.pred_opt().unwrap(), 20, 0);
    let note_id = note_repo::insert(&env.pool, None, "昨天写的、今天改了", geometry(), yesterday)
        .await
        .unwrap();
    /* 只把 updated_at 推到今天：归日看的是「动过的时间」，不是创建时间。 */
    sqlx::query("UPDATE notes SET updated_at = ? WHERE id = ?")
        .bind(at(env.date, 8, 30))
        .bind(note_id)
        .execute(&env.pool)
        .await
        .unwrap();
    save_binding(
        &env.pool,
        binding(MdSyncKind::Notes, &env.vault, "{date}.md", NOTES_HEADING),
    )
    .await;

    services::md_sync::run(&env.pool, &env.app_data)
        .await
        .unwrap();
    let text = std::fs::read_to_string(file_for(&env)).unwrap();
    assert!(text.contains("昨天写的、今天改了"));
}
