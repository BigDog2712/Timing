//! `delete_item` 级联软删的判据（[0.14]）。
//!
//! 从 `item_tests.rs` 分出来（那边 272 行，再加级联四条会顶穿 300 门禁）。
//! 守的是**两条零报错的失效**：
//!
//! 1. 级联漏删：删了父、子还在 —— 界面上会出现「父没了、子孤悬」的行，
//!    而「父块含子块」的任何读路径对这半个树都没有答案；
//! 2. 事务半途：删到一半断掉，父还在、子删了一半 —— 数据库、日志、前端三处
//!    都没有任何异常，所以每个用例都断言**落库后的 `deleted_at`**，不是只看返回值。

use sqlx::SqlitePool;

use crate::models::item::ItemCreate;
use crate::services::item;

/// 全新业务库。种子里有 id = 1 的「未归类」事项，所以这里造的行都从 2 起。
async fn fixture() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    crate::infra::migrate::migrate(&pool).await.unwrap();
    pool
}

async fn top(pool: &SqlitePool, name: &str) -> i64 {
    item::create_in(
        pool,
        &ItemCreate {
            name: name.to_string(),
            color: None,
            parent_id: None,
            category_key: None,
        },
    )
    .await
    .unwrap()
    .id
}

async fn child_of(pool: &SqlitePool, name: &str, parent_id: i64) -> i64 {
    item::create_in(
        pool,
        &ItemCreate {
            name: name.to_string(),
            color: None,
            parent_id: Some(parent_id),
            category_key: None,
        },
    )
    .await
    .unwrap()
    .id
}

/// 落库后的 `deleted_at`（`None` = 还活着）。判据钉在库上，返回值绿不代表没删错。
async fn deleted_at(pool: &SqlitePool, id: i64) -> Option<i64> {
    sqlx::query_scalar("SELECT deleted_at FROM items WHERE id = ?1")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[test]
fn deleting_a_parent_cascades_to_all_direct_children() {
    tauri::async_runtime::block_on(async {
        let pool = fixture().await;
        let parent = top(&pool, "学习 SQL").await;
        let child_a = child_of(&pool, "chrome", parent).await;
        let child_b = child_of(&pool, "yysls", parent).await;

        item::delete(&pool, parent).await.unwrap();

        assert!(deleted_at(&pool, parent).await.is_some(), "父必须被软删");
        assert!(deleted_at(&pool, child_a).await.is_some(), "直接子 A 必须被级联软删");
        assert!(deleted_at(&pool, child_b).await.is_some(), "直接子 B 必须被级联软删");
    });
}

#[test]
fn deleting_a_childless_item_still_deletes_exactly_one_row() {
    tauri::async_runtime::block_on(async {
        let pool = fixture().await;
        let parent = top(&pool, "学习 SQL").await;
        let other = top(&pool, "燕云").await;

        item::delete(&pool, parent).await.unwrap();

        assert!(deleted_at(&pool, parent).await.is_some());
        assert!(
            deleted_at(&pool, other).await.is_none(),
            "无级联目标时不得误伤别的行"
        );
    });
}

#[test]
fn system_item_is_rejected_before_any_cascade() {
    tauri::async_runtime::block_on(async {
        let pool = fixture().await;
        let parent = top(&pool, "学习 SQL").await;
        let child = child_of(&pool, "chrome", parent).await;
        // 种子里 id = 1 是系统事项「未归类」：给它挂一个子，构造「系统 + 有子」的组合。
        let _system_child = child_of(&pool, "挂到系统事项下", 1).await;

        let result = item::delete(&pool, 1).await;

        assert!(result.is_err(), "系统事项必须先被拒");
        assert!(deleted_at(&pool, child).await.is_none(), "拒绝时子不得被顺带删掉");
        assert!(deleted_at(&pool, parent).await.is_none());
    });
}

#[test]
fn archived_children_are_cascaded_too() {
    tauri::async_runtime::block_on(async {
        let pool = fixture().await;
        let parent = top(&pool, "学习 SQL").await;
        let archived_child = child_of(&pool, "旧记录", parent).await;
        item::archive(&pool, archived_child).await.unwrap();

        item::delete(&pool, parent).await.unwrap();

        assert!(
            deleted_at(&pool, archived_child).await.is_some(),
            "归档是软态不是免死金牌：archived 子也要级联"
        );
    });
}
