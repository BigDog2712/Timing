//! `tracker_settings.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::*;
use crate::services::insight::data::schema as db_schema;
use sqlx::{Executor, SqlitePool};

async fn setup_test_db() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
        .await
        .unwrap();
    pool
}

#[test]
fn idle_timeout_setting_does_not_fallback_to_legacy_afk_key() {
    tauri::async_runtime::block_on(async {
        let pool = setup_test_db().await;

        save_setting_value(&pool, "afk_timeout_secs", "999")
            .await
            .unwrap();

        let fallback = load_idle_timeout_secs(&pool, 180).await.unwrap();
        assert_eq!(fallback, 180);

        save_setting_value(&pool, "idle_timeout_secs", "240")
            .await
            .unwrap();

        let configured = load_idle_timeout_secs(&pool, 180).await.unwrap();
        assert_eq!(configured, 240);
    });
}

#[test]
fn timeline_merge_gap_setting_uses_current_setting_key_only() {
    tauri::async_runtime::block_on(async {
        let pool = setup_test_db().await;

        let fallback = load_timeline_merge_gap_secs(&pool, 180).await.unwrap();
        assert_eq!(fallback, 180);

        save_setting_value(&pool, TIMELINE_MERGE_GAP_KEY, "240")
            .await
            .unwrap();

        let configured = load_timeline_merge_gap_secs(&pool, 180).await.unwrap();
        assert_eq!(configured, 240);
    });
}

#[test]
fn app_tracking_setting_defaults_to_enabled_and_reads_explicit_exclusion() {
    tauri::async_runtime::block_on(async {
        let pool = setup_test_db().await;
        assert!(load_tracking_enabled_setting_for_app(&pool, "QQ.exe")
            .await
            .unwrap());

        save_setting_value(
            &pool,
            "__app_override::qq.exe",
            r#"{"track":false,"captureTitle":true}"#,
        )
        .await
        .unwrap();

        assert!(!load_tracking_enabled_setting_for_app(&pool, "qq")
            .await
            .unwrap());
    });
}

#[test]
fn canonical_app_override_applies_to_verified_alias_tracking_and_title_capture() {
    tauri::async_runtime::block_on(async {
        let pool = setup_test_db().await;
        save_setting_value(
            &pool,
            "__app_override::steam.exe",
            r#"{"track":false,"captureTitle":false}"#,
        )
        .await
        .unwrap();

        assert!(
            !load_tracking_enabled_setting_for_app(&pool, "SteamWebHelper.exe")
                .await
                .unwrap()
        );
        assert!(
            !load_capture_window_title_setting_for_app(&pool, "steamwebhelper.exe")
                .await
                .unwrap()
        );
        assert!(
            load_tracking_enabled_setting_for_app(&pool, "unknownhelper.exe")
                .await
                .unwrap()
        );

        save_setting_value(
            &pool,
            "__app_override::alma.exe",
            r#"{"track":false,"captureTitle":false}"#,
        )
        .await
        .unwrap();
        assert!(
            !load_tracking_enabled_setting_for_app(&pool, "alma-0.0.750-win-x64.exe")
                .await
                .unwrap()
        );
        assert!(
            !load_capture_window_title_setting_for_app(&pool, "alma-0.0.750-win-x64.exe")
                .await
                .unwrap()
        );
    });
}

#[test]
fn global_title_recording_defaults_on_and_reads_explicit_value() {
    tauri::async_runtime::block_on(async {
        let pool = setup_test_db().await;
        assert!(load_title_recording_enabled(&pool).await.unwrap());

        save_setting_value(&pool, TITLE_RECORDING_ENABLED_KEY, "0")
            .await
            .unwrap();
        assert!(!load_title_recording_enabled(&pool).await.unwrap());
    });
}
