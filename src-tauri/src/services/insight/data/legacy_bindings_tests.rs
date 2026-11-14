//! 旧 KV 回填的判据。
//!
//! 两条零报错的失效要拦：
//!
//! 1. **键空间不同源**。KV 里的 exe 是 `Chrome.exe`，而 `sessions.app_key` 是小写 ——
//!    回填没归一，`app_category` 里就会出现永远匹配不上的行，而切片一律落到 `other`。
//! 2. **悬空 `itemId` 被写进去**。SQLite 外键默认是关的，写一条指向已删事项的绑定
//!    不会有任何报错，只会在「这个应用绑了谁」里显示一个不存在的行。

use sqlx::{Executor, SqlitePool};

use super::{backfill, BackfillReport, MIGRATION_GUARD_KEY};
use crate::services::insight::data::schema_registry;
use crate::services::item;

/// 业务库（真迁移）+ 活动库（只要 30 的三张表）。
async fn fixture() -> (SqlitePool, SqlitePool) {
    let business = SqlitePool::connect("sqlite::memory:").await.unwrap();
    crate::infra::migrate::migrate(&business).await.unwrap();
    let activity = SqlitePool::connect("sqlite::memory:").await.unwrap();
    activity
        .execute(schema_registry::ITEM_ATTRIBUTION_SQL)
        .await
        .unwrap();
    (business, activity)
}

async fn put_setting(pool: &SqlitePool, key: &str, value: &str) {
    sqlx::query("INSERT INTO settings(key, value, updated_at) VALUES (?1, ?2, 0)")
        .bind(key)
        .bind(value)
        .execute(pool)
        .await
        .unwrap();
}

async fn categories(activity: &SqlitePool) -> Vec<(String, String, i64)> {
    sqlx::query_as("SELECT app_key, category_key, priority FROM app_category ORDER BY app_key, priority")
        .fetch_all(activity)
        .await
        .unwrap()
}

async fn bindings(business: &SqlitePool) -> Vec<(i64, String)> {
    sqlx::query_as("SELECT item_id, app_key FROM item_app ORDER BY item_id, app_key")
        .fetch_all(business)
        .await
        .unwrap()
}

async fn run_backfill(business: &SqlitePool, activity: &SqlitePool) -> BackfillReport {
    backfill(business, activity, 1_700_000_000_000).await.unwrap()
}

/// 分类数组按**下标**变成 priority：`[0]` 就是「分类首位」。
///
/// 顺序丢失的话，bilibili 的「摸鱼」会排到「娱乐」后面，学习事项下的子记录
/// 从「摸鱼」变成「娱乐」—— 而两条规则都会给出一个看起来正常的答案。
#[test]
fn category_array_order_becomes_priority() {
    tauri::async_runtime::block_on(async {
        let (business, activity) = fixture().await;
        put_setting(
            &business,
            "__app_override::chrome.exe",
            r#"{"categories":["study","work","game"]}"#,
        )
        .await;
        let report = run_backfill(&business, &activity).await;

        assert_eq!(report.app_categories, 3);
        assert_eq!(report.skipped, 0);
        let rows = categories(&activity).await;
        assert_eq!(
            rows,
            vec![
                ("chrome.exe".to_string(), "study".to_string(), 0),
                ("chrome.exe".to_string(), "work".to_string(), 10),
                ("chrome.exe".to_string(), "game".to_string(), 20),
            ]
        );
    });
}

