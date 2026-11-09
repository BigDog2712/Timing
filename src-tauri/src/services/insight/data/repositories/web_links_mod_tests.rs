//! `web_links.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::*;
use crate::services::insight::data::repositories::classification_settings::{
    commit_classification_setting_mutations, ClassificationSettingMutation,
};
use serde_json::json;
async fn database() -> sqlx::Pool<Sqlite> {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::query("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
        .execute(&pool)
        .await
        .unwrap();
    pool
}
fn change(
    next: serde_json::Value,
    previous: serde_json::Value,
) -> ClassificationSettingMutation {
    ClassificationSettingMutation {
        key: "__web_site::example.com".into(),
        value: Some(json!({"next":next,"previous":previous}).to_string()),
    }
}
#[tokio::test]
async fn category_upgrade_uses_lifetime_winner_and_runs_once_atomically() {
    use sqlx::Executor;
    let pool = database().await;
    pool.execute(crate::services::insight::data::schema::WEB_ACTIVITY_SCHEMA_SQL)
        .await
        .unwrap();
    for (domain, category, duration) in [
        ("chat.example.com", Some("development"), 1000),
        ("www.example.com", Some("work"), 2000),
        ("a.tie.org", Some("work"), 500),
        ("b.tie.org", Some("development"), 500),
        ("a.empty.net", None, 2000),
        ("b.empty.net", Some("work"), 1000),
        ("a.saved.com", Some("development"), 1000),
    ] {
        if let Some(category) = category {
            sqlx::query("INSERT INTO settings VALUES(?,?)")
                .bind(format!("__web_domain_override::{domain}"))
                .bind(json!({"category":category}).to_string())
                .execute(&pool)
                .await
                .unwrap();
        }
        sqlx::query("INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,duration,created_at,updated_at) VALUES('a','chrome','chrome.exe',?,?,0,?,?,0,?)")
            .bind(domain).bind(domain).bind(duration).bind(duration).bind(duration).execute(&pool).await.unwrap();
    }
    sqlx::query("INSERT INTO settings VALUES('__web_site::saved.com',?)")
        .bind(json!({"version":2,"category":"other","exceptions":["a.saved.com"]}).to_string())
        .execute(&pool)
        .await
        .unwrap();
    let mut tx = pool.begin().await.unwrap();
    migrate_legacy_web_grouping(&mut tx).await.unwrap();
    let rules = load_in_tx(&mut tx).await.unwrap();
    assert_eq!(rules["example.com"].category.as_deref(), Some("work"));
    assert_eq!(rules["tie.org"].category.as_deref(), Some("work"));
    assert!(!rules.contains_key("empty.net"));
    assert_eq!(rules["saved.com"].category.as_deref(), Some("other"));
    assert!(rules["saved.com"].exceptions.contains("a.saved.com"));
    tx.rollback().await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    assert!(!load_in_tx(&mut tx)
        .await
        .unwrap()
        .contains_key("example.com"));
    migrate_legacy_web_grouping(&mut tx).await.unwrap();
    tx.commit().await.unwrap();
    sqlx::query("DELETE FROM settings WHERE key='__web_site::example.com'")
        .execute(&pool)
        .await
        .unwrap();
    let mut tx = pool.begin().await.unwrap();
    migrate_legacy_web_grouping(&mut tx).await.unwrap();
    assert!(!load_in_tx(&mut tx)
        .await
        .unwrap()
        .contains_key("example.com"));
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM settings WHERE key LIKE '__web_domain_override::%'",
    )
    .fetch_one(&mut *tx)
    .await
    .unwrap();
    assert_eq!(count, 6);
    tx.commit().await.unwrap();
    pool.close().await;
}

