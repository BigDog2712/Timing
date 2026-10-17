//! 便利贴域（V0.2.0 批 2）：CRUD 往返 / 几何硬钳制 / 正文长度 / 软删 / 窗口上限 / 列表过滤。
//!
//! 断言来源：`ARCHITECTURE-V0.2.0 §5 便利贴 note(5)`、`§6.a`、`sticky-note.md §与架构的交叉点`。

use crate::error::ErrorCode;
use crate::models::constants::{MAX_NOTE_WINDOWS, NOTE_CONTENT_MAX_LEN, NOTE_MAX_W, NOTE_MIN_W};
use crate::models::note::{NoteCreateParams, NoteGeometry, NotePatch};
use crate::services::note;
use crate::tests::support::{expect_err, fresh_pool, new_item, scalar_i64};

fn params(item_id: Option<i64>, content: &str) -> NoteCreateParams {
    NoteCreateParams {
        item_id,
        content: content.to_string(),
        pos_x: 120.0,
        pos_y: 80.0,
        width: 320.0,
        height: 232.0,
    }
}

#[tokio::test]
async fn create_independent_note_defaults_closed() {
    let pool = fresh_pool("note-create").await;
    let n = note::create(&pool, params(None, "需求文档要补一版"))
        .await
        .unwrap();
    assert_eq!(n.item_id, None, "无关联 = 随记（AC-63）");
    assert!(!n.is_open, "note_create 只建数据行，不建窗口（is_open=0）");
    assert_eq!(n.pos_x, 120.0);
    assert_eq!(n.width, 320.0);
}

#[tokio::test]
async fn create_clamps_geometry_to_hard_bounds() {
    let pool = fresh_pool("note-clamp").await;
    let mut p = params(None, "x");
    p.width = 10.0; // < 160
    p.height = 5000.0; // > 900
    let n = note::create(&pool, p).await.unwrap();
    assert_eq!(n.width, NOTE_MIN_W, "宽应钳到下限 160");
    assert_eq!(n.height, 900.0, "高应钳到上限 900");

    let mut p2 = params(None, "y");
    p2.width = 5000.0;
    let n2 = note::create(&pool, p2).await.unwrap();
    assert_eq!(n2.width, NOTE_MAX_W);
}

#[tokio::test]
async fn create_overlong_content_rejected_without_insert() {
    let pool = fresh_pool("note-long").await;
    let long = "字".repeat(NOTE_CONTENT_MAX_LEN + 1);
    let code = expect_err(note::create(&pool, params(None, &long)).await);
    assert_eq!(code, ErrorCode::ItemNameEmpty, "超长不得静默接受");
    assert_eq!(scalar_i64(&pool, "SELECT COUNT(*) FROM notes").await, 0);
}

#[tokio::test]
async fn create_with_unknown_item_rejected() {
    let pool = fresh_pool("note-bad-item").await;
    let code = expect_err(note::create(&pool, params(Some(9999), "x")).await);
    assert_eq!(code, ErrorCode::ItemNotFound);
}

#[tokio::test]
async fn get_missing_returns_note_not_found() {
    let pool = fresh_pool("note-get-miss").await;
    assert_eq!(
        expect_err(note::get(&pool, 4242).await),
        ErrorCode::NoteNotFound
    );
}

#[tokio::test]
async fn list_filters_by_item_and_orders_by_updated_desc() {
    let pool = fresh_pool("note-list").await;
    let item = new_item(&pool, "甲").await;
    let a = note::create(&pool, params(Some(item), "a")).await.unwrap();
    note::create(&pool, params(None, "b")).await.unwrap();
    // 触碰 a 使其 updated_at 更晚 → 应排在前面
    crate::tests::support::exec(
        &pool,
        &format!(
            "UPDATE notes SET updated_at = updated_at + 10000 WHERE id = {}",
            a.id
        ),
    )
    .await;

    let all = note::list(&pool, None).await.unwrap();
    assert_eq!(all.len(), 2, "itemId 缺省 = 全部");
    assert_eq!(all[0].id, a.id, "按 updated_at DESC");

    let scoped = note::list(&pool, Some(item)).await.unwrap();
    assert_eq!(scoped.len(), 1);
    assert_eq!(scoped[0].id, a.id);
}

