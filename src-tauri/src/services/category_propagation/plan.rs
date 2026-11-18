use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{Pool, Row, Sqlite};
use std::collections::BTreeMap;

use super::{
    ActivityMutation, CategoryPropagationConflict, CategoryPropagationRequest, ItemChange, Journal,
    RowChange,
};

const APP_OVERRIDE_PREFIX: &str = "__app_override::";
const WEB_OVERRIDE_PREFIX: &str = "__web_domain_override::";

pub(super) async fn build_journal(
    business: &Pool<Sqlite>,
    activity: &Pool<Sqlite>,
    request: &CategoryPropagationRequest,
) -> Result<Journal, String> {
    let mut items = Vec::new();
    let mut rows = Vec::new();
    let mut settings = Vec::new();
    let sources = request.mapping.keys().cloned().collect::<Vec<_>>();
    let source_json = serde_json::to_string(&sources).map_err(|error| error.to_string())?;
    let item_rows = sqlx::query("SELECT id, category_key FROM items WHERE category_key IN (SELECT value FROM json_each(?)) ORDER BY id")
        .bind(&source_json).fetch_all(business).await.map_err(|error| error.to_string())?;
    for row in item_rows {
        let id: i64 = row.get("id");
        let before: Option<String> = row.get("category_key");
        let after = match before.as_ref().and_then(|key| request.mapping.get(key)) {
            Some(target) => target.clone(),
            None => before.clone(),
        };
        items.push(ItemChange { id, before, after });
    }
    for (table, id_column) in [("app_category", "id"), ("block_segment_override", "id")] {
        let sql = format!("SELECT {id_column} AS id, category_key FROM {table} WHERE category_key IN (SELECT value FROM json_each(?)) ORDER BY id");
        let found = sqlx::query(&sql)
            .bind(&source_json)
            .fetch_all(activity)
            .await
            .map_err(|error| error.to_string())?;
        for row in found {
            let id: i64 = row.get("id");
            let before: String = row.get("category_key");
            let after = request
                .mapping
                .get(&before)
                .cloned()
                .unwrap_or_else(|| Some(before.clone()));
            rows.push(RowChange {
                table: table.into(),
                id,
                before,
                after,
            });
        }
    }
    let setting_rows =
        sqlx::query("SELECT key, value FROM settings WHERE key LIKE ? OR key LIKE ? ORDER BY key")
            .bind(format!("{APP_OVERRIDE_PREFIX}%"))
            .bind(format!("{WEB_OVERRIDE_PREFIX}%"))
            .fetch_all(activity)
            .await
            .map_err(|error| error.to_string())?;
    for row in setting_rows {
        let key: String = row.get("key");
        let before: String = row.get("value");
        if let Some(after) = rewrite_override(&key, &before, &request.mapping)? {
            settings.push(ActivityMutation {
                key,
                before: Some(before),
                after: Some(after),
            });
        }
    }
    let conflicts = find_conflicts(activity, &rows).await?;
    let fingerprint = fingerprint(&request.mapping, &items, &settings, &rows, &conflicts)?;
    Ok(Journal {
        operation_id: request.operation_id.clone(),
        fingerprint,
        items,
        settings,
        rows,
        conflicts,
        phase: "prepared".into(),
    })
}

fn rewrite_override(
    key: &str,
    raw: &str,
    mapping: &BTreeMap<String, Option<String>>,
) -> Result<Option<String>, String> {
    let is_app = key.starts_with(APP_OVERRIDE_PREFIX);
    let mut value: Value =
        serde_json::from_str(raw).map_err(|error| format!("invalid override {key}: {error}"))?;
    let mut changed = false;
    if let Some(object) = value.as_object_mut() {
        for field in if is_app {
            &["category", "categories"][..]
        } else {
            &["category"][..]
        } {
            if let Some(current) = object
                .get(*field)
                .and_then(Value::as_str)
                .map(str::to_owned)
            {
                if let Some(target) = mapping.get(&current) {
                    if let Some(target) = target {
                        object.insert((*field).into(), Value::String(target.clone()));
                    } else {
                        object.remove(*field);
                    }
                    changed = true;
                }
            }
        }
        if is_app {
            let next = object
                .get("categories")
                .and_then(Value::as_array)
                .map(|values| {
                    let mut seen = std::collections::HashSet::new();
                    values
                        .iter()
                        .filter_map(|entry| {
                            let raw = entry.as_str()?;
                            let mapped = match mapping.get(raw) {
                                Some(Some(target)) => target.as_str(),
                                Some(None) => return None,
                                None => raw,
                            };
                            seen.insert(mapped.to_string())
                                .then(|| Value::String(mapped.to_string()))
                        })
                        .collect::<Vec<_>>()
                });
            if let Some(next) = next {
                if object.get("categories") != Some(&Value::Array(next.clone())) {
                    changed = true;
                }
                if let Some(first) = next.first().and_then(Value::as_str) {
                    object.insert("category".into(), Value::String(first.into()));
                } else {
                    object.remove("category");
                }
                object.insert("categories".into(), Value::Array(next));
            }
        }
    }
    if changed {
        serde_json::to_string(&value)
            .map(Some)
            .map_err(|error| error.to_string())
    } else {
        Ok(None)
    }
}

