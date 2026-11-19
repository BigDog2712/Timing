//! `repositories::item` 的判据：写入口必须自己写 `device_id`（uid 靠它才发得出来）。
//!
//! 为什么单独立文件：`item.rs` 正文已贴近单文件 300 行门禁（`npm run check:size`），
//! 与 `repositories/timer_ops_tests.rs` 同一套挂法。

use sqlx::SqlitePool;

use crate::repositories::item::{insert, NewItem};

/// 写入口必须**自己**写 `device_id`：漏了它 `trg_items_uid` 的条件不成立，
/// 这行就永远没有 uid ⇒ 永不导出、永不同步，而且零报错。
///
/// 这条用例能抓住回退：把 `insert` 的 INSERT 列表里那个 `device_id` 删掉，
/// `device_id` 会退回默认值 `''`、`uid` 会是 `NULL`，两条断言同时红。
#[test]
fn insert_mints_device_id_and_uid() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::infra::migrate::migrate(&pool).await.unwrap();
        /* 缓存里要有身份，否则写入口只能退化成哨兵 `''`（那是留给启动认领的降级路径，
        本用例要钉的正是「正常路径不发哨兵」）。缓存是进程级的、可能已被别的用例填过，
        所以走 `remember_and_lock_install_id` 取得真正生效的那一份，断言只比
        `device_id` 与 `uid` 的自洽性，不假定具体是哪个 id。 */
        let resolved = crate::services::identity::load_install_id().expect("测试环境应能生成身份");
        let cached = crate::services::identity::remember_and_lock_install_id(resolved);
        assert!(!cached.is_empty(), "测试环境必须先有可用身份");

        let id = insert(
            &pool,
            NewItem {
                name: "设备维度",
                color: None,
                sort_order: 1,
                now: 1_700_000_000_000,
                parent_id: None,
                depth: 0,
                category_key: None,
            },
        )
        .await
        .unwrap();

        let (device_id, uid): (String, Option<String>) =
            sqlx::query_as("SELECT device_id, uid FROM items WHERE id = ?1")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(
            !device_id.is_empty(),
            "insert 没写 items.device_id：uid 将永远是 NULL，这行永不同步"
        );
        assert_eq!(
            uid.as_deref(),
            Some(format!("i:{device_id}:{id}").as_str()),
            "uid 该由 trg_items_uid 按 device_id 发成 i:<device>:<id>"
        );
        assert_eq!(
            device_id, cached,
            "写入口用的 device_id 必须是进程缓存里那一份，否则同一台机器会有两个设备"
        );
    });
}
