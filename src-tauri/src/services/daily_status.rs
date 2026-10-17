//! Per-day item completion state, independent of global items and pending todos.
use crate::{
    error::{AppError, AppResult},
    infra::clock::now_ms,
    repositories::{item, settings},
};
use sqlx::SqlitePool;
use std::collections::HashMap;

fn day_prefix(date: &str) -> AppResult<String> {
    if chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
        return Err(AppError::invalid_duration());
    }
    Ok(format!("daily-status.{date}."))
}

pub async fn get(pool: &SqlitePool, date: &str) -> AppResult<HashMap<i64, String>> {
    let prefix = day_prefix(date)?;
    Ok(settings::get_all(pool)
        .await?
        .into_iter()
        .filter_map(|(key, value)| {
            let id = key.strip_prefix(&prefix)?.parse::<i64>().ok()?;
            if value == "pending" || value == "done" {
                Some((id, value))
            } else {
                None
            }
        })
        .collect())
}

pub async fn set(pool: &SqlitePool, date: &str, item_id: i64, status: &str) -> AppResult<()> {
    let prefix = day_prefix(date)?;
    if status != "pending" && status != "done" {
        return Err(AppError::invalid_duration());
    }
    if item::find_by_id(pool, item_id).await?.is_none() {
        return Err(AppError::item_not_found());
    }
    settings::set_value(pool, &format!("{prefix}{item_id}"), status, now_ms()).await
}
