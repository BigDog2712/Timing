use super::sync::{at, env, Env};
use super::sync_live::pin_start;
use crate::services::md_sync::format::{TimerEntry, TimerInterval};
use crate::services::md_sync::{export, format, import};
use crate::tests::support::{insert_saved, new_item};

#[path = "sync_timer_delta_edges.rs"]
mod edges;

#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
struct Row {
    id: i64,
    item_id: i64,
    status: String,
    started_at: i64,
    ended_at: Option<i64>,
    accumulated_sec: i64,
    running_since: Option<i64>,
    deleted_at: Option<i64>,
    updated_at: i64,
}

async fn rows(env: &Env) -> Vec<Row> {
    sqlx::query_as(
        "SELECT id, item_id, status, started_at, ended_at, accumulated_sec, \
                    running_since, deleted_at, updated_at FROM time_records ORDER BY id",
    )
    .fetch_all(&env.pool)
    .await
    .unwrap()
}

async fn body(env: &Env) -> String {
    export::timers_at(&env.pool, env.date, at(env.date, 18, 0))
        .await
        .unwrap()
        .body
}

async fn fixture(tag: &str) -> (Env, Row, String) {
    let env = env(tag).await;
    let item = new_item(&env.pool, "回归甲").await;
    let id = insert_saved(
        &env.pool,
        item,
        at(env.date, 9, 0) + 987,
        at(env.date, 9, 30) + 876,
        613,
    )
    .await;
    let row = rows(&env).await.remove(0);
    assert_eq!(row.id, id);
    let baseline = body(&env).await;
    (env, row, baseline)
}

fn appended(env: &Env, baseline: &str) -> String {
    let mut entries = format::parse_timers(baseline);
    entries[0].intervals.push(TimerInterval::saved(
        at(env.date, 14, 0),
        at(env.date, 14, 30),
    ));
    format::render_timers(&entries)
}

async fn apply(env: &Env, baseline: &str, edited: &str, expected: (u32, u32, u32)) {
    let stats = import::apply_timers(&env.pool, env.date, baseline, edited)
        .await
        .unwrap();
    assert_eq!((stats.created, stats.updated, stats.deleted), expected);
}

async fn replay(env: &Env, baseline: &str, edited: &str) {
    let before = rows(env).await;
    apply(env, baseline, edited, (0, 0, 0)).await;
    assert_eq!(rows(env).await, before);
}

fn assert_saved(row: &Row, item: i64, start: i64, end: i64, accumulated: i64) {
    assert_eq!(
        (
            row.item_id,
            row.started_at,
            row.ended_at,
            row.accumulated_sec
        ),
        (item, start, Some(end), accumulated)
    );
    assert_eq!(row.status, "saved");
    assert_eq!((row.running_since, row.deleted_at), (None, None));
}

async fn assert_appended(env: &Env, original: &Row, baseline: &str) {
    let edited = appended(env, baseline);
    apply(env, baseline, &edited, (1, 0, 0)).await;
    let after = rows(env).await;
    assert_eq!(after.len(), 2);
    assert_eq!(&after[0], original);
    assert_ne!(after[1].id, original.id);
    assert_saved(
        &after[1],
        original.item_id,
        at(env.date, 14, 0),
        at(env.date, 14, 30),
        1800,
    );
    replay(env, baseline, &edited).await;
}

#[tokio::test]
async fn unchanged_interval_preserves_local_end_and_accumulated() {
    let (env, mut original, baseline) = fixture("md-delta-local-end").await;
    original.ended_at = Some(at(env.date, 9, 45) + 654);
    original.accumulated_sec = 941;
    sqlx::query("UPDATE time_records SET ended_at = ?, accumulated_sec = ? WHERE id = ?")
        .bind(original.ended_at)
        .bind(original.accumulated_sec)
        .bind(original.id)
        .execute(&env.pool)
        .await
        .unwrap();
    assert_appended(&env, &original, &baseline).await;
}

