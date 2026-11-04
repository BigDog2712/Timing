//! 便利贴置顶（V0.3.0 · AC-64 后半句 / ADR-019）。
//!
//! 从 `tests/note.rs` 拆出（单文件 ≤300 行，ADR-017）：这两条测的是**列持久化 + 窗口层
//! 语义**，与 `note.rs` 的 CRUD / 几何钳制 / 窗口上限不是一类，混着放会越写越长。
//!
//! 断言口径：
//!   - 「列真的变了」而不是「返回结构体看着变了」——直接 SELECT `is_pinned` 复核；
//!   - 「重开沿用」——用 `note::get` 重读，等价于换窗 / 重启后重开；
//!   - 「收纳不动置顶」——几何落盘与置顶是两条独立通道，close 不得顺手改回默认。

use super::note::params;
use crate::models::note::{NoteGeometry, NotePatch};
use crate::services::note;
use crate::tests::support::{fresh_pool, scalar_i64};

/// [V0.3.0] 置顶持久化（AC-64 后半句「状态持久化进 notes」/ ADR-019）。
#[tokio::test]
async fn pin_toggles_and_survives_reload() {
    let pool = fresh_pool("note-pin").await;
    let n = note::create(&pool, params(None, "随便记")).await.unwrap();

    let unpinned = note::update(
        &pool,
        n.id,
        NotePatch {
            is_pinned: Some(false),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(!unpinned.is_pinned, "取消置顶应落库");
    assert_eq!(
        scalar_i64(
            &pool,
            &format!("SELECT is_pinned FROM notes WHERE id = {}", n.id)
        )
        .await,
        0,
        "列值应为 0（不是只在内存里变）"
    );

    // 重新读一次（等同换窗 / 重启后重开）仍是取消置顶
    let reread = note::get(&pool, n.id).await.unwrap();
    assert!(!reread.is_pinned, "重开便利贴应沿用取消置顶");

    let repinned = note::update(
        &pool,
        n.id,
        NotePatch {
            is_pinned: Some(true),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(repinned.is_pinned);
}

/// 收纳（close）不得顺手把置顶改回默认——几何落盘与置顶是两条独立通道。
#[tokio::test]
async fn close_does_not_reset_pin() {
    let pool = fresh_pool("note-pin-close").await;
    let n = note::create(&pool, params(None, "x")).await.unwrap();
    note::update(
        &pool,
        n.id,
        NotePatch {
            is_pinned: Some(false),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let closed = note::close(
        &pool,
        n.id,
        Some(NoteGeometry {
            pos_x: 10.0,
            pos_y: 20.0,
            width: 300.0,
            height: 200.0,
        }),
    )
    .await
    .unwrap();
    assert!(!closed.is_open);
    assert!(!closed.is_pinned, "close 只落几何，不应动置顶");
}
