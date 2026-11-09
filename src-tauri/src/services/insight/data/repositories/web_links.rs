mod compact;
mod totals;
pub(crate) use compact::recent_snapshot_in_tx;

use crate::services::insight::data::sqlite_error::SqliteOperationError;
use crate::models::insight::web_links::{validate_rule, WebLinkRule, WebLinkRules, SETTING_PREFIX};
use serde::{Deserialize, Serialize};
use sqlx::{Sqlite, Transaction};
use std::collections::BTreeMap;

fn invalid(message: impl Into<String>) -> SqliteOperationError {
    SqliteOperationError::invalid_input("save website grouping", message)
}

#[cfg(test)]
#[path = "web_links_mod_tests.rs"]
mod tests;


#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Change {
    previous: Option<WebLinkRule>,
    next: Option<WebLinkRule>,
}

pub async fn apply_change(
    tx: &mut Transaction<'_, Sqlite>,
    key: &str,
    value: Option<&str>,
) -> Result<(), SqliteOperationError> {
    let root = key
        .strip_prefix(SETTING_PREFIX)
        .ok_or_else(|| invalid("invalid website key"))?;
    let value = value.ok_or_else(|| invalid("missing website change"))?;
    if value.len() > 2 * crate::models::insight::web_links::MAX_AUTOMATIC_RULE_BYTES + 64 {
        return Err(invalid("website change is too large"));
    }
    let change: Change =
        serde_json::from_str(value).map_err(|_| invalid("invalid website change"))?;
    if let Some(rule) = &change.next {
        if rule.version != 2 {
            return Err(invalid("only automatic website grouping can be saved"));
        }
        validate_rule(root, rule).map_err(invalid)?;
    }
    let current: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key=?")
        .bind(key)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| SqliteOperationError::from_sqlx("read website grouping", e))?;
    let current: Option<WebLinkRule> = current
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|_| invalid("stored website rule is invalid"))?;
    if current != change.previous && current != change.next {
        return Err(invalid("website grouping changed; reload before saving"));
    }
    if let Some(rule) = change.next {
        let value = serde_json::to_string(&rule).map_err(|e| invalid(e.to_string()))?;
        sqlx::query("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
            .bind(key).bind(value).execute(&mut **tx).await.map_err(|e| SqliteOperationError::from_sqlx("save website grouping", e))?;
    } else {
        sqlx::query("DELETE FROM settings WHERE key=?")
            .bind(key)
            .execute(&mut **tx)
            .await
            .map_err(|e| SqliteOperationError::from_sqlx("remove website grouping", e))?;
    }
    Ok(())
}

pub async fn load_in_tx(tx: &mut Transaction<'_, Sqlite>) -> Result<WebLinkRules, String> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT key,value FROM settings WHERE substr(key,1,12)='__web_site::'")
            .fetch_all(&mut **tx)
            .await
            .map_err(|e| format!("read website rules: {e}"))?;
    let mut rules = WebLinkRules::new();
    for (key, value) in rows {
        let root = key
            .strip_prefix(SETTING_PREFIX)
            .ok_or("invalid website key")?;
        let rule: WebLinkRule =
            serde_json::from_str(&value).map_err(|e| format!("invalid website rule: {e}"))?;
        validate_rule(root, &rule)?;
        rules.insert(root.to_string(), rule);
    }
    crate::models::insight::web_links::validate_rules(&rules)?;
    Ok(rules)
}