#[tokio::test]
async fn unchanged_interval_preserves_locally_moved_start() {
    let (env, mut original, baseline) = fixture("md-delta-local-start").await;
    original.started_at = at(env.date, 9, 5) + 765;
    sqlx::query("UPDATE time_records SET started_at = ? WHERE id = ?")
        .bind(original.started_at)
        .bind(original.id)
        .execute(&env.pool)
        .await
        .unwrap();
    assert_appended(&env, &original, &baseline).await;
}

#[tokio::test]
async fn unchanged_interval_does_not_resurrect_a_local_soft_delete() {
    let (env, mut original, baseline) = fixture("md-delta-local-delete").await;
    original.deleted_at = Some(at(env.date, 12, 0));
    sqlx::query("UPDATE time_records SET deleted_at = ? WHERE id = ?")
        .bind(original.deleted_at)
        .bind(original.id)
        .execute(&env.pool)
        .await
        .unwrap();
    assert_appended(&env, &original, &baseline).await;
}

#[tokio::test]
async fn missing_unchanged_interval_does_not_claim_another_edited_row() {
    let (env, missing, _) = fixture("md-delta-missing").await;
    let id = insert_saved(
        &env.pool,
        missing.item_id,
        at(env.date, 10, 0) + 789,
        at(env.date, 10, 30) + 654,
        731,
    )
    .await;
    let baseline = body(&env).await;
    sqlx::query("DELETE FROM time_records WHERE id = ?")
        .bind(missing.id)
        .execute(&env.pool)
        .await
        .unwrap();
    let edited = baseline.replace("10:00:00", "10:05:00");
    assert_ne!(baseline, edited);
    apply(&env, &baseline, &edited, (0, 1, 0)).await;
    let after = rows(&env).await;
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].id, id);
    assert_saved(
        &after[0],
        missing.item_id,
        at(env.date, 10, 5),
        at(env.date, 10, 30),
        1500,
    );
    replay(&env, &baseline, &edited).await;
}

#[tokio::test]
async fn empty_baseline_self_import_preserves_milliseconds_and_paused_duration() {
    let (env, original, rendered) = fixture("md-delta-empty-saved").await;
    let parsed = format::parse_timers(&rendered);
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].intervals.len(), 1);
    let interval = &parsed[0].intervals[0];
    assert_eq!(
        (interval.start_ms, interval.end_ms),
        (at(env.date, 9, 0), at(env.date, 9, 30))
    );
    assert!(rendered.contains("duration: 10m13s"));
    apply(&env, "", &rendered, (0, 0, 0)).await;
    assert_eq!(rows(&env).await, vec![original]);
    replay(&env, "", &rendered).await;
}

#[tokio::test]
async fn explicit_file_deletion_soft_deletes_the_millisecond_row() {
    let (env, original, baseline) = fixture("md-delta-delete-ms").await;
    apply(&env, &baseline, "", (0, 0, 1)).await;
    let after = rows(&env).await;
    assert_eq!(after.len(), 1);
    assert!(after[0].deleted_at.is_some());
    let mut expected = original;
    expected.deleted_at = after[0].deleted_at;
    expected.updated_at = after[0].updated_at;
    assert_eq!(after, vec![expected]);
    replay(&env, &baseline, "").await;
}

#[tokio::test]
async fn explicit_time_edit_updates_the_same_id_with_new_wall_duration() {
    let (env, original, baseline) = fixture("md-delta-edit-ms").await;
    let edited = baseline
        .replace("09:00:00", "09:05:00")
        .replace("09:30:00", "09:45:00");
    assert_ne!(baseline, edited);
    apply(&env, &baseline, &edited, (0, 1, 0)).await;
    let after = rows(&env).await;
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].id, original.id);
    assert_saved(
        &after[0],
        original.item_id,
        at(env.date, 9, 5),
        at(env.date, 9, 45),
        2400,
    );
    replay(&env, &baseline, &edited).await;
}

