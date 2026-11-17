use super::*;

#[tokio::test]
async fn concurrent_tombstones_converge_even_when_later_one_arrives_first() {
    let (source, peer, device) = fixture().await;
    let uid = make_session(&source, &device).await;
    record::delete(&source, id(&source, &uid).await).await.unwrap();
    let mut events = all_ops(&source).await;
    let earlier = events.last().unwrap().clone();
    let mut later = earlier.clone();
    later.device_id = "dddddddddddd".into();
    later.uid = "p:dddddddddddd:99".into();
    later.op_id = 99;
    later.at_ms += 10_000;
    let mut value: serde_json::Value = serde_json::from_str(later.payload.as_deref().unwrap()).unwrap();
    let tombstone_at = value["record_v1"]["deleted_at"].as_i64().unwrap();
    value["record_v1"]["deleted_at"] = serde_json::json!(tombstone_at + 10_000);
    later.payload = Some(value.to_string());
    apply(&peer, &[later.clone()]).await;
    apply(&peer, &events).await;
    events.push(later);
    let expected = crate::services::timer_ops::fold_session(&events).block.unwrap();
    assert_eq!(rows(&peer).await[0].deleted_at, expected.record.unwrap().deleted_at);
}

#[tokio::test]
async fn discard_after_reopening_a_split_revision_releases_the_active_slot() {
    let (source, peer, device) = fixture().await;
    let start = ops::start_session(&source, 1, 1000, "2026-11-17", "countup", None, &device).await.unwrap();
    let local_id = id(&source, &start.session_uid).await;
    let active = records::find_by_id(&source, local_id).await.unwrap().unwrap();
    let mut tx = source.begin().await.unwrap();
    crate::repositories::record_session_split::finalize_split(&mut tx, &active, &[(1000,2000,1), (2000,3000,1)], 3000).await.unwrap();
    crate::services::timer_events::record(&mut tx, local_id, TimerOpKind::Stop, 3000, None).await.unwrap();
    tx.commit().await.unwrap();
    ops::append(&source, &start.session_uid, TimerOpKind::Resume, 3100, "2026-11-17", None, &device).await.unwrap();
    apply(&peer, &all_ops(&source).await).await;
    let running = ops::fold(&peer, &start.session_uid).await.unwrap().block.unwrap();
    assert_eq!(running.ended_at_ms, None);
    ops::append(&source, &start.session_uid, TimerOpKind::Drop, 3200, "2026-11-17", None, &device).await.unwrap();
    apply(&peer, &all_ops(&source).await).await;
    let active_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM time_records WHERE status = 'active'")
        .fetch_one(&peer).await.unwrap();
    assert_eq!(active_count, 0);
    assert!(rows(&peer).await.iter().find(|row| row.uid == start.session_uid).unwrap().deleted_at.is_some());
}