#[tokio::test]
async fn automatic_rules_replay_conflict_and_atomic_rejection() {
    let pool = database().await;
    let rule = json!({"version":2,"exceptions":["mail.example.com"]});
    let first = change(rule.clone(), json!(null));
    commit_classification_setting_mutations(&pool, &[first.clone()])
        .await
        .unwrap();
    commit_classification_setting_mutations(&pool, &[first])
        .await
        .unwrap();
    assert!(commit_classification_setting_mutations(
        &pool,
        &[change(json!({"version":2}), json!(null))]
    )
    .await
    .is_err());
    let raw = ClassificationSettingMutation {
        key: "__web_domain_override::mail.example.com".into(),
        value: Some(json!({"captureTitle":false}).to_string()),
    };
    assert!(commit_classification_setting_mutations(
        &pool,
        &[
            raw,
            change(
                json!({"version":2,"exceptions":["other.com"]}),
                rule.clone()
            )
        ]
    )
    .await
    .is_err());
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM settings WHERE key='__web_domain_override::mail.example.com'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 0);
    commit_classification_setting_mutations(&pool, &[change(json!(null), rule)])
        .await
        .unwrap();
    pool.close().await;
}
#[tokio::test]
async fn bad_domain_override_rolls_back_legacy_rule_conversion() {
    let pool = database().await;
    let legacy = json!({"members":["other.com"]}).to_string();
    sqlx::query("INSERT INTO settings VALUES('__web_site::chat.example.com',?)")
        .bind(&legacy)
        .execute(&pool)
        .await
        .unwrap();
    for invalid in ["broken-json", "[]"] {
        sqlx::query("INSERT OR REPLACE INTO settings VALUES('__web_domain_override::chat.example.com',?)")
            .bind(invalid).execute(&pool).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        assert!(migrate_legacy_web_grouping(&mut tx).await.is_err());
        tx.rollback().await.unwrap();
        let raw: String = sqlx::query_scalar(
            "SELECT value FROM settings WHERE key='__web_site::chat.example.com'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(raw, legacy);
    }
    pool.close().await;
}

#[tokio::test]
async fn migration_discards_manual_links_preserves_raw_settings_and_is_idempotent() {
    use sqlx::Executor;
    let pool = database().await;
    pool.execute(crate::services::insight::data::schema::WEB_ACTIVITY_SCHEMA_SQL)
        .await
        .unwrap();
    for (key, value) in [
        (
            "__web_site::chat.example.com",
            json!({"members":["other.com"],"displayName":"Old group"}),
        ),
        (
            "__web_site::legacy.org",
            json!({"enabled":true,"exceptions":["mail.legacy.org"],"color":"#123456"}),
        ),
        (
            "__web_domain_override::chat.example.com",
            json!({"displayName":"Original","captureTitle":false,"category":"work"}),
        ),
    ] {
        sqlx::query("INSERT INTO settings VALUES(?,?)")
            .bind(key)
            .bind(value.to_string())
            .execute(&pool)
            .await
            .unwrap();
    }
    let mut tx = pool.begin().await.unwrap();
    migrate_legacy_web_grouping(&mut tx).await.unwrap();
    tx.rollback().await.unwrap();
    let original: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM settings WHERE key='__web_site::chat.example.com'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(original, 1);
    let mut tx = pool.begin().await.unwrap();
    migrate_legacy_web_grouping(&mut tx).await.unwrap();
    let rules = load_in_tx(&mut tx).await.unwrap();
    assert!(!rules.contains_key("chat.example.com"));
    assert_eq!(rules["example.com"].category.as_deref(), Some("work"));
    assert_eq!(
        rules["legacy.org"].exceptions,
        std::collections::BTreeSet::from(["mail.legacy.org".into()])
    );
    assert!(rules["legacy.org"].color.is_none());
    let raw: String = sqlx::query_scalar(
        "SELECT value FROM settings WHERE key='__web_domain_override::chat.example.com'",
    )
    .fetch_one(&mut *tx)
    .await
    .unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&raw).unwrap()["displayName"],
        "Original"
    );
    let backup: String =
        sqlx::query_scalar("SELECT value FROM settings WHERE key='__web_grouping_backup_v2'")
            .fetch_one(&mut *tx)
            .await
            .unwrap();
    assert!(backup.contains("Old group"));
    migrate_legacy_web_grouping(&mut tx).await.unwrap();
    assert_eq!(load_in_tx(&mut tx).await.unwrap(), rules);
    tx.commit().await.unwrap();
    pool.close().await;
}

