//! 事项树与事项↔应用绑定的判据。
//!
//! 这一层守的是**两条零报错的失效**：
//!
//! 1. `depth` 与 `parent_id` 不同步。所有「取顶层」的查询都按 `depth = 0` 过滤，
//!    一旦出现「`parent_id` 非空但 `depth = 0`」的行，它会从界面上凭空消失，
//!    而数据库、日志、前端三处都没有任何异常。
//! 2. 第 3 层被静默接受。树深了一层之后，「父事项的时长含不含子事项」这个问题
//!    就从「有歧义」变成「有歧义且已经写进数据」。
//!
//! 所以下面每个用例都断言**落库后的值**，而不是只断言「调用返回 Ok」。

use sqlx::SqlitePool;

use crate::models::item::{ItemCreate, ItemPatch};
use crate::services::{item, item_app, timer};

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

async fn row(pool: &SqlitePool, id: i64) -> (Option<i64>, i64) {
    sqlx::query_as("SELECT parent_id, depth FROM items WHERE id = ?1")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[test]
fn a_child_item_lands_on_the_second_layer() {
    tauri::async_runtime::block_on(async {
        let pool = fixture().await;
        let parent = top(&pool, "学习 SQL").await;
        let child = child_of(&pool, "chrome", parent).await;

        assert_eq!(row(&pool, parent).await, (None, 0));
        assert_eq!(row(&pool, child).await, (Some(parent), 1));
    });
}

/// 第 3 层必须在写入前被拒。放过去之后，任何「按 `depth` 取某一层」的读路径
/// 都会漏掉它，而子记录切片只认「块 ∩ 事实」，不会有人发现少了什么。
#[test]
fn a_third_layer_is_rejected() {
    tauri::async_runtime::block_on(async {
        let pool = fixture().await;
        let parent = top(&pool, "燕云").await;
        let child = child_of(&pool, "yysls", parent).await;

        let result = item::create_in(
            &pool,
            &ItemCreate {
                name: "十七分钟".to_string(),
                color: None,
                parent_id: Some(child),
                category_key: None,
            },
        )
        .await;

        assert!(result.is_err(), "第 3 层必须被拒，实际写入成功");
        // 而且确实一行都没落：只断言 Err 而不查库，实现改成「先插再报错」也照样绿。
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM items WHERE name = '十七分钟'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    });
}

/// 有子事项的事项不能再挂到别人下面 —— 否则它的子就会变成第 3 层，
/// 而这条改动只发生在一个 `UPDATE` 里，没有任何一处会重新检查子事项的深度。
#[test]
fn an_item_with_children_cannot_be_moved_under_another_item() {
    tauri::async_runtime::block_on(async {
        let pool = fixture().await;
        let parent = top(&pool, "学习 SQL").await;
        let _child = child_of(&pool, "chrome", parent).await;
        let other = top(&pool, "燕云").await;

        let patch = ItemPatch {
            name: None,
            color: None,
            sort_order: None,
            remind_at: None,
            is_pinned: None,
            parent_id: Some(Some(other)),
            category_key: None,
        };
        let result = item::update(&pool, parent, patch).await;

        assert!(result.is_err(), "有子事项的事项不能挂到别人下面");
        assert_eq!(row(&pool, parent).await, (None, 0), "失败的改动不能留痕");
    });
}

/// 反过来要通：子事项回到顶层，`depth` 必须跟着回 0。
/// 只改 `parent_id` 不改 `depth` 的话，它会同时从「顶层列表」和「某人的子列表」里消失。
#[test]
fn moving_a_child_back_to_the_top_clears_its_depth() {
    tauri::async_runtime::block_on(async {
        let pool = fixture().await;
        let parent = top(&pool, "学习 SQL").await;
        let child = child_of(&pool, "chrome", parent).await;

        let patch = ItemPatch {
            name: None,
            color: None,
            sort_order: None,
            remind_at: None,
            is_pinned: None,
            parent_id: Some(None),
            category_key: None,
        };
        item::update(&pool, child, patch).await.unwrap();

        assert_eq!(row(&pool, child).await, (None, 0));
    });
}

#[test]
fn an_item_cannot_be_its_own_parent() {
    tauri::async_runtime::block_on(async {
        let pool = fixture().await;
        let id = top(&pool, "自己当自己爹").await;

        let patch = ItemPatch {
            name: None,
            color: None,
            sort_order: None,
            remind_at: None,
            is_pinned: None,
            parent_id: Some(Some(id)),
            category_key: None,
        };
        assert!(item::update(&pool, id, patch).await.is_err());
        assert_eq!(row(&pool, id).await, (None, 0));
    });
}

/// 空白分类归一成 `NULL`。存成空串的话，`resolve_child_category` 的第一步
/// （「事项分类 ∈ 应用分类集」）会拿空串去比，永远不命中 —— 而规则 2 会给出一个
/// 看起来正确的答案，于是没人发现规则 1 从来没生效过。
#[test]
fn a_blank_category_is_stored_as_null() {
    tauri::async_runtime::block_on(async {
        let pool = fixture().await;
        let created = item::create_in(
            &pool,
            &ItemCreate {
                name: "   ".to_string(),
                color: None,
                parent_id: None,
                category_key: Some("   ".to_string()),
            },
        )
        .await;
        assert!(created.is_err(), "空名必须被拒");

        let id = item::create_in(
            &pool,
            &ItemCreate {
                name: "燕云".to_string(),
                color: None,
                parent_id: None,
                category_key: Some("   ".to_string()),
            },
        )
        .await
        .unwrap()
        .id;
        let stored: Option<String> = sqlx::query_scalar("SELECT category_key FROM items WHERE id = ?1")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(stored, None);
    });
}

/// 块只挂叶子：有子事项的事项一旦能开始计时，父的时长与全部子事项**并行重复计时**，
/// 而「父块含不含子块」在任何读路径上都没有答案。
#[test]
fn an_item_with_children_cannot_be_timed() {
    tauri::async_runtime::block_on(async {
        let pool = fixture().await;
        let parent = top(&pool, "学习 SQL").await;
        let leaf = child_of(&pool, "chrome", parent).await;

        assert!(
            timer::start(&pool, Some(parent)).await.is_err(),
            "有子事项的事项不能开始计时"
        );
        // 叶子可以：这条断言同时防「一刀切禁掉所有子事项计时」的过度修复。
        assert!(timer::start(&pool, Some(leaf)).await.is_ok());
    });
}

#[test]
fn binding_the_same_app_twice_updates_instead_of_duplicating() {
    tauri::async_runtime::block_on(async {
        let pool = fixture().await;
        let id = top(&pool, "学习 SQL").await;

        item_app::bind(&pool, id, "chrome", Some(1)).await.unwrap();
        item_app::bind(&pool, id, "chrome", Some(0)).await.unwrap();

        let rows = item_app::list_for_item(&pool, id).await.unwrap();
        assert_eq!(rows.len(), 1, "同一 (事项, 应用) 只能有一行");
        assert_eq!(rows[0].track, 0);
    });
}

#[test]
fn binding_an_unknown_item_is_rejected_instead_of_writing_a_dangling_row() {
    tauri::async_runtime::block_on(async {
        let pool = fixture().await;
        assert!(item_app::bind(&pool, 9999, "chrome", None).await.is_err());
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM item_app")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    });
}

#[test]
fn unbinding_twice_reports_whether_anything_was_removed() {
    tauri::async_runtime::block_on(async {
        let pool = fixture().await;
        let id = top(&pool, "学习 SQL").await;
        item_app::bind(&pool, id, "chrome", None).await.unwrap();

        assert!(item_app::unbind(&pool, id, "chrome").await.unwrap());
        assert!(!item_app::unbind(&pool, id, "chrome").await.unwrap());
    });
}