async fn find_conflicts(
    activity: &Pool<Sqlite>,
    changes: &[RowChange],
) -> Result<Vec<CategoryPropagationConflict>, String> {
    let mut conflicts = Vec::new();
    for change in changes {
        let Some(target) = &change.after else {
            continue;
        };
        if change.table == "app_category" {
            let source: Option<String> =
                sqlx::query_scalar("SELECT app_key FROM app_category WHERE id=?")
                    .bind(change.id)
                    .fetch_optional(activity)
                    .await
                    .map_err(|error| error.to_string())?;
            let Some(app_key) = source else {
                continue;
            };
            let occupants = sqlx::query(
                "SELECT id,app_key,category_key FROM app_category WHERE app_key=? AND category_key=? AND id<>? ORDER BY id",
            )
            .bind(&app_key)
            .bind(target)
            .bind(change.id)
            .fetch_all(activity)
            .await
            .map_err(|error| error.to_string())?;
            for occupant in occupants {
                let occupant_id: i64 = occupant.get("id");
                let occupant_category: String = occupant.get("category_key");
                let occupant_after = changes
                    .iter()
                    .find(|candidate| {
                        candidate.table == "app_category" && candidate.id == occupant_id
                    })
                    .map(|candidate| candidate.after.as_deref())
                    .unwrap_or(Some(occupant_category.as_str()));
                if occupant_after == Some(target.as_str()) {
                    conflicts.push(CategoryPropagationConflict {
                        table: "app_category".into(),
                        source_id: change.id,
                        occupant_id,
                        app_key: Some(occupant.get("app_key")),
                        category_key: Some(occupant.get("category_key")),
                        block_uid: None,
                        seg_start: None,
                        target_value: Some(target.clone()),
                    });
                }
            }
        }
    }
    conflicts.sort_by(|left, right| {
        (
            &left.table,
            left.source_id,
            left.occupant_id,
            &left.target_value,
        )
            .cmp(&(
                &right.table,
                right.source_id,
                right.occupant_id,
                &right.target_value,
            ))
    });
    conflicts.dedup_by(|left, right| {
        left.table == right.table
            && left.source_id == right.source_id
            && left.occupant_id == right.occupant_id
            && left.target_value == right.target_value
    });
    Ok(conflicts)
}

fn fingerprint(
    mapping: &BTreeMap<String, Option<String>>,
    items: &[ItemChange],
    settings: &[ActivityMutation],
    rows: &[RowChange],
    conflicts: &[CategoryPropagationConflict],
) -> Result<String, String> {
    let raw = serde_json::to_vec(&(mapping, items, settings, rows, conflicts))
        .map_err(|error| error.to_string())?;
    Ok(format!("{:x}", Sha256::digest(raw)))
}

#[cfg(test)]
mod tests {
    use super::rewrite_override;
    use std::collections::BTreeMap;

    #[test]
    fn merge_deduplicates_bindings_and_preserves_unknown_fields() {
        let mapping = BTreeMap::from([("old".to_string(), Some("new".to_string()))]);
        let raw = r#"{"category":"old","categories":["old","new","keep"],"track":false,"future":{"x":1}}"#;
        let result = rewrite_override("__app_override::app.exe", raw, &mapping)
            .expect("valid override")
            .expect("mapping changes value");
        let value: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(value["category"], "new");
        assert_eq!(value["categories"], serde_json::json!(["new", "keep"]));
        assert_eq!(value["track"], false);
        assert_eq!(value["future"]["x"], 1);
    }

    #[test]
    fn delete_removes_category_and_keeps_other_override_data() {
        let mapping = BTreeMap::from([("old".to_string(), None)]);
        let raw = r#"{"category":"old","enabled":false,"future":2}"#;
        let result = rewrite_override("__web_domain_override::example.test", raw, &mapping)
            .expect("valid override")
            .expect("mapping changes value");
        let value: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert!(value.get("category").is_none());
        assert_eq!(value["enabled"], false);
        assert_eq!(value["future"], 2);
    }
}
