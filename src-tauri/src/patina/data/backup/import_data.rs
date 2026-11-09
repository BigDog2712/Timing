use sha2::{Digest, Sha256};
use sqlx::{Pool, Row, Sqlite, Transaction};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug)]
pub(super) struct ExternalImportBackup {
    batches: Vec<ExternalImportBatch>,
}

#[derive(Clone, Debug)]
struct ExternalImportBatch {
    id: String,
    imported_at: i64,
    source_name: String,
    source_kind: String,
    source_fingerprint: String,
    exact_sessions: Vec<ExternalExactSession>,
    time_buckets: Vec<ExternalTimeBucket>,
}

#[derive(Clone, Debug)]
struct ExternalExactSession {
    fingerprint: String,
    app_name: String,
    exe_name: String,
    window_title: String,
    start_time: i64,
    end_time: i64,
    duration: i64,
    source_category: Option<String>,
    source_path: Option<String>,
}

#[derive(Clone, Debug)]
struct ExternalTimeBucket {
    fingerprint: String,
    app_name: String,
    exe_name: String,
    bucket_start_time: i64,
    duration: i64,
    source_category: Option<String>,
    source_path: Option<String>,
}

pub(super) async fn load_external_import_backup_from_pool(
    pool: &Pool<Sqlite>,
) -> Result<ExternalImportBackup, String> {
    let batch_rows = sqlx::query(
        "SELECT id, imported_at, source_name, source_kind, source_fingerprint
         FROM import_batches
         ORDER BY imported_at ASC, id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to read backup import batches: {error}"))?;

    let mut exact_by_batch = HashMap::<String, Vec<ExternalExactSession>>::new();
    for record in sqlx::query(
        "SELECT batch_id, fingerprint, app_name, exe_name, window_title,
                start_time, end_time, duration, source_category, source_path
         FROM import_exact_sessions
         ORDER BY batch_id ASC, id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to read backup exact imports: {error}"))?
    {
        exact_by_batch
            .entry(record.get("batch_id"))
            .or_default()
            .push(ExternalExactSession {
                fingerprint: record.get("fingerprint"),
                app_name: record.get("app_name"),
                exe_name: record.get("exe_name"),
                window_title: record.get("window_title"),
                start_time: record.get("start_time"),
                end_time: record.get("end_time"),
                duration: record.get("duration"),
                source_category: record.get("source_category"),
                source_path: record.get("source_path"),
            });
    }
    let mut buckets_by_batch = HashMap::<String, Vec<ExternalTimeBucket>>::new();
    for record in sqlx::query(
        "SELECT batch_id, fingerprint, app_name, exe_name, bucket_start_time,
                duration, source_category, source_path
         FROM import_time_buckets
         ORDER BY batch_id ASC, id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to read backup hour imports: {error}"))?
    {
        buckets_by_batch
            .entry(record.get("batch_id"))
            .or_default()
            .push(ExternalTimeBucket {
                fingerprint: record.get("fingerprint"),
                app_name: record.get("app_name"),
                exe_name: record.get("exe_name"),
                bucket_start_time: record.get("bucket_start_time"),
                duration: record.get("duration"),
                source_category: record.get("source_category"),
                source_path: record.get("source_path"),
            });
    }

    let mut batches = Vec::with_capacity(batch_rows.len());
    for row in batch_rows {
        let id: String = row.get("id");
        batches.push(ExternalImportBatch {
            exact_sessions: exact_by_batch.remove(&id).unwrap_or_default(),
            time_buckets: buckets_by_batch.remove(&id).unwrap_or_default(),
            id,
            imported_at: row.get("imported_at"),
            source_name: row.get("source_name"),
            source_kind: row.get("source_kind"),
            source_fingerprint: row.get("source_fingerprint"),
        });
    }
    Ok(ExternalImportBackup { batches })
}

pub(super) async fn merge_external_import_backup_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    backup: &ExternalImportBackup,
) -> Result<(), String> {
    let mut known_exact_fingerprints = sqlx::query("SELECT fingerprint FROM import_exact_sessions")
        .fetch_all(&mut **tx)
        .await
        .map_err(|error| format!("failed to read current external exact identities: {error}"))?
        .into_iter()
        .map(|row| row.get::<String, _>("fingerprint"))
        .collect::<HashSet<_>>();
    let mut known_bucket_fingerprints = sqlx::query("SELECT fingerprint FROM import_time_buckets")
        .fetch_all(&mut **tx)
        .await
        .map_err(|error| format!("failed to read current external hour identities: {error}"))?
        .into_iter()
        .map(|row| row.get::<String, _>("fingerprint"))
        .collect::<HashSet<_>>();
    let mut known_batch_ids = sqlx::query("SELECT id FROM import_batches")
        .fetch_all(&mut **tx)
        .await
        .map_err(|error| format!("failed to read current import batch ids: {error}"))?
        .into_iter()
        .map(|row| row.get::<String, _>("id"))
        .collect::<HashSet<_>>();

    for batch in &backup.batches {
        let new_exact_sessions = batch
            .exact_sessions
            .iter()
            .filter(|record| known_exact_fingerprints.insert(record.fingerprint.clone()))
            .collect::<Vec<_>>();
        let new_time_buckets = batch
            .time_buckets
            .iter()
            .filter(|record| known_bucket_fingerprints.insert(record.fingerprint.clone()))
            .collect::<Vec<_>>();
        if new_exact_sessions.is_empty() && new_time_buckets.is_empty() {
            continue;
        }

        let target_batch_id = available_batch_id(batch, &known_batch_ids);
        known_batch_ids.insert(target_batch_id.clone());
        sqlx::query(
            "INSERT INTO import_batches (
                id, imported_at, source_name, source_kind, source_fingerprint,
                exact_session_count, hour_bucket_count
             ) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&target_batch_id)
        .bind(batch.imported_at)
        .bind(&batch.source_name)
        .bind(&batch.source_kind)
        .bind(&batch.source_fingerprint)
        .bind(new_exact_sessions.len() as i64)
        .bind(new_time_buckets.len() as i64)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to restore external import batch: {error}"))?;

        for record in new_exact_sessions {
            sqlx::query(
                "INSERT INTO import_exact_sessions (
                    batch_id, fingerprint, app_name, exe_name, window_title,
                    start_time, end_time, duration, source_category, source_path
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&target_batch_id)
            .bind(&record.fingerprint)
            .bind(&record.app_name)
            .bind(&record.exe_name)
            .bind(&record.window_title)
            .bind(record.start_time)
            .bind(record.end_time)
            .bind(record.duration)
            .bind(&record.source_category)
            .bind(&record.source_path)
            .execute(&mut **tx)
            .await
            .map_err(|error| format!("failed to restore external exact session: {error}"))?;
        }
        for record in new_time_buckets {
            sqlx::query(
                "INSERT INTO import_time_buckets (
                    batch_id, fingerprint, app_name, exe_name, bucket_start_time,
                    duration, source_category, source_path
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&target_batch_id)
            .bind(&record.fingerprint)
            .bind(&record.app_name)
            .bind(&record.exe_name)
            .bind(record.bucket_start_time)
            .bind(record.duration)
            .bind(&record.source_category)
            .bind(&record.source_path)
            .execute(&mut **tx)
            .await
            .map_err(|error| format!("failed to restore external hour bucket: {error}"))?;
        }
    }
    Ok(())
}

fn available_batch_id(batch: &ExternalImportBatch, known: &HashSet<String>) -> String {
    if !known.contains(&batch.id) {
        return batch.id.clone();
    }
    for attempt in 0_u64.. {
        let mut digest = Sha256::new();
        digest.update(b"patina-external-restore-batch");
        digest.update(batch.id.as_bytes());
        digest.update(batch.source_fingerprint.as_bytes());
        digest.update(attempt.to_le_bytes());
        let candidate = format!("restore-{:x}", digest.finalize());
        if !known.contains(&candidate) {
            return candidate;
        }
    }
    unreachable!("unbounded restore batch id search exhausted")
}

#[cfg(test)]
#[path = "import_data_mod_tests.rs"]
mod tests;
