//! Recoverable propagation of category-key changes across the business and activity databases.

mod plan;
mod replay;
use crate::services::activity::data::sqlite_pool::{registered_sqlite_pool, wait_for_sqlite_pool};
use plan::build_journal;
use replay::replay;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use sqlx::{Pool, Sqlite};
use std::collections::BTreeMap;
use tauri::{AppHandle, Runtime};

const JOURNAL_PREFIX: &str = "__category_propagation_journal::";
const MAX_MAPPING_ENTRIES: usize = 256;
const MAX_CATEGORY_KEY_CHARS: usize = 256;
const MAX_CATEGORY_KEY_BYTES: usize = 1024;
const MAX_MAPPING_BYTES: usize = 64 * 1024;

fn validate_request(request: &CategoryPropagationRequest) -> Result<(), String> {
    let valid_id = !request.operation_id.is_empty()
        && request.operation_id.len() <= 80
        && request
            .operation_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-');
    if !valid_id || request.mapping.is_empty() || request.mapping.len() > MAX_MAPPING_ENTRIES {
        return Err("invalid category propagation request".into());
    }
    if serde_json::to_vec(&request.mapping)
        .map_err(|_| "invalid mapping".to_string())?
        .len()
        > MAX_MAPPING_BYTES
    {
        return Err("category propagation mapping payload is too large".into());
    }
    for (source, target) in &request.mapping {
        for value in [Some(source.as_str()), target.as_deref()]
            .into_iter()
            .flatten()
        {
            let valid = !value.trim().is_empty()
                && value.chars().count() <= MAX_CATEGORY_KEY_CHARS
                && value.len() <= MAX_CATEGORY_KEY_BYTES
                && !value.chars().any(char::is_control);
            if !valid {
                return Err(
                    "category keys are empty, too long, or contain control characters".into(),
                );
            }
        }
    }
    Ok(())
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryPropagationRequest {
    pub operation_id: String,
    pub mapping: BTreeMap<String, Option<String>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct ItemChange {
    pub(super) id: i64,
    pub(super) before: Option<String>,
    pub(super) after: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct ActivityMutation {
    pub(super) key: String,
    pub(super) before: Option<String>,
    pub(super) after: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct RowChange {
    pub(super) table: String,
    pub(super) id: i64,
    pub(super) before: String,
    pub(super) after: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryPropagationConflict {
    pub table: String,
    pub source_id: i64,
    pub occupant_id: i64,
    pub app_key: Option<String>,
    pub category_key: Option<String>,
    pub block_uid: Option<String>,
    pub seg_start: Option<i64>,
    pub target_value: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct Journal {
    pub(super) operation_id: String,
    pub(super) fingerprint: String,
    pub(super) items: Vec<ItemChange>,
    pub(super) settings: Vec<ActivityMutation>,
    pub(super) rows: Vec<RowChange>,
    pub(super) conflicts: Vec<CategoryPropagationConflict>,
    pub(super) phase: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryPropagationPreview {
    pub fingerprint: String,
    pub affected_items: usize,
    pub affected_activity_settings: usize,
    pub affected_bindings: usize,
    pub affected_overrides: usize,
    pub conflicts: Vec<CategoryPropagationConflict>,
}

pub async fn preview<R: Runtime>(
    app: &AppHandle<R>,
    business: &Pool<Sqlite>,
    request: &CategoryPropagationRequest,
) -> Result<CategoryPropagationPreview, String> {
    validate_request(request)?;
    let activity = wait_for_sqlite_pool(app).await?;
    let journal = build_journal(business, &activity, request).await?;
    Ok(CategoryPropagationPreview {
        fingerprint: journal.fingerprint,
        affected_items: journal.items.len(),
        affected_activity_settings: journal.settings.len(),
        affected_bindings: journal
            .rows
            .iter()
            .filter(|row| row.table == "app_category")
            .count(),
        affected_overrides: journal
            .rows
            .iter()
            .filter(|row| row.table == "block_segment_override")
            .count(),
        conflicts: journal.conflicts,
    })
}

pub async fn apply<R: Runtime>(
    app: &AppHandle<R>,
    business: &Pool<Sqlite>,
    request: &CategoryPropagationRequest,
    expected_fingerprint: &str,
) -> Result<(), String> {
    validate_request(request)?;
    let activity = wait_for_sqlite_pool(app).await?;
    let journal_key = format!("{JOURNAL_PREFIX}{}", request.operation_id);
    let existing_raw: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key=?")
        .bind(&journal_key)
        .fetch_optional(business)
        .await
        .map_err(|error| error.to_string())?;
    let mut journal = if let Some(existing) = existing_raw {
        let journal: Journal = serde_json::from_str(&existing)
            .map_err(|error| format!("invalid existing propagation journal: {error}"))?;
        if journal.fingerprint != expected_fingerprint {
            return Err(
                "category propagation operation id already exists with a different fingerprint"
                    .into(),
            );
        }
        if journal.phase == "completed" {
            return Ok(());
        }
        journal
    } else {
        let journal = build_journal(business, &activity, request).await?;
        if journal.fingerprint != expected_fingerprint {
            return Err("category propagation preview is stale".into());
        }
        if !journal.conflicts.is_empty() {
            return Err(format!(
                "category propagation conflicts: {:?}",
                journal.conflicts
            ));
        }
        let encoded = serde_json::to_string(&journal).map_err(|error| error.to_string())?;
        sqlx::query("INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)")
            .bind(&journal_key)
            .bind(encoded)
            .bind(crate::platform::clock::now_ms())
            .execute(business)
            .await
            .map_err(|error| error.to_string())?;
        journal
    };
    replay(app, business, &activity, &mut journal).await?;
    crate::services::activity::data::focus_blocks::project(business, &activity, None)
        .await
        .map_err(|error| format!("category propagation projection failed: {error}"))?;
    sqlx::query("DELETE FROM settings WHERE key=?")
        .bind(journal_key)
        .execute(business)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub async fn recover<R: Runtime>(
    app: &AppHandle<R>,
    business: &Pool<Sqlite>,
) -> Result<bool, String> {
    let mut recovered = false;
    let activity = match registered_sqlite_pool(app).await {
        Some(pool) => pool,
        None => {
            crate::log_warn!(
                "category propagation recovery deferred: activity database is unavailable"
            );
            return Ok(false);
        }
    };
    let rows = sqlx::query("SELECT key,value FROM settings WHERE key LIKE ? ORDER BY key")
        .bind(format!("{JOURNAL_PREFIX}%"))
        .fetch_all(business)
        .await
        .map_err(|error| error.to_string())?;
    for row in rows {
        let key: String = row.get("key");
        let raw: String = row.get("value");
        let mut journal: Journal = serde_json::from_str(&raw)
            .map_err(|error| format!("invalid propagation journal {key}: {error}"))?;
        replay(app, business, &activity, &mut journal).await?;
        crate::services::activity::data::focus_blocks::project(business, &activity, None)
            .await
            .map_err(|error| format!("category propagation projection failed: {error}"))?;
        sqlx::query("DELETE FROM settings WHERE key=?")
            .bind(key)
            .execute(business)
            .await
            .map_err(|error| error.to_string())?;
        recovered = true;
    }
    Ok(recovered)
}
