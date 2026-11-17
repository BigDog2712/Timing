//! 只导入文件相对基线的计时编辑；Markdown 的秒级坐标不是数据库行身份。

use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::NaiveDate;
use sqlx::SqlitePool;

use crate::error::AppResult;
use crate::platform::clock::now_ms;
use crate::repositories::md_sync as repo;

use super::super::format::{self, TimerEntry, TimerInterval};
use super::timer_matching::{changes, second};
use super::{ensure_item, normalize_item_name, ImportStats};

pub async fn apply_timers(
    pool: &SqlitePool,
    date: NaiveDate,
    old_body: &str,
    new_body: &str,
) -> AppResult<ImportStats> {
    let mut old = format::parse_timers(old_body);
    let mut new = format::parse_timers(new_body);
    format::strip_durations(&mut old);
    format::strip_durations(&mut new);
    let (from, to) = format::day_bounds(date);
    let trusted = trusted_placeholders(pool, &old, from, to).await?;
    drop_placeholders(&mut old, &trusted);
    drop_placeholders(&mut new, &trusted);
    let old = grouped(old);
    let mut new = grouped(new);
    if old == new {
        return Ok(ImportStats::default());
    }
    for name in old.keys() {
        new.entry(name.clone()).or_default();
    }

    let mut db_by_name: HashMap<String, Vec<repo::RecordWithItem>> = HashMap::new();
    for row in repo::records_for_day(pool, from, to).await? {
        db_by_name.entry(normalize_item_name(&row.item_name)).or_default().push(row);
    }
    let now = now_ms();
    let mut stats = ImportStats::default();
    let mut cache = HashMap::new();
    for (name, intervals) in new {
        let plan = changes(
            db_by_name.get(&name).map_or(&[], Vec::as_slice),
            old.get(&name).map_or(&[], Vec::as_slice),
            &intervals,
        );
        for (id, interval) in plan.write {
            let accumulated = ((interval.end_ms - interval.start_ms) / 1000).max(1);
            match id {
                Some(id) => {
                    repo::update_record_times(pool, id, interval.start_ms, interval.end_ms, accumulated, now).await?;
                    stats.updated += 1;
                }
                None => {
                    let item_id = ensure_item(pool, &name, &mut cache).await?;
                    repo::insert_saved_record(pool, item_id, interval.start_ms, interval.end_ms, accumulated, now).await?;
                    stats.created += 1;
                }
            }
        }
        stats.deleted += repo::soft_delete_records(pool, &plan.delete, now).await? as u32;
    }
    Ok(stats)
}

fn grouped(entries: Vec<TimerEntry>) -> BTreeMap<String, Vec<TimerInterval>> {
    let mut groups: BTreeMap<String, Vec<TimerInterval>> = BTreeMap::new();
    for entry in entries {
        groups.entry(normalize_item_name(&entry.item)).or_default().extend(entry.intervals);
    }
    for intervals in groups.values_mut() {
        intervals.sort_by_key(|interval| (interval.start_ms, interval.end_ms));
    }
    groups
}

async fn trusted_placeholders(
    pool: &SqlitePool,
    old: &[TimerEntry],
    from: i64,
    to: i64,
) -> AppResult<HashSet<(String, i64)>> {
    let mut trusted = HashSet::new();
    // 基线中的占位段也必须保留证据：它可能刚在数据库里停止。
    for entry in old {
        let name = normalize_item_name(&entry.item);
        for interval in entry.intervals.iter().filter(|interval| interval.ongoing) {
            trusted.insert((name.clone(), interval.start_ms));
        }
    }
    if let Some(active) = repo::active_record_in_day(pool, from, to).await? {
        trusted.insert((normalize_item_name(&active.item_name), second(active.started_at)));
    }
    Ok(trusted)
}

fn drop_placeholders(entries: &mut Vec<TimerEntry>, trusted: &HashSet<(String, i64)>) {
    for entry in entries.iter_mut() {
        let name = normalize_item_name(&entry.item);
        entry.intervals.retain_mut(|interval| {
            if !interval.ongoing {
                return true;
            }
            if trusted.contains(&(name.clone(), interval.start_ms)) {
                return false;
            }
            // 未命中宿主坐标的手写 ongoing 是用户数据，不能丢弃。
            interval.ongoing = false;
            true
        });
    }
    entries.retain(|entry| !entry.intervals.is_empty());
}
