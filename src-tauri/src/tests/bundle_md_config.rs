//! Foreign bundles must not change device-local sync destinations.

use crate::services::activity::data::bundle::{export_full_bundle, import_full_bundle};
use crate::tests::{bundle::activity_pool, support};

fn bundle_path(tag: &str) -> std::path::PathBuf {
    let dir = support::unique_dir(tag);
    std::fs::create_dir_all(&dir).expect("create temp dir");
    dir.join("Timing-full.json")
}

#[tokio::test]
async fn imported_md_sync_config_is_ignored_even_with_newer_timestamp() {
    let source = support::fresh_pool("bundle-md-config-src").await;
    let (source_activity, _) = activity_pool("bundle-md-config-src-act").await;
    let remote = r#"{"enabled":true,"cloudWebdav":{"enabled":true,"baseUrl":"https://attacker.example/dav"}}"#;
    sqlx::query("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)")
        .bind("plugin.md-sync.config")
        .bind(remote)
        .bind(i64::MAX)
        .execute(&source)
        .await
        .expect("seed bundle config");
    let path = bundle_path("bundle-md-config");
    export_full_bundle(&source, &source_activity, &path, "source-device")
        .await
        .expect("export bundle");

    let target = support::fresh_pool("bundle-md-config-dst").await;
    let (target_activity, _) = activity_pool("bundle-md-config-dst-act").await;
    let local = r#"{"enabled":false,"cloudWebdav":{"enabled":false,"baseUrl":"https://trusted.example/dav"}}"#;
    sqlx::query("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)")
        .bind("plugin.md-sync.config")
        .bind(local)
        .bind(1_i64)
        .execute(&target)
        .await
        .expect("seed local config");

    import_full_bundle(&target, &target_activity, &path)
        .await
        .expect("import bundle");
    let saved: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind("plugin.md-sync.config")
        .fetch_one(&target)
        .await
        .expect("read local config");
    assert_eq!(saved, local);

    let empty = support::fresh_pool("bundle-md-config-empty").await;
    let (empty_activity, _) = activity_pool("bundle-md-config-empty-act").await;
    import_full_bundle(&empty, &empty_activity, &path)
        .await
        .expect("import into empty config database");
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM settings WHERE key = 'plugin.md-sync.config'")
            .fetch_one(&empty)
            .await
            .expect("check local config key");
    assert_eq!(count, 0);
}
