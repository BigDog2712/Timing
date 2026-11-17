use super::*;

#[tokio::test]
async fn duplicated_file_intervals_are_matched_by_occurrence() {
    let (env, first, _) = fixture("md-delta-occurrence").await;
    let second = insert_saved(&env.pool, first.item_id, at(env.date, 10, 0), at(env.date, 10, 30), 700).await;
    let baseline = body(&env).await;
    let mut entries = format::parse_timers(&baseline);
    entries[0].intervals[1] = entries[0].intervals[0];
    let edited = format::render_timers(&entries);
    apply(&env, &baseline, &edited, (0, 1, 0)).await;
    let after = rows(&env).await;
    assert_eq!(after.len(), 2);
    assert_eq!(after[0], first);
    assert_eq!(after[1].id, second);
    assert_saved(&after[1], first.item_id, at(env.date, 9, 0), at(env.date, 9, 30), 1800);
    replay(&env, &baseline, &edited).await;
}

#[tokio::test]
async fn missing_unchanged_same_second_row_cannot_steal_edited_row() {
    let (env, first, _) = fixture("md-delta-missing-same-second").await;
    let second = insert_saved(&env.pool, first.item_id, at(env.date, 9, 0) + 500,
        at(env.date, 9, 45) + 500, 827).await;
    let baseline = body(&env).await;
    sqlx::query("UPDATE time_records SET deleted_at = 1 WHERE id = ?")
        .bind(first.id).execute(&env.pool).await.unwrap();
    let before = rows(&env).await;
    let edited = baseline.replace("09:45:00", "10:00:00");
    apply(&env, &baseline, &edited, (0, 1, 0)).await;
    let after = rows(&env).await;
    assert_eq!(after.len(), 2);
    assert_eq!(after[0], before[0]);
    assert_eq!(after[1].id, second);
    assert_saved(&after[1], first.item_id, at(env.date, 9, 0), at(env.date, 10, 0), 3600);
    replay(&env, &baseline, &edited).await;
}

#[tokio::test]
async fn deletion_preserves_a_same_second_concurrent_addition() {
    let (env, first, baseline) = fixture("md-delta-delete-concurrent").await;
    insert_saved(&env.pool, first.item_id, at(env.date, 9, 0) + 500,
        at(env.date, 10, 0) + 500, 999).await;
    let before = rows(&env).await;
    apply(&env, &baseline, "", (0, 0, 1)).await;
    let after = rows(&env).await;
    assert_eq!(after.len(), 2);
    assert!(after[0].deleted_at.is_some());
    assert_eq!(after[1], before[1]);
    replay(&env, &baseline, "").await;
}

#[tokio::test]
async fn deleting_one_of_same_second_starts_does_not_keep_both() {
    let (env, first, _) = fixture("md-delta-delete-one-same-second").await;
    insert_saved(&env.pool, first.item_id, at(env.date, 9, 0) + 500,
        at(env.date, 10, 0) + 500, 999).await;
    let before = rows(&env).await;
    let baseline = body(&env).await;
    let mut entries = format::parse_timers(&baseline);
    entries[0].intervals.retain(|interval| interval.end_ms == at(env.date, 10, 0));
    let edited = format::render_timers(&entries);
    apply(&env, &baseline, &edited, (0, 0, 1)).await;
    let after = rows(&env).await;
    assert_eq!(after.len(), 2);
    assert!(after[0].deleted_at.is_some());
    assert_eq!(after[1], before[1]);
    replay(&env, &baseline, &edited).await;
}

#[tokio::test]
async fn normalized_same_name_groups_are_paired_together() {
    let (env, first, _) = fixture("md-delta-normalized-groups").await;
    let name = "甲".repeat(crate::models::constants::ITEM_NAME_MAX_LEN);
    sqlx::query("UPDATE items SET name = ? WHERE id = ?")
        .bind(&name).bind(first.item_id).execute(&env.pool).await.unwrap();
    let second = insert_saved(&env.pool, first.item_id, at(env.date, 10, 0), at(env.date, 10, 30), 700).await;
    let baseline = body(&env).await;
    let entry = format::parse_timers(&baseline).remove(0);
    let edited = format::render_timers(&[
        TimerEntry { item: format!("{name}后缀"), intervals: vec![
            TimerInterval::saved(at(env.date, 8, 0), at(env.date, 10, 30)),
        ] },
        TimerEntry { item: name, intervals: vec![entry.intervals[0]] },
    ]);
    apply(&env, &baseline, &edited, (0, 1, 0)).await;
    let after = rows(&env).await;
    assert_eq!(after.len(), 2);
    assert_eq!(after[0], first);
    assert_eq!(after[1].id, second);
    assert_saved(&after[1], first.item_id, at(env.date, 8, 0), at(env.date, 10, 30), 9000);
    replay(&env, &baseline, &edited).await;
}

#[tokio::test]
async fn stale_file_deletion_does_not_delete_a_locally_edited_interval() {
    let (env, first, baseline) = fixture("md-delta-stale-delete").await;
    sqlx::query("UPDATE time_records SET ended_at = ? WHERE id = ?")
        .bind(at(env.date, 10, 0)).bind(first.id).execute(&env.pool).await.unwrap();
    let before = rows(&env).await;
    apply(&env, &baseline, "", (0, 0, 0)).await;
    assert_eq!(rows(&env).await, before);
}