#[tokio::test]
async fn large_automatic_exception_sets_save_and_restore_without_truncation() {
    let pool = database().await;
    let domains: Vec<String> = (0..1500)
        .map(|index| format!("member-{index}.example.com"))
        .collect();
    let rule = json!({"version":2,"exceptions":domains});
    commit_classification_setting_mutations(&pool, &[change(rule.clone(), json!(null))])
        .await
        .unwrap();
    let mut tx = pool.begin().await.unwrap();
    migrate_legacy_web_grouping(&mut tx).await.unwrap();
    assert_eq!(
        load_in_tx(&mut tx).await.unwrap()["example.com"]
            .exceptions
            .len(),
        1500
    );
    tx.commit().await.unwrap();
    commit_classification_setting_mutations(&pool, &[change(json!(null), rule)])
        .await
        .unwrap();
    pool.close().await;
}

#[tokio::test]
async fn lifetime_icon_totals_union_same_source_and_keep_independent_sources() {
    use sqlx::Executor;
    let pool = database().await;
    pool.execute(crate::services::insight::data::schema::WEB_ACTIVITY_SCHEMA_SQL)
        .await
        .unwrap();
    pool.execute(crate::services::insight::data::schema::WEB_FAVICON_CACHE_SCHEMA_SQL)
        .await
        .unwrap();
    for (source, start, end) in [
        ("a", 0, 1000),
        ("a", 500, 1500),
        ("a", 600, 700),
        ("b", 0, 1000),
    ] {
        sqlx::query("INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,duration,created_at,updated_at) VALUES(?,'chrome','chrome.exe','chat.example.com','chat.example.com',?,?,?,0,?)")
            .bind(source).bind(start).bind(end).bind(end-start).bind(end).execute(&pool).await.unwrap();
    }
    let result = snapshot(&pool).await.unwrap();
    assert_eq!(result.totals["chat.example.com"], 2500);
    assert_eq!(result.roots["chat.example.com"], "example.com");
    assert_eq!(result.domains, ["chat.example.com"]);
    sqlx::query("INSERT INTO settings(key,value) VALUES('__web_domain_override::chat.example.com','broken-json')").execute(&pool).await.unwrap();
    assert!(snapshot(&pool)
        .await
        .unwrap_err()
        .contains("invalid website override"));
    pool.close().await;
}

#[tokio::test]
async fn merge_restore_preserves_new_exceptions_and_rejects_unknown_versions() {
    use crate::services::insight::data::repositories::settings::insert_missing_for_restore;
    use crate::models::insight::backup::BackupSetting;
    let pool = database().await;
    let current =
        json!({"version":2,"exceptions":["keep.example.com"],"displayName":"Current"});
    commit_classification_setting_mutations(&pool, &[change(current.clone(), json!(null))])
        .await
        .unwrap();
    let mut tx = pool.begin().await.unwrap();
    insert_missing_for_restore(
        &mut tx,
        &[
            BackupSetting {
                key: "__web_site::example.com".into(),
                value: json!({"members":["other.com"]}).to_string(),
            },
            BackupSetting {
                key: "__web_site::chat.example.com".into(),
                value: json!({"enabled":true,"exceptions":["old.chat.example.com"]})
                    .to_string(),
            },
        ],
    )
    .await
    .unwrap();
    migrate_legacy_web_grouping(&mut tx).await.unwrap();
    assert_eq!(
        serde_json::to_value(&load_in_tx(&mut tx).await.unwrap()["example.com"]).unwrap(),
        current
    );
    tx.commit().await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    assert!(insert_missing_for_restore(
        &mut tx,
        &[BackupSetting {
            key: "__web_site::future.com".into(),
            value: json!({"version":3}).to_string()
        }]
    )
    .await
    .is_err());
    tx.rollback().await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    assert_eq!(load_in_tx(&mut tx).await.unwrap().len(), 1);
    tx.rollback().await.unwrap();
    pool.close().await;
}
