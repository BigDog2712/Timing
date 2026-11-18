use sqlx::{Pool, Row, Sqlite};
use tauri::{AppHandle, Runtime};

use super::{ActivityMutation, Journal, RowChange};
use crate::services::activity::data::repositories::classification_settings::{
    apply_classification_setting_mutations_in_tx, ClassificationSettingMutation,
};

const JOURNAL_PREFIX: &str = "__category_propagation_journal::";

pub(super) async fn replay<R: Runtime>(
    app: &AppHandle<R>,
    business: &Pool<Sqlite>,
    activity: &Pool<Sqlite>,
    journal: &mut Journal,
) -> Result<(), String> {
    match journal.phase.as_str() {
        "prepared" | "activity_applied" | "business_applied" | "completed" => {}
        phase => {
            return Err(format!(
                "unknown category propagation journal phase: {phase}"
            ))
        }
    }
    if journal.phase == "prepared" {
        apply_activity(activity, business, journal).await?;
        journal.phase = "activity_applied".into();
        persist_phase(business, journal).await?;
    }
    if journal.phase == "activity_applied" {
        apply_business(business, journal).await?;
        journal.phase = "business_applied".into();
        persist_phase(business, journal).await?;
    }
    if journal.phase == "business_applied" {
        journal.phase = "completed".into();
        persist_phase(business, journal).await?;
    }
    let _ = app;
    Ok(())
}

async fn apply_activity(
    activity: &Pool<Sqlite>,
    business: &Pool<Sqlite>,
    journal: &Journal,
) -> Result<(), String> {
    let mut tx = activity.begin().await.map_err(|error| error.to_string())?;
    for change in &journal.rows {
        if change.table == "app_category" {
            apply_binding(&mut tx, change).await?;
        } else {
            apply_override(&mut tx, change).await?;
        }
    }
    validate_settings(&mut tx, &journal.settings).await?;
    let mutations = journal
        .settings
        .iter()
        .map(|mutation| ClassificationSettingMutation {
            key: mutation.key.clone(),
            value: mutation.after.clone(),
        })
        .collect::<Vec<_>>();
    apply_classification_setting_mutations_in_tx(&mut tx, &mutations)
        .await
        .map_err(|error| error.to_string())?;
    tx.commit().await.map_err(|error| error.to_string())?;
    let _ = business;
    Ok(())
}

async fn apply_binding(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    change: &RowChange,
) -> Result<(), String> {
    let row = sqlx::query("SELECT app_key,category_key FROM app_category WHERE id=?")
        .bind(change.id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| error.to_string())?;
    let Some(row) = row else {
        return Err(format!(
            "app category row {} was deleted after preview",
            change.id
        ));
    };
    let app_key: String = row.get("app_key");
    let current: String = row.get("category_key");
    if current != change.before && Some(current.clone()) != change.after {
        return Err("app category changed after preview".into());
    }
    if current != change.before {
        return Ok(());
    }
    let Some(target) = &change.after else {
        sqlx::query("DELETE FROM app_category WHERE id=?")
            .bind(change.id)
            .execute(&mut **tx)
            .await
            .map_err(|error| error.to_string())?;
        return Ok(());
    };
    let exists: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM app_category WHERE app_key=? AND category_key=? AND id<>?",
    )
    .bind(&app_key)
    .bind(target)
    .bind(change.id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;
    if exists.is_some() {
        return Err(format!("app category unique conflict: {app_key}:{target}"));
    }
    let now = crate::infra::activity::clock::unix_timestamp_millis_i64();
    sqlx::query("UPDATE app_category SET category_key=?,updated_at=?,updated_at_ms=MAX(?,updated_at_ms+1) WHERE id=?")
        .bind(target).bind(now).bind(now).bind(change.id)
        .execute(&mut **tx).await.map_err(|error| error.to_string())?;
    Ok(())
}

async fn apply_override(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    change: &RowChange,
) -> Result<(), String> {
    let current: Option<String> =
        sqlx::query_scalar("SELECT category_key FROM block_segment_override WHERE id=?")
            .bind(change.id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(|error| error.to_string())?;
    if current.is_none() {
        return Err(format!(
            "segment override row {} was deleted after preview",
            change.id
        ));
    }
    if current.as_deref() == Some(change.before.as_str()) {
        let now = crate::infra::activity::clock::unix_timestamp_millis_i64();
        sqlx::query("UPDATE block_segment_override SET category_key=?,updated_at=?,updated_at_ms=MAX(?,updated_at_ms+1) WHERE id=?")
            .bind(&change.after).bind(now).bind(now).bind(change.id)
            .execute(&mut **tx).await.map_err(|error| error.to_string())?;
    } else if current != change.after {
        return Err("segment override changed after preview".into());
    }
    Ok(())
}

async fn validate_settings(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    settings: &[ActivityMutation],
) -> Result<(), String> {
    for mutation in settings {
        let current: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key=?")
            .bind(&mutation.key)
            .fetch_optional(&mut **tx)
            .await
            .map_err(|error| error.to_string())?;
        if current != mutation.before && current != mutation.after {
            return Err(format!(
                "classification setting changed after preview: {}",
                mutation.key
            ));
        }
    }
    Ok(())
}

async fn apply_business(business: &Pool<Sqlite>, journal: &Journal) -> Result<(), String> {
    let mut tx = business.begin().await.map_err(|error| error.to_string())?;
    for change in &journal.items {
        let current: Option<String> =
            sqlx::query_scalar("SELECT category_key FROM items WHERE id=?")
                .bind(change.id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|error| error.to_string())?;
        if current == change.before {
            let now = crate::platform::clock::now_ms();
            sqlx::query("UPDATE items SET category_key=?,updated_at=?,updated_at_ms=MAX(?,updated_at_ms+1) WHERE id=?")
                .bind(&change.after)
                .bind(now)
                .bind(now)
                .bind(change.id)
                .execute(&mut *tx)
                .await
                .map_err(|error| error.to_string())?;
        } else if current != change.after {
            return Err("item category changed after preview".into());
        }
    }
    tx.commit().await.map_err(|error| error.to_string())?;
    Ok(())
}

pub(super) async fn persist_phase(
    business: &Pool<Sqlite>,
    journal: &Journal,
) -> Result<(), String> {
    let key = format!("{JOURNAL_PREFIX}{}", journal.operation_id);
    let value = serde_json::to_string(journal).map_err(|error| error.to_string())?;
    sqlx::query("UPDATE settings SET value=?,updated_at=? WHERE key=?")
        .bind(value)
        .bind(crate::platform::clock::now_ms())
        .bind(key)
        .execute(business)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}
