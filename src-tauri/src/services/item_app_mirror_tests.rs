//! 启动补镜像的判据（[0.13 fix]「我启动了燕云，但没开始计时」）。
//!
//! 这一层守的是**四条零报错的失效**：
//!   0. **读错库**：配置表在分析窗库（`patina.db`），`item_app` 在业务库（`timing.db`）。
//!      拿业务池去读配置表的症状是「恒空 + 全绿」—— `inserted` 永远 0、日志永远不打、
//!      用户直接开游戏仍然不计时。**所以 fixture 必须是两个池**（见 `fixture`）。
//!   1. 配置表里有绑定、`item_app` 里没有 → 药丸查不到 → 永远不接管（**就是本次报障**）。
//!      补镜像必须把它补上，难点是"用户什么都不打开"也要生效 —— 所以判据直接断言落库。
//!   2. 补的时候**手不要伸长**：不能删、不能改已有行的 `track`（"仅观察"是用户的决定），
//!      也不能因为一条坏配置/一个已删事项把整次补丁打断。
//!   3. 两份配置（单事项键 / 多事项配置）合并规则只有一条：**单事项键优先**。
//!      写错了症状同样是静默的 —— 要么绑到错的事项上，要么两份互相覆盖。

use std::path::Path;

use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;

use crate::models::item::ItemCreate;
use crate::services::item_app_mirror::{mirror, MirrorReport};
use crate::services::{item, item_app};

/// 单连接内存库：多连接各自是**不同**的空库，第二条连接上看不到第一条建的表。
async fn single() -> SqlitePool {
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap()
}

/// 生产形态的两个库：
///   · A = 业务库（`timing.db`）：真迁移，`item_app` / `items` 在这里；
///   · B = 分析窗库（`patina.db`）：`prepare_pool_schema`，`__app_item_binding::` 在这里。
///
/// 种子里有 id = 1 的「未归类」，所以造的事项从 2 起。
///
/// **变异自证**：把 `mirror(&business, &kv)` 改回单池（两次都传 `&business`），
/// 本文件第一条立刻红（`rows_for` 拿到空 vec）—— 这就是第一版实现漏掉的那个缺陷。
pub(super) async fn fixture() -> (SqlitePool, SqlitePool) {
    let business = single().await;
    crate::infra::migrate::migrate(&business).await.unwrap();
    let kv = single().await;
    crate::services::activity::data::sqlite_pool::prepare_pool_schema(&kv, Path::new(":memory:"))
        .await
        .unwrap();
    (business, kv)
}

