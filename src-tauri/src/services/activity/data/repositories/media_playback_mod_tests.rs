use super::*;
use sqlx::sqlite::SqlitePoolOptions;

async fn test_pool() -> Pool<Sqlite> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("../sql/0031_media_playback.sql"))
        .execute(&pool)
        .await
        .unwrap();
    pool
}

fn media(app_id: &str, title: &str) -> MediaPlaybackInfo {
    MediaPlaybackInfo::from_session(app_id, title, Some("频道"), None).unwrap()
}

#[tokio::test]
async fn repeating_the_same_media_does_not_split_the_timeline() {
    let pool = test_pool().await;
    let sample = media("Chrome", "视频名");

    assert!(
        record_sample(&pool, "Chrome", Some(&sample), None, 1_000)
            .await
            .unwrap()
    );
    assert!(
        !record_sample(&pool, "Chrome", Some(&sample), None, 11_000)
            .await
            .unwrap()
    );

    let rows = fetch_range(&pool, 0, 20_000).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].start_time, 1_000);
    assert_eq!(rows[0].end_time, None);
}

#[tokio::test]
async fn changing_the_media_closes_the_previous_segment_at_the_sample_time() {
    let pool = test_pool().await;
    let first = media("Chrome", "第一个视频");
    let second = media("Chrome", "第二个视频");

    record_sample(&pool, "Chrome", Some(&first), None, 1_000)
        .await
        .unwrap();
    record_sample(&pool, "Chrome", Some(&second), None, 11_000)
        .await
        .unwrap();

    let rows = fetch_range(&pool, 0, 20_000).await.unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].title, "第一个视频");
    assert_eq!(rows[0].end_time, Some(11_000));
    assert_eq!(rows[1].title, "第二个视频");
    assert_eq!(rows[1].start_time, 11_000);
    assert_eq!(rows[1].end_time, None);
}

#[tokio::test]
async fn switching_the_owning_app_also_splits_the_timeline() {
    let pool = test_pool().await;
    let chrome = media("Chrome", "同一个视频");
    let edge = media("Edge", "同一个视频");

    record_sample(&pool, "Chrome", Some(&chrome), None, 1_000)
        .await
        .unwrap();
    record_sample(&pool, "Edge", Some(&edge), None, 5_000)
        .await
        .unwrap();

    let rows = fetch_range(&pool, 0, 10_000).await.unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[1].source_app_id, "Edge");
}

#[tokio::test]
async fn stopping_playback_closes_the_segment_without_starting_an_empty_one() {
    let pool = test_pool().await;
    let sample = media("Chrome", "视频名");

    record_sample(&pool, "Chrome", Some(&sample), None, 1_000)
        .await
        .unwrap();
    assert!(record_sample(&pool, "", None, None, 21_000).await.unwrap());
    assert!(!record_sample(&pool, "", None, None, 31_000).await.unwrap());

    let rows = fetch_range(&pool, 0, 40_000).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].end_time, Some(21_000));
}

#[tokio::test]
async fn range_query_matches_overlap_rather_than_containment() {
    let pool = test_pool().await;
    let sample = media("Chrome", "长视频");
    let next = media("Chrome", "下一个");

    record_sample(&pool, "Chrome", Some(&sample), None, 1_000)
        .await
        .unwrap();
    record_sample(&pool, "Chrome", Some(&next), None, 60_000)
        .await
        .unwrap();

    let middle = fetch_range(&pool, 5_000, 6_000).await.unwrap();
    assert_eq!(middle.len(), 1);
    assert_eq!(middle[0].title, "长视频");

    let before = fetch_range(&pool, 0, 500).await.unwrap();
    assert!(before.is_empty());
}

#[tokio::test]
async fn deleting_by_app_ids_removes_only_that_app() {
    let pool = test_pool().await;
    record_sample(&pool, "Chrome", Some(&media("Chrome", "A")), None, 1_000)
        .await
        .unwrap();
    record_sample(&pool, "Edge", Some(&media("Edge", "B")), None, 5_000)
        .await
        .unwrap();

    let mut tx = pool.begin().await.unwrap();
    let removed = delete_by_app_ids(&mut tx, &["Chrome".to_string()])
        .await
        .unwrap();
    tx.commit().await.unwrap();

    assert_eq!(removed, 1);
    let rows = fetch_range(&pool, 0, 10_000).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].source_app_id, "Edge");
}

#[tokio::test]
async fn deleting_by_app_ids_ignores_case_so_exclusions_cannot_miss() {
    /* `sessions.exe_name` 保留磁盘大小写，媒体会话报什么就用什么，两边不保证同形；
       比对要是区分大小写，「屏蔽应用」就会留下它的播放记录。 */
    let pool = test_pool().await;
    record_sample(&pool, "Chrome.exe", Some(&media("Chrome.exe", "A")), None, 1_000)
        .await
        .unwrap();

    let mut tx = pool.begin().await.unwrap();
    let removed = delete_by_app_ids(&mut tx, &["chrome.exe".to_string()])
        .await
        .unwrap();
    tx.commit().await.unwrap();

    assert_eq!(removed, 1);
    assert!(fetch_range(&pool, 0, 10_000).await.unwrap().is_empty());
}
