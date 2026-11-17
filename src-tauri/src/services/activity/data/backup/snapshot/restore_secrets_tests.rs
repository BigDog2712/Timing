use super::*;
use crate::services::activity::data::backup::RestoreStrategy;

async fn bridge_token_rows(pool: &sqlx::SqlitePool) -> Vec<(String, String)> {
    sqlx::query_as("SELECT key,value FROM settings
        WHERE key IN ('web_activity_token','remote_status_bridge_token') ORDER BY key")
        .fetch_all(pool).await.unwrap()
}

async fn assert_legacy_snapshot_data(pool: &sqlx::SqlitePool, merged: bool) {
    let settings: Vec<(String, String)> = sqlx::query_as("SELECT key,value FROM settings
        WHERE key IN ('legacy-format-test','target-format-test') ORDER BY key")
        .fetch_all(pool).await.unwrap();
    let sessions: Vec<(String, i64, i64, i64)> = sqlx::query_as(
        "SELECT exe_name,start_time,end_time,duration FROM sessions ORDER BY exe_name",
    ).fetch_all(pool).await.unwrap();
    let mut expected_settings: Vec<(String, String)> = vec![("legacy-format-test".into(), "kept".into())];
    let mut expected_sessions: Vec<(String, i64, i64, i64)> = vec![("source.exe".into(), 1000, 2000, 1000)];
    if merged {
        expected_settings.push(("target-format-test".into(), "kept".into()));
        expected_sessions.push(("target.exe".into(), 10, 20, 10));
    }
    assert_eq!(settings, expected_settings);
    assert_eq!(sessions, expected_sessions);
}

#[tokio::test]
async fn legacy_snapshot_replace_preparation_scrubs_tokens_and_preserves_data() {
    let work = LegacyTestDir::new("legacy-replace-secrets");
    let archive = write_legacy_snapshot_archive(&work).await;
    let archive_hash = sha256_file(&archive).unwrap();
    let prepared = prepare_snapshot_backup(&archive, RestoreStrategy::Replace).await.unwrap();
    let candidate = open_single_connection_sqlite_pool(&prepared.db_path, false).await.unwrap();
    assert!(bridge_token_rows(&candidate).await.is_empty());
    assert_legacy_snapshot_data(&candidate, false).await;
    candidate.close().await;
    assert_eq!(sha256_file(&archive).unwrap(), archive_hash);
    let original = extract_snapshot_archive(&archive, true).await.unwrap();
    let original_pool = open_single_connection_sqlite_pool(&original.db_path, false).await.unwrap();
    assert_eq!(bridge_token_rows(&original_pool).await, vec![
        ("remote_status_bridge_token".into(), "snapshot-remote-secret".into()),
        ("web_activity_token".into(), "snapshot-web-secret".into()),
    ]);
    original_pool.close().await;
}

async fn assert_legacy_snapshot_merge_tokens(existing_tokens: bool) {
    use sqlx::Executor;
    let work = LegacyTestDir::new("legacy-merge-secrets");
    let archive = write_legacy_snapshot_archive(&work).await;
    let archive_hash = sha256_file(&archive).unwrap();
    for prepared in [false, true] {
        let extracted = if prepared {
            prepare_snapshot_backup(&archive, RestoreStrategy::Merge).await.unwrap()
        } else {
            extract_snapshot_archive(&archive, true).await.unwrap()
        };
        let candidate = open_single_connection_sqlite_pool(&extracted.db_path, false).await.unwrap();
        assert_eq!(bridge_token_rows(&candidate).await.len(), if prepared { 0 } else { 2 });
        let target_path = work.0.join(format!("target-{prepared}.db"));
        let target = open_single_connection_sqlite_pool(&target_path, true).await.unwrap();
        prepare_pool_schema(&target, &target_path).await.unwrap();
        if existing_tokens {
            target.execute("INSERT INTO settings(key,value) VALUES('target-format-test','kept'),
                ('web_activity_token','local-web-token'),
                ('remote_status_bridge_token','paired-remote-token');
                INSERT INTO sessions(app_name,exe_name,start_time,end_time,duration)
                VALUES('Target','target.exe',10,20,10);").await.unwrap();
        }
        let local_tokens = bridge_token_rows(&target).await;
        assert_eq!(local_tokens.len(), if existing_tokens { 2 } else { 0 });
        restore::merge_snapshot_backup(candidate.clone(), &target).await.unwrap();
        assert!(candidate.is_closed());
        assert!(!target.is_closed());
        assert_eq!(bridge_token_rows(&target).await, local_tokens);
        assert_legacy_snapshot_data(&target, existing_tokens).await;
        target.close().await;
        let scrubbed = open_single_connection_sqlite_pool(&extracted.db_path, false).await.unwrap();
        assert!(bridge_token_rows(&scrubbed).await.is_empty());
        assert_legacy_snapshot_data(&scrubbed, false).await;
        scrubbed.close().await;
    }
    assert_eq!(sha256_file(&archive).unwrap(), archive_hash);
}

#[tokio::test]
async fn legacy_snapshot_merge_into_empty_target_does_not_import_credentials() {
    assert_legacy_snapshot_merge_tokens(false).await;
}

#[tokio::test]
async fn legacy_snapshot_merge_preserves_existing_local_tokens() {
    assert_legacy_snapshot_merge_tokens(true).await;
}

#[tokio::test]
async fn legacy_snapshot_merge_scrub_failure_closes_candidate_without_changing_target() {
    use sqlx::Executor;
    let work = LegacyTestDir::new("legacy-merge-scrub-failure");
    let archive = write_legacy_snapshot_archive(&work).await;
    let extracted = extract_snapshot_archive(&archive, true).await.unwrap();
    let candidate = open_single_connection_sqlite_pool(&extracted.db_path, false).await.unwrap();
    candidate.execute("CREATE TRIGGER reject_secret_scrub BEFORE DELETE ON settings
        WHEN OLD.key IN ('web_activity_token','remote_status_bridge_token')
        BEGIN SELECT RAISE(ABORT,'scrub rejected'); END;").await.unwrap();
    let target_path = work.0.join("target.db");
    let target = open_single_connection_sqlite_pool(&target_path, true).await.unwrap();
    prepare_pool_schema(&target, &target_path).await.unwrap();
    target.execute("INSERT INTO settings(key,value) VALUES('web_activity_token','local-web-token'),
        ('remote_status_bridge_token','paired-remote-token');
        INSERT INTO sessions(app_name,exe_name,start_time,end_time,duration)
        VALUES('Target','target.exe',10,20,10);").await.unwrap();
    let before: Vec<(String, String)> = sqlx::query_as("SELECT key,value FROM settings ORDER BY key")
        .fetch_all(&target).await.unwrap();
    let error = restore::merge_snapshot_backup(candidate.clone(), &target).await.unwrap_err();
    assert!(candidate.is_closed());
    assert!(!target.is_closed());
    assert!(error.contains("failed to scrub bridge credentials from snapshot"), "{error}");
    assert!(error.contains("scrub rejected"), "{error}");
    let after: Vec<(String, String)> = sqlx::query_as("SELECT key,value FROM settings ORDER BY key")
        .fetch_all(&target).await.unwrap();
    assert_eq!(before, after);
    let sessions: Vec<(String, i64)> = sqlx::query_as("SELECT exe_name,duration FROM sessions")
        .fetch_all(&target).await.unwrap();
    assert_eq!(sessions, vec![("target.exe".into(), 10)]);
    target.close().await;
}
