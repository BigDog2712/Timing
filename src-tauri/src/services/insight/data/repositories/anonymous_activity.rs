use sqlx::{Pool, Row, Sqlite};

/// Anonymous facts intentionally have no foreign key to a named activity.
pub const SCHEMA_SQL: &str = "
CREATE TABLE IF NOT EXISTS anonymous_activity (
    id TEXT PRIMARY KEY NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    observed_until INTEGER NOT NULL,
    is_web INTEGER NOT NULL CHECK (is_web IN (0, 1)),
    CHECK (observed_until >= start_time),
    CHECK (end_time IS NULL OR end_time >= start_time)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_anonymous_activity_active
    ON anonymous_activity((1)) WHERE end_time IS NULL;
CREATE INDEX IF NOT EXISTS idx_anonymous_activity_range
    ON anonymous_activity(COALESCE(end_time, observed_until), start_time);
CREATE TABLE IF NOT EXISTS anonymous_activity_revision (
    id INTEGER PRIMARY KEY CHECK(id = 1), source_revision INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO anonymous_activity_revision(id, source_revision) VALUES(1, 0);
CREATE TRIGGER IF NOT EXISTS trg_anonymous_read_model_insert
AFTER INSERT ON anonymous_activity
BEGIN
    UPDATE anonymous_activity_revision SET source_revision = source_revision + 1 WHERE id = 1;
    UPDATE read_model_revision SET source_revision = source_revision + 1 WHERE id = 1;
    INSERT INTO activity_summary_dirty_ranges(start_ms, end_ms, generation, reason)
    VALUES (
        NEW.start_time - (((NEW.start_time % 3600000) + 3600000) % 3600000),
        MAX(NEW.start_time + 1, COALESCE(NEW.end_time, NEW.observed_until)) + ((3600000 - (((MAX(NEW.start_time + 1, COALESCE(NEW.end_time, NEW.observed_until)) % 3600000) + 3600000) % 3600000)) % 3600000),
        (SELECT source_revision FROM read_model_revision WHERE id = 1), 'native_insert'
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_anonymous_read_model_update
AFTER UPDATE ON anonymous_activity
BEGIN
    UPDATE anonymous_activity_revision SET source_revision = source_revision + 1 WHERE id = 1;
    UPDATE read_model_revision SET source_revision = source_revision + 1 WHERE id = 1;
    INSERT INTO activity_summary_dirty_ranges(start_ms, end_ms, generation, reason)
    SELECT
        MIN(OLD.start_time, NEW.start_time) - (((MIN(OLD.start_time, NEW.start_time) % 3600000) + 3600000) % 3600000),
        MAX(MIN(OLD.start_time, NEW.start_time) + 1, MAX(COALESCE(OLD.end_time, OLD.observed_until), COALESCE(NEW.end_time, NEW.observed_until))) + ((3600000 - (((MAX(MIN(OLD.start_time, NEW.start_time) + 1, MAX(COALESCE(OLD.end_time, OLD.observed_until), COALESCE(NEW.end_time, NEW.observed_until))) % 3600000) + 3600000) % 3600000)) % 3600000),
        (SELECT source_revision FROM read_model_revision WHERE id = 1), 'native_update'
    WHERE OLD.end_time IS NOT NULL OR NEW.end_time IS NOT NULL OR OLD.start_time != NEW.start_time;
END;

CREATE TRIGGER IF NOT EXISTS trg_anonymous_read_model_delete
AFTER DELETE ON anonymous_activity
BEGIN
    UPDATE anonymous_activity_revision SET source_revision = source_revision + 1 WHERE id = 1;
    UPDATE read_model_revision SET source_revision = source_revision + 1 WHERE id = 1;
    INSERT INTO activity_summary_dirty_ranges(start_ms, end_ms, generation, reason)
    VALUES (
        OLD.start_time - (((OLD.start_time % 3600000) + 3600000) % 3600000),
        MAX(OLD.start_time + 1, COALESCE(OLD.end_time, OLD.observed_until)) + ((3600000 - (((MAX(OLD.start_time + 1, COALESCE(OLD.end_time, OLD.observed_until)) % 3600000) + 3600000) % 3600000)) % 3600000),
        (SELECT source_revision FROM read_model_revision WHERE id = 1), 'native_delete'
    );
END;
";

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnonymousActivityRecord {
    pub id: String,
    pub start_time: i64,
    pub end_time: Option<i64>,
    pub observed_until: i64,
    pub is_web: bool,
}

pub async fn observe(pool: &Pool<Sqlite>, now_ms: i64, is_web: bool) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    super::sessions::end_active_sessions_tx(&mut tx, now_ms).await?;
    let active: Option<(String, i64, bool)> = sqlx::query_as(
        "SELECT id, observed_until, is_web FROM anonymous_activity WHERE end_time IS NULL",
    )
    .fetch_optional(&mut *tx)
    .await?;
    if let Some((id, observed_until, previous_web)) = active {
        if now_ms < observed_until {
            return Ok(false);
        }
        if previous_web == is_web {
            sqlx::query("UPDATE anonymous_activity SET observed_until = ? WHERE id = ?")
                .bind(now_ms)
                .bind(id)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            return Ok(false);
        }
        sqlx::query("UPDATE anonymous_activity SET end_time = ?, observed_until = ? WHERE id = ?")
            .bind(now_ms)
            .bind(now_ms)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("INSERT INTO anonymous_activity (id, start_time, observed_until, is_web) VALUES (?, ?, ?, ?)")
        .bind(uuid::Uuid::new_v4().to_string()).bind(now_ms).bind(now_ms).bind(is_web)
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn seal(pool: &Pool<Sqlite>, cutoff_ms: i64) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let changed = seal_tx(&mut tx, cutoff_ms).await?;
    tx.commit().await?;
    Ok(changed)
}

pub async fn seal_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    cutoff_ms: i64,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE anonymous_activity SET end_time = MAX(start_time, ?),
         observed_until = MAX(start_time, ?) WHERE end_time IS NULL",
    )
    .bind(cutoff_ms)
    .bind(cutoff_ms)
    .execute(&mut **tx)
    .await?;
    Ok(result.rows_affected() != 0)
}

pub async fn seal_web_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    cutoff_ms: i64,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE anonymous_activity SET end_time = MAX(start_time, ?),
         observed_until = MAX(start_time, ?) WHERE end_time IS NULL AND is_web = 1",
    )
    .bind(cutoff_ms)
    .bind(cutoff_ms)
    .execute(&mut **tx)
    .await?;
    Ok(result.rows_affected() != 0)
}