pub(super) async fn new_item(business: &SqlitePool, name: &str) -> i64 {
    item::create_in(
        business,
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

/// 往**分析窗库**写一条配置。注意那张 `settings` 只有 `key` / `value` 两列（业务库的多一列
/// `updated_at`），所以不能复用 `repositories::settings::set_value` —— 那正是"两个库不是一张表"
/// 的第一个提醒。
pub(super) async fn put(kv: &SqlitePool, key: &str, value: &str) {
    sqlx::query("INSERT OR REPLACE INTO settings(key, value) VALUES (?1, ?2)")
        .bind(key)
        .bind(value)
        .execute(kv)
        .await
        .unwrap();
}

pub(super) async fn rows_for(business: &SqlitePool, app_key: &str) -> Vec<(i64, i64)> {
    item_app::list_for_app(business, app_key)
        .await
        .unwrap()
        .into_iter()
        .map(|row| (row.item_id, row.track))
        .collect()
}

#[test]
fn p0_kv_has_binding_but_item_app_is_empty_before_boot_mirror() {
    tauri::async_runtime::block_on(async {
        let (business, kv) = fixture().await;
        let item_id = new_item(&business, "燕云十六声").await;
        /* 报障现场：应用卡双击绑过（配置表有，但在**另一个库**），item_app 一行都没有 */
        put(
            &kv,
            "__app_item_binding::YanYun.EXE",
            &format!("{{\"itemId\":{item_id}}}"),
        )
        .await;
        assert!(rows_for(&business, "yanyun.exe").await.is_empty());

        let report = mirror(&business, &kv).await.unwrap();

        /* 键归一（大写 EXE → `sessions.app_key` 口径） + 计入 track=1：药丸据此接管 */
        assert_eq!(rows_for(&business, "yanyun.exe").await, vec![(item_id, 1)]);
        assert_eq!(report.inserted, 1);
    });
}

#[test]
fn no_config_at_all_mirrors_nothing_and_does_not_error() {
    tauri::async_runtime::block_on(async {
        let (business, kv) = fixture().await;
        let report = mirror(&business, &kv).await.unwrap();
        assert_eq!(report, MirrorReport::default());
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM item_app")
            .fetch_one(&business)
            .await
            .unwrap();
        assert_eq!(count, 0);
    });
}

#[test]
fn multi_item_config_is_mirrored_without_touching_categories() {
    tauri::async_runtime::block_on(async {
        let (business, kv) = fixture().await;
        let reading = new_item(&business, "读书").await;
        put(
            &kv,
            "__app_override::chrome.exe",
            &format!(
                "{{\"enabled\":true,\"categories\":[\"browser\"],\"itemBindings\":[{{\"itemId\":{reading},\"category\":\"browser\"}}]}}"
            ),
        )
        .await;

        let report = mirror(&business, &kv).await.unwrap();

        assert_eq!(rows_for(&business, "chrome.exe").await, vec![(reading, 1)]);
        assert_eq!(report.inserted, 1);
    });
}

#[test]
fn single_item_key_wins_over_multi_item_config() {
    tauri::async_runtime::block_on(async {
        let (business, kv) = fixture().await;
        let older = new_item(&business, "读文档").await;
        let newer = new_item(&business, "写代码").await;
        put(
            &kv,
            "__app_override::code.exe",
            &format!("{{\"enabled\":true,\"itemBindings\":[{{\"itemId\":{older}}}]}}"),
        )
        .await;
        put(
            &kv,
            "__app_item_binding::code.exe",
            &format!("{{\"itemId\":{newer}}}"),
        )
        .await;

        mirror(&business, &kv).await.unwrap();

        /* 应用卡「绑定事项」是更新的口径：只认它，多的那条不许补进来 */
        assert_eq!(rows_for(&business, "code.exe").await, vec![(newer, 1)]);
    });
}

#[test]
fn existing_rows_are_neither_deleted_nor_retracked() {
    tauri::async_runtime::block_on(async {
        let (business, kv) = fixture().await;
        let observation = new_item(&business, "逛逛网页").await;
        /* 用户手工标成「仅观察」的行：补镜像不许把它改成 1，也不许删掉 */
        item_app::bind(&business, observation, "chrome.exe", Some(0))
            .await
            .unwrap();
        put(
            &kv,
            "__app_item_binding::chrome.exe",
            &format!("{{\"itemId\":{observation}}}"),
        )
        .await;

        let report = mirror(&business, &kv).await.unwrap();

        assert_eq!(
            rows_for(&business, "chrome.exe").await,
            vec![(observation, 0)]
        );
        assert_eq!(report.inserted, 0);
        assert_eq!(report.skipped, 1);
    });
}

#[test]
fn dirty_config_and_deleted_item_are_skipped_without_breaking_the_rest() {
    tauri::async_runtime::block_on(async {
        let (business, kv) = fixture().await;
        let alive = new_item(&business, "开会").await;
        put(&kv, "__app_item_binding::broken.exe", "{not json").await;
        put(&kv, "__app_item_binding::ghost.exe", "{\"itemId\":9999}").await;
        put(
            &kv,
            "__app_item_binding::ok.exe",
            &format!("{{\"itemId\":{alive}}}"),
        )
        .await;

        let report = mirror(&business, &kv).await.unwrap();

        assert!(rows_for(&business, "broken.exe").await.is_empty());
        assert!(rows_for(&business, "ghost.exe").await.is_empty());
        assert_eq!(rows_for(&business, "ok.exe").await, vec![(alive, 1)]);
        assert_eq!(report.inserted, 1);
        assert_eq!(report.skipped, 1);
    });
}

/// 反向判据：**业务库里的同名键不算数**。
///
/// 第一版实现（单池）恰好把这条世界当成前提，所以这条用例在它眼里与上一条同义 ——
/// 现在它专门咬住"读的是哪个库"：配置只写业务库时，补镜像一条都不许补，
/// 而配置只写分析窗库时（上面六条）必须补上。
#[test]
fn binding_written_into_the_business_settings_table_is_not_a_source() {
    tauri::async_runtime::block_on(async {
        let (business, kv) = fixture().await;
        let item_id = new_item(&business, "燕云十六声").await;
        crate::repositories::settings::set_value(
            &business,
            "__app_item_binding::yanyun.exe",
            &format!("{{\"itemId\":{item_id}}}"),
            1,
        )
        .await
        .unwrap();

        let report = mirror(&business, &kv).await.unwrap();

        assert_eq!(report, MirrorReport::default());
        assert!(rows_for(&business, "yanyun.exe").await.is_empty());
    });
}

/// [P0-3] 「用户解绑了，重启又被补回来」的边界：补镜像的唯一数据源是 KV，且只增不减，
/// 所以"删除"**必须**落在 KV 上（`clearAppItemBinding`：先删 KV 再发全集）。KV 清掉之后
/// 再跑一次 mirror 一条都不许补 —— 否则用户会觉得那个开关坏了。
#[test]
fn deleted_row_is_not_restored_after_the_kv_is_cleared() {
    tauri::async_runtime::block_on(async {
        let (business, kv) = fixture().await;
        let item_id = new_item(&business, "燕云十六声").await;
        put(
            &kv,
            "__app_item_binding::yanyun.exe",
            &format!("{{\"itemId\":{item_id}}}"),
        )
        .await;
        assert_eq!(mirror(&business, &kv).await.unwrap().inserted, 1);

        /* 用户在应用设置弹窗里取消：前端先清 KV，再让宿主解绑那一行 */
        sqlx::query("DELETE FROM settings WHERE key = ?1")
            .bind("__app_item_binding::yanyun.exe")
            .execute(&kv)
            .await
            .unwrap();
        item_app::unbind(&business, item_id, "yanyun.exe")
            .await
            .unwrap();

        let second = mirror(&business, &kv).await.unwrap();
        assert_eq!(second, MirrorReport::default());
        assert!(rows_for(&business, "yanyun.exe").await.is_empty());
    });
}

/// 反过来的一半：KV 里**还留着**就一定补回来 —— 这正是为什么删除必须清 KV。
/// 两条合起来才是完整判据：mirror 只反映 KV，不猜用户意图。
#[test]
fn row_comes_back_while_the_kv_still_holds_it() {
    tauri::async_runtime::block_on(async {
        let (business, kv) = fixture().await;
        let item_id = new_item(&business, "燕云十六声").await;
        put(
            &kv,
            "__app_item_binding::yanyun.exe",
            &format!("{{\"itemId\":{item_id}}}"),
        )
        .await;
        mirror(&business, &kv).await.unwrap();

        /* 宿主侧行没了（导入/恢复/手工清理），但配置还在 → 下次启动补回来是正确的 */
        item_app::unbind(&business, item_id, "yanyun.exe")
            .await
            .unwrap();
        assert_eq!(mirror(&business, &kv).await.unwrap().inserted, 1);
        assert_eq!(rows_for(&business, "yanyun.exe").await, vec![(item_id, 1)]);
    });
}