#[tokio::test]
async fn update_content_and_item_binding_three_state() {
    let pool = fresh_pool("note-update").await;
    let item = new_item(&pool, "甲").await;
    let n = note::create(&pool, params(None, "原文")).await.unwrap();

    // 绑定事项
    let bound = note::update(
        &pool,
        n.id,
        NotePatch {
            content: Some("改后".into()),
            item_id: Some(Some(item)),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(bound.content, "改后");
    assert_eq!(bound.item_id, Some(item));

    // 显式 null 解绑为随记
    let unbound = note::update(
        &pool,
        n.id,
        NotePatch {
            item_id: Some(None),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(unbound.item_id, None, "显式 null 应解绑（AC-63）");
}

#[tokio::test]
async fn update_clamps_provided_size_only() {
    let pool = fresh_pool("note-update-clamp").await;
    let n = note::create(&pool, params(None, "x")).await.unwrap();
    let updated = note::update(
        &pool,
        n.id,
        NotePatch {
            width: Some(5.0),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(updated.width, NOTE_MIN_W);
    assert_eq!(updated.height, 232.0, "未提供的维度不改动");
}

#[tokio::test]
async fn update_missing_rejected() {
    let pool = fresh_pool("note-update-miss").await;
    assert_eq!(
        expect_err(note::update(&pool, 777, NotePatch::default()).await),
        ErrorCode::NoteNotFound
    );
}

#[tokio::test]
async fn delete_is_soft_and_idempotent() {
    let pool = fresh_pool("note-delete").await;
    let n = note::create(&pool, params(None, "x")).await.unwrap();

    let removed = note::delete(&pool, n.id).await.unwrap();
    assert!(removed.is_some(), "首次删除返回被删便利贴");
    assert!(note::list(&pool, None).await.unwrap().is_empty());
    // 物理行仍在（软删）
    assert_eq!(
        scalar_i64(
            &pool,
            &format!(
                "SELECT COUNT(*) FROM notes WHERE id={} AND deleted_at IS NOT NULL",
                n.id
            )
        )
        .await,
        1
    );
    // 幂等：再次删除返回 None，且不报错
    assert!(note::delete(&pool, n.id).await.unwrap().is_none());
    assert!(note::delete(&pool, 9999).await.unwrap().is_none());
}

#[tokio::test]
async fn open_guard_sets_open_and_enforces_limit() {
    let pool = fresh_pool("note-open-limit").await;
    let mut ids = Vec::new();
    for i in 0..MAX_NOTE_WINDOWS {
        let n = note::create(&pool, params(None, &format!("n{i}")))
            .await
            .unwrap();
        ids.push(n.id);
    }
    // 打开前 20 张
    for id in &ids {
        let opened = note::open_guard(&pool, *id).await.unwrap();
        assert!(opened.is_open);
    }
    assert_eq!(
        scalar_i64(&pool, "SELECT COUNT(*) FROM notes WHERE is_open=1").await,
        MAX_NOTE_WINDOWS as i64
    );

    // 第 21 张 → 超限
    let extra = note::create(&pool, params(None, "extra")).await.unwrap();
    assert_eq!(
        expect_err(note::open_guard(&pool, extra.id).await),
        ErrorCode::WindowLimitExceeded,
        "逾 {MAX_NOTE_WINDOWS} 张应拒绝"
    );

    // 已在打开集合内的再次 open 幂等（不触发上限）
    note::open_guard(&pool, ids[0]).await.unwrap();
}

#[tokio::test]
async fn close_persists_geometry_and_clears_open() {
    let pool = fresh_pool("note-close").await;
    let n = note::create(&pool, params(None, "x")).await.unwrap();
    note::open_guard(&pool, n.id).await.unwrap();

    let geom = NoteGeometry {
        pos_x: 300.0,
        pos_y: 200.0,
        width: 400.0,
        height: 300.0,
    };
    let closed = note::close(&pool, n.id, Some(geom)).await.unwrap();
    assert!(!closed.is_open, "收纳后 is_open=0");
    assert_eq!(closed.pos_x, 300.0);
    assert_eq!(closed.width, 400.0);
}

#[tokio::test]
async fn list_open_returns_only_open_notes() {
    let pool = fresh_pool("note-list-open").await;
    let a = note::create(&pool, params(None, "a")).await.unwrap();
    note::create(&pool, params(None, "b")).await.unwrap();
    note::open_guard(&pool, a.id).await.unwrap();

    let open = note::list_open(&pool).await.unwrap();
    assert_eq!(open.len(), 1);
    assert_eq!(open[0].id, a.id);
}

/// DTO 字段名须为 camelCase（与 `domain-v020.ts::Note` 一一对应）。
#[test]
fn note_dto_is_camel_case() {
    let n = crate::models::note::Note {
        id: 1,
        item_id: None,
        content: "x".into(),
        pos_x: 1.0,
        pos_y: 2.0,
        width: 320.0,
        height: 232.0,
        is_open: true,
        created_at: 0,
        updated_at: 0,
    };
    let v = serde_json::to_value(&n).unwrap();
    for key in ["itemId", "posX", "posY", "isOpen", "createdAt", "updatedAt"] {
        assert!(v.get(key).is_some(), "缺字段 {key}");
    }
    assert!(v.get("pos_x").is_none(), "不得出现 snake_case");
}