#[tokio::test]
async fn empty_baseline_does_not_import_a_millisecond_active_placeholder() {
    let env = env("md-delta-empty-active").await;
    let item = new_item(&env.pool, "回归甲").await;
    let active = crate::services::timer::start(&env.pool, Some(item))
        .await
        .unwrap();
    let start = at(env.date, 9, 0) + 987;
    pin_start(&env, active.id, start).await;
    let before = rows(&env).await;
    assert_eq!(before.len(), 1);
    assert_eq!(
        (before[0].id, before[0].item_id, before[0].started_at),
        (active.id, item, start)
    );
    assert_eq!(before[0].status, "active");
    assert_eq!(
        (before[0].ended_at, before[0].running_since),
        (None, Some(start))
    );
    let rendered = body(&env).await;
    let parsed = format::parse_timers(&rendered);
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].intervals.len(), 1);
    assert!(parsed[0].intervals[0].ongoing);
    assert_eq!(parsed[0].intervals[0].start_ms, at(env.date, 9, 0));
    apply(&env, "", &rendered, (0, 0, 0)).await;
    assert_eq!(rows(&env).await, before);
    replay(&env, "", &rendered).await;
}

#[tokio::test]
async fn unchanged_old_group_after_local_rename_does_not_create_an_empty_item() {
    let (env, original, baseline) = fixture("md-delta-renamed-group").await;
    sqlx::query("UPDATE items SET name = '本地改名' WHERE id = ?")
        .bind(original.item_id)
        .execute(&env.pool)
        .await
        .unwrap();
    let mut entries = format::parse_timers(&baseline);
    entries.push(TimerEntry {
        item: "回归乙".into(),
        intervals: vec![TimerInterval::saved(
            at(env.date, 14, 0),
            at(env.date, 14, 30),
        )],
    });
    let edited = format::render_timers(&entries);
    apply(&env, &baseline, &edited, (1, 0, 0)).await;
    let after = rows(&env).await;
    assert_eq!(after.len(), 2);
    assert_eq!(after[0], original);
    assert_ne!(after[1].id, original.id);
    assert_ne!(after[1].item_id, original.item_id);
    assert_saved(
        &after[1],
        after[1].item_id,
        at(env.date, 14, 0),
        at(env.date, 14, 30),
        1800,
    );
    let items: Vec<(i64, String)> =
        sqlx::query_as("SELECT id, name FROM items WHERE id <> 1 ORDER BY id")
            .fetch_all(&env.pool)
            .await
            .unwrap();
    assert_eq!(
        items,
        vec![
            (original.item_id, "本地改名".into()),
            (after[1].item_id, "回归乙".into())
        ]
    );
    replay(&env, &baseline, &edited).await;
    let items_after: Vec<(i64, String)> =
        sqlx::query_as("SELECT id, name FROM items WHERE id <> 1 ORDER BY id")
            .fetch_all(&env.pool)
            .await
            .unwrap();
    assert_eq!(items_after, items);
}

#[tokio::test]
async fn same_second_starts_match_complete_intervals_before_start_only() {
    let (env, mut unchanged, _) = fixture("md-delta-same-second").await;
    unchanged.started_at = at(env.date, 9, 0) + 654;
    sqlx::query("UPDATE time_records SET started_at = ? WHERE id = ?")
        .bind(unchanged.started_at)
        .bind(unchanged.id)
        .execute(&env.pool)
        .await
        .unwrap();
    let id = insert_saved(
        &env.pool,
        unchanged.item_id,
        at(env.date, 9, 0) + 987,
        at(env.date, 9, 45) + 765,
        827,
    )
    .await;
    let baseline = body(&env).await;
    let mut entries = format::parse_timers(&baseline);
    assert_eq!(entries[0].intervals.len(), 2);
    assert_eq!(
        entries[0].intervals[0].start_ms,
        entries[0].intervals[1].start_ms
    );
    entries[0].intervals.reverse();
    entries[0].intervals[0].end_ms = at(env.date, 10, 0);
    let edited = format::render_timers(&entries);
    apply(&env, &baseline, &edited, (0, 1, 0)).await;
    let after = rows(&env).await;
    assert_eq!(after.len(), 2);
    assert_eq!(after[0], unchanged);
    assert_eq!(after[1].id, id);
    assert_saved(
        &after[1],
        unchanged.item_id,
        at(env.date, 9, 0),
        at(env.date, 10, 0),
        3600,
    );
    replay(&env, &baseline, &edited).await;
}