pub async fn seal_interrupted(pool: &Pool<Sqlite>, cutoff_ms: i64) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE anonymous_activity SET end_time = CASE WHEN observed_until BETWEEN start_time AND ? THEN observed_until ELSE start_time END WHERE end_time IS NULL",
    )
    .bind(cutoff_ms)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() != 0)
}

pub async fn is_available(pool: &Pool<Sqlite>) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'anonymous_activity')")
        .fetch_one(pool).await
}

pub async fn read_range(
    pool: &Pool<Sqlite>,
    start_ms: i64,
    end_ms: i64,
) -> Result<Vec<AnonymousActivityRecord>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let rows = read_range_tx(&mut tx, start_ms, end_ms).await?;
    tx.commit().await?;
    Ok(rows)
}

const RANGE_SQL: &str =
    "SELECT id, start_time, end_time, observed_until, is_web FROM anonymous_activity
         WHERE start_time < ? AND COALESCE(end_time, observed_until) > ?
           AND COALESCE(end_time, observed_until) > start_time
         ORDER BY start_time, id";

pub async fn read_range_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    start_ms: i64,
    end_ms: i64,
) -> Result<Vec<AnonymousActivityRecord>, sqlx::Error> {
    let rows = sqlx::query(RANGE_SQL)
        .bind(end_ms)
        .bind(start_ms)
        .fetch_all(&mut **tx)
        .await?;
    Ok(rows
        .into_iter()
        .map(|row| AnonymousActivityRecord {
            id: row.get("id"),
            start_time: row.get("start_time"),
            end_time: row.get("end_time"),
            observed_until: row.get("observed_until"),
            is_web: row.get("is_web"),
        })
        .collect())
}

pub async fn merge_for_restore(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    rows: &[AnonymousActivityRecord],
) -> Result<(), sqlx::Error> {
    for row in rows {
        // UUID is independent of identity. Existing records win when the same snapshot is merged again.
        sqlx::query(
            "INSERT INTO anonymous_activity(id, start_time, end_time, observed_until, is_web)
            VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
        )
        .bind(&row.id)
        .bind(row.start_time)
        .bind(row.end_time.unwrap_or(row.observed_until))
        .bind(row.observed_until)
        .bind(row.is_web)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "anonymous_activity_mod_tests.rs"]
mod tests;