async fn migrate_domain_categories(
    tx: &mut Transaction<'_, Sqlite>,
    protected: &std::collections::BTreeSet<String>,
) -> Result<(), String> {
    const MARKER: &str = "__web_group_category_migrated_v2";
    let done: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM settings WHERE key=?)")
        .bind(MARKER)
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    if done {
        return Ok(());
    }
    let overrides = read_overrides_in_tx(tx).await?;
    if overrides
        .values()
        .any(|value| value.get("category").is_some())
    {
        let totals = totals::read_uncached(tx).await?;
        let mut rules = load_in_tx(tx).await?;
        let mut winners: BTreeMap<String, (String, i64)> = BTreeMap::new();
        for domain in totals.keys().chain(overrides.keys()) {
            let Some(root) = crate::models::insight::web_links::registrable_domain(domain) else {
                continue;
            };
            if protected.contains(&root)
                || rules
                    .get(&root)
                    .is_some_and(|rule| rule.exceptions.contains(domain))
            {
                continue;
            }
            let duration = totals.get(domain).copied().unwrap_or(0);
            let winner = winners
                .entry(root)
                .or_insert_with(|| (domain.clone(), duration));
            if duration > winner.1 || (duration == winner.1 && domain < &winner.0) {
                *winner = (domain.clone(), duration);
            }
        }
        for (root, (domain, _)) in winners {
            let Some(category) = overrides
                .get(&domain)
                .and_then(|v| v.get("category"))
                .and_then(|v| v.as_str())
            else {
                continue;
            };
            let rule = rules.entry(root.clone()).or_insert_with(|| WebLinkRule {
                version: 2,
                enabled: false,
                exceptions: Default::default(),
                members: None,
                auto_root: None,
                display_name: None,
                category: None,
                color: None,
            });
            rule.category = Some(category.to_owned());
            validate_rule(&root, rule)?;
            sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)")
                .bind(format!("{SETTING_PREFIX}{root}"))
                .bind(serde_json::to_string(rule).map_err(|e| e.to_string())?)
                .execute(&mut **tx)
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    sqlx::query("INSERT INTO settings(key,value) VALUES(?, 'true')")
        .bind(MARKER)
        .execute(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Convert supported older relationships atomically without touching activity facts.
pub async fn migrate_legacy_web_grouping(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    let protected: std::collections::BTreeSet<String> = load_in_tx(tx)
        .await?
        .into_iter()
        .filter(|(_, rule)| rule.version == 2)
        .map(|(root, _)| root)
        .collect();
    migrate_legacy_rules(tx).await?;
    migrate_domain_categories(tx, &protected).await
}

async fn migrate_legacy_rules(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    let previous = load_in_tx(tx).await?;
    if previous.values().all(|rule| rule.version == 2) {
        return Ok(());
    }
    // A local recovery copy retains old group-only presentation settings.
    sqlx::query("INSERT OR IGNORE INTO settings(key,value) VALUES('__web_grouping_backup_v2',?)")
        .bind(serde_json::to_string(&previous).map_err(|e| e.to_string())?)
        .execute(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    let mut next: WebLinkRules = previous
        .iter()
        .filter(|(_, rule)| rule.version == 2)
        .map(|(root, rule)| (root.clone(), rule.clone()))
        .collect();
    for (parent, rule) in &previous {
        if rule.version == 2 {
            continue;
        }
        if let Some(root) = crate::models::insight::web_links::registrable_domain(parent) {
            if let std::collections::btree_map::Entry::Vacant(entry) = next.entry(root.clone()) {
                let exceptions: std::collections::BTreeSet<String> = previous
                    .values()
                    .filter(|legacy| legacy.version == 0 && legacy.enabled)
                    .flat_map(|legacy| legacy.exceptions.iter())
                    .filter(|domain| {
                        crate::models::insight::web_links::registrable_domain(domain).as_deref()
                            == Some(&root)
                    })
                    .cloned()
                    .collect();
                if !exceptions.is_empty() {
                    let converted = serde_json::from_value(
                        serde_json::json!({"version":2,"exceptions":exceptions}),
                    )
                    .map_err(|e| e.to_string())?;
                    entry.insert(converted);
                }
            }
        }
    }
    for parent in previous.keys() {
        sqlx::query("DELETE FROM settings WHERE key=?")
            .bind(format!("{SETTING_PREFIX}{parent}"))
            .execute(&mut **tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    for (parent, rule) in next {
        validate_rule(&parent, &rule)?;
        sqlx::query("INSERT INTO settings(key,value) VALUES(?,?)")
            .bind(format!("{SETTING_PREFIX}{parent}"))
            .bind(serde_json::to_string(&rule).map_err(|e| e.to_string())?)
            .execute(&mut **tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebLinksSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anonymous_activity: Option<Vec<super::anonymous_activity::AnonymousActivityRecord>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segments: Option<Vec<WebActivityDetailSegment>>,
    pub rules: WebLinkRules,
    pub overrides: BTreeMap<String, serde_json::Value>,
    /// Domains with stored activity, independent of the recent candidate limit.
    pub domains: Vec<String>,
    pub roots: BTreeMap<String, String>,
    pub totals: BTreeMap<String, i64>,
    pub favicons: BTreeMap<String, String>,
}

pub async fn snapshot(pool: &sqlx::Pool<Sqlite>) -> Result<WebLinksSnapshot, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let snapshot = snapshot_in_tx(&mut tx).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(snapshot)
}

pub async fn snapshot_in_tx(tx: &mut Transaction<'_, Sqlite>) -> Result<WebLinksSnapshot, String> {
    let rules = load_in_tx(tx).await?;
    let overrides = read_overrides_in_tx(tx).await?;
    let totals = totals::read_cached(tx).await?;
    let domains: Vec<String> = totals.keys().cloned().collect();
    let roots = domains
        .iter()
        .chain(overrides.keys())
        .filter_map(|domain| {
            crate::models::insight::web_links::registrable_domain(domain).map(|root| (domain.clone(), root))
        })
        .collect();
    let favicons: Vec<(String, String)> = sqlx::query_as(
        "SELECT normalized_domain,favicon_url FROM web_favicon_cache WHERE trim(favicon_url) <> ''",
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    Ok(WebLinksSnapshot {
        anonymous_activity: None,
        segments: None,
        rules,
        overrides,
        domains,
        roots,
        totals,
        favicons: favicons.into_iter().collect(),
    })
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WebActivityDetailSegment {
    id: i64,
    browser_client_id: String,
    browser_kind: String,
    browser_exe_name: String,
    domain: String,
    normalized_domain: String,
    url: Option<String>,
    title: Option<String>,
    favicon_url: Option<String>,
    start_time: i64,
    end_time: i64,
    duration: i64,
}

pub async fn snapshot_range(
    pool: &sqlx::Pool<Sqlite>,
    start: i64,
    end: i64,
    now: i64,
) -> Result<WebLinksSnapshot, String> {
    if start < 0 || end <= start || now < 0 {
        return Err("invalid website detail range".into());
    }
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut snapshot = snapshot_in_tx(&mut tx).await?;
    snapshot.anonymous_activity = Some(
        super::anonymous_activity::read_range_tx(&mut tx, start, end)
            .await
            .map_err(|error| error.to_string())?
            .into_iter()
            .filter(|row| row.is_web)
            .collect(),
    );
    snapshot.segments = Some(read_segments_in_tx(&mut tx, start, end, now).await?);
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(snapshot)
}

async fn read_overrides_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
) -> Result<BTreeMap<String, serde_json::Value>, String> {
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT substr(key,24),value FROM settings WHERE substr(key,1,23)='__web_domain_override::'")
        .fetch_all(&mut **tx).await.map_err(|error| error.to_string())?;
    let overrides: BTreeMap<String, serde_json::Value> = rows
        .into_iter()
        .map(|(key, value)| {
            let value: serde_json::Value = serde_json::from_str(&value)
                .map_err(|error| format!("invalid website override: {error}"))?;
            if !value.is_object() {
                return Err("invalid website override object".to_string());
            }
            Ok((key, value))
        })
        .collect::<Result<_, String>>()?;
    Ok(overrides)
}

async fn read_segments_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    start: i64,
    end: i64,
    now: i64,
) -> Result<Vec<WebActivityDetailSegment>, String> {
    sqlx::query_as("SELECT id,browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,url,title,NULL AS favicon_url,start_time,COALESCE(end_time, MAX(start_time, MIN(?, updated_at+45000))) AS end_time,COALESCE(duration, MAX(0, MIN(?, updated_at+45000)-start_time)) AS duration FROM web_activity_segments WHERE start_time < ? AND COALESCE(end_time, MIN(?,updated_at+45000)) > ? ORDER BY start_time,id")
        .bind(now).bind(now).bind(end).bind(now).bind(start).fetch_all(&mut **tx).await.map_err(|error| error.to_string())
}