/// 只有 `category` 没有 `categories` 的老数据也要迁：它就是一个单元素集。
#[test]
fn a_lone_category_is_treated_as_a_single_element_set() {
    tauri::async_runtime::block_on(async {
        let (business, activity) = fixture().await;
        put_setting(&business, "__app_override::wechat.exe", r#"{"category":"social"}"#).await;
        run_backfill(&business, &activity).await;

        assert_eq!(
            categories(&activity).await,
            vec![("wechat.exe".to_string(), "social".to_string(), 0)]
        );
    });
}

/// 键里的 exe 必须小写化：`Chrome.exe` 与小写版本是同一个应用，
/// 而 `sessions.app_key` 只会是小写。
#[test]
fn the_key_is_lowercased_to_match_the_session_app_key() {
    tauri::async_runtime::block_on(async {
        let (business, activity) = fixture().await;
        put_setting(&business, "__app_override::Chrome.EXE", r#"{"categories":["Study"]}"#).await;
        run_backfill(&business, &activity).await;

        assert_eq!(
            categories(&activity).await,
            vec![("chrome.exe".to_string(), "study".to_string(), 0)]
        );
    });
}

/// 两种事项绑定键都要迁；指向已删事项的那条**不写**，计入 skipped。
#[test]
fn both_binding_keys_migrate_but_dangling_item_ids_are_dropped() {
    tauri::async_runtime::block_on(async {
        let (business, activity) = fixture().await;
        let item_id = item::create(&business, "学习 SQL", None).await.unwrap().id;
        put_setting(
            &business,
            "__app_override::chrome.exe",
            &format!(r#"{{"categories":["study"],"itemBindings":[{{"itemId":{item_id}}}]}}"#),
        )
        .await;
        put_setting(
            &business,
            "__app_item_binding::wechat.exe",
            &format!(r#"{{"itemId":{item_id}}}"#),
        )
        .await;
        /* 悬空：9999 不存在。 */
        put_setting(&business, "__app_item_binding::old.exe", r#"{"itemId":9999}"#).await;

        let report = run_backfill(&business, &activity).await;
        assert_eq!(report.item_bindings, 2);
        assert_eq!(report.skipped, 1, "悬空 itemId 必须计入 skipped");
        assert_eq!(
            bindings(&business).await,
            vec![
                (item_id, "chrome.exe".to_string()),
                (item_id, "wechat.exe".to_string()),
            ]
        );
    });
}

/// 守卫键：跑过一次之后不再执行，否则用户在新面板里改了分类、
/// 下次启动会被旧 KV 覆盖回去。
#[test]
fn the_guard_key_makes_the_backfill_run_only_once() {
    tauri::async_runtime::block_on(async {
        let (business, activity) = fixture().await;
        put_setting(&business, "__app_override::chrome.exe", r#"{"categories":["study"]}"#).await;
        assert!(!run_backfill(&business, &activity).await.already_done);

        /* 用户后来在旧界面把分类改成了 game。守卫存在 ⇒ 这次不该跟。 */
        sqlx::query("UPDATE settings SET value = ?1 WHERE key = '__app_override::chrome.exe'")
            .bind(r#"{"categories":["game"]}"#)
            .execute(&business)
            .await
            .unwrap();
        let second = run_backfill(&business, &activity).await;

        assert!(second.already_done);
        assert_eq!(second.app_categories, 0);
        assert_eq!(
            categories(&activity).await,
            vec![("chrome.exe".to_string(), "study".to_string(), 0)],
            "守卫之后不许被旧 KV 覆盖"
        );
        let guard: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?1")
            .bind(MIGRATION_GUARD_KEY)
            .fetch_optional(&business)
            .await
            .unwrap();
        assert!(guard.is_some(), "守卫键必须落盘，否则每次启动都会重跑");
    });
}

/// 坏 JSON 不许把整次回填打断：其余行照迁，坏的那条进 skipped。
#[test]
fn a_malformed_value_is_skipped_instead_of_aborting_the_whole_backfill() {
    tauri::async_runtime::block_on(async {
        let (business, activity) = fixture().await;
        put_setting(&business, "__app_override::broken.exe", "{not json").await;
        put_setting(&business, "__app_override::chrome.exe", r#"{"categories":["study"]}"#).await;

        let report = run_backfill(&business, &activity).await;
        assert_eq!(report.skipped, 1);
        assert_eq!(report.app_categories, 1, "好的那条必须照样迁");
    });
}
