//! 计时区块的导入：把「文件差异」落成 `time_records` 的增删改。
//!
//! 从 `import.rs` 拆出（单文件 ≤300 行纪律）：本文件只放计时，与 SQL 对位有关的
//! 判断集中在这里；`apply_notes` 与共享工具留在父模块。
//!
//! ## 两种段
//!
//! - **真实段**：`(start, end)` 就是事实，正常对位入库；
//! - **实时占位段**：宿主为「正在计时」写出的渲染近似值（`ongoing: true`，`end` 只是
//!   渲染时刻对齐到整分钟）。它不是数据，不能入库。
//!
//! 关键：**不能看见 `ongoing: true` 就剔**。用户手写这个标记时，那条时间是他的真实
//! 记录，静默剔掉等于删数据（P2 修的就是这个）。判据是「这是不是宿主写出的坐标」——
//! 见 `trusted_placeholders`：命中才剔，未命中把标记降级为普通段，时间照常入库。
//!
//! ## `duration:` 不参与导入
//!
//! 导出时每段会多写一行 `duration: 46m06s`（真实累计，给人看的）。导入一律先
//! `strip_durations`：落库的 `accumulated_sec` 仍由 `(start, end)` 反推，与这一行无关。
//! 不清掉的话，用户手改该行就造出假差异，把 `old == new` 的早退打掉。
//!
//! ## 删除口径：只删「基线里出现过、现在没了」的那一段
//!
//! 比较单位是 `(事项, 开始时刻)`，既不是「第几段」也不是「数量」：
//!
//! - 基线里有、现在没有 → 用户删掉了 → 软删；
//! - 基线里没有 → 不可能是用户删的 → 一律不动。
//!
//! 曾经的 `db.iter().skip(intervals.len())` 是**按数量截断**：基线里那段还在
//! `ongoing`（没有 end，因此不在基线的段集合里），用户恰好在同一 tick 里停止计时并
//! 改了文件，刚停止的那条就顶到数量之外被软删——文件侧也已重渲染，两个方向都无迹可寻。

use std::collections::{HashMap, HashSet};

use chrono::NaiveDate;
use sqlx::SqlitePool;

use crate::error::AppResult;
use crate::platform::clock::now_ms;
use crate::repositories::md_sync as repo;

use super::super::format::{self, TimerEntry};
use super::{ensure_item, normalize_item_name, ImportStats};

/// 应用计时区块的编辑。
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

    /* trusted 必须在剔段**之前**算：它的来源之一是基线里带标记的段。 */
    let trusted = trusted_placeholders(pool, &old, from, to).await?;
    drop_placeholders(&mut old, &trusted);
    drop_placeholders(&mut new, &trusted);
    if old == new {
        return Ok(ImportStats::default());
    }

    let rows = repo::records_for_day(pool, from, to).await?;
    let mut db_by_name: HashMap<String, Vec<repo::RecordWithItem>> = HashMap::new();
    for row in rows {
        db_by_name
            .entry(row.item_name.clone())
            .or_default()
            .push(row);
    }

    let now = now_ms();
    let mut stats = ImportStats::default();
    let mut cache = HashMap::new();
    /* 本轮被「文件里第 N 段」认领过的记录：它们的 `started_at` 可能刚被用户改掉，
    旧值不再代表现状，删除判定必须放过它们。 */
    let mut paired: HashSet<i64> = HashSet::new();

    for entry in &new {
        let name = normalize_item_name(&entry.item);
        let item_id = ensure_item(pool, &name, &mut cache).await?;
        let db = db_by_name.entry(name).or_default();
        let mut intervals = entry.intervals.clone();
        intervals.sort_by_key(|interval| interval.start_ms);
        let claims = claim_rows(db, &intervals, &paired);

        for (slot, interval) in intervals.iter().enumerate() {
            let accumulated = ((interval.end_ms - interval.start_ms) / 1000).max(1);
            match claims[slot] {
                Some(row) => {
                    let record = &db[row];
                    paired.insert(record.id);
                    if record.started_at != interval.start_ms
                        || record.ended_at != Some(interval.end_ms)
                        || record.accumulated_sec != accumulated
                    {
                        repo::update_record_times(
                            pool,
                            record.id,
                            interval.start_ms,
                            interval.end_ms,
                            accumulated,
                            now,
                        )
                        .await?;
                        stats.updated += 1;
                    }
                }
                None => {
                    repo::insert_saved_record(
                        pool,
                        item_id,
                        interval.start_ms,
                        interval.end_ms,
                        accumulated,
                        now,
                    )
                    .await?;
                    stats.created += 1;
                }
            }
        }
    }

    /* 统一删除：组内删掉一段与整组消失是同一条规则（消失 = `new_starts` 为空）。 */
    for (name, records) in &db_by_name {
        let old_starts = starts_of(&old, name);
        if old_starts.is_empty() {
            continue;
        }
        let new_starts = starts_of(&new, name);
        for record in records {
            if !old_starts.contains(&record.started_at)
                || new_starts.contains(&record.started_at)
                || paired.contains(&record.id)
            {
                continue;
            }
            if repo::soft_delete_records(pool, &[record.id], now).await? > 0 {
                stats.deleted += 1;
            }
        }
    }

    Ok(stats)
}

/// 把「文件里的段」认领到「库里同事项的行」上；返回每段的行下标（`None` = 库里没有可用的行，要新建）。
///
/// ## 两轮配对（顺序不能换）
///
/// 1. **`started_at` 精确匹配**：开始时刻相同就是同一段，最可靠。用户删掉某一段时，
///    剩下的段靠精确匹配各自认回自己的行，被删的那行留在「未认领」里交给删除块。
/// 2. **按顺序兜底**：第 1 轮没配上的段（用户改了 `start`）按顺序配给尚未认领的行。
///
/// 为什么不能只用索引（旧写法 `db.get(index)`）：用户删掉第一段时，索引会把「第 2 段」
/// 写到原来第一段那行上，两行 `started_at` 撞车；而且从下一轮起 `file == expected`
/// 命中短路，撞出来的重复**永远不会自愈**（QA 复现：库内 `[09:00, 11:00, 11:00]`）。
/// 为什么不能只做精确匹配：用户改 `start` 时不会命中，会插出一条新记录、旧行留成孤儿
/// ——兜底那轮必须保留；配对成功的行由 `paired` 保护，删除块不会再动它。
fn claim_rows(
    db: &[repo::RecordWithItem],
    intervals: &[format::TimerInterval],
    paired: &HashSet<i64>,
) -> Vec<Option<usize>> {
    let mut taken = vec![false; db.len()];
    let mut claims: Vec<Option<usize>> = vec![None; intervals.len()];
    /* 未被认领、也不属于别的清单项：只有这样的行才能被配。 */
    let reusable = |row: usize, taken: &[bool]| !taken[row] && !paired.contains(&db[row].id);

    /* 第 1 轮：开始时刻精确匹配。 */
    for (slot, interval) in intervals.iter().enumerate() {
        for row in 0..db.len() {
            if !reusable(row, &taken) || db[row].started_at != interval.start_ms {
                continue;
            }
            claims[slot] = Some(row);
            taken[row] = true;
            break;
        }
    }

    /* 第 2 轮：剩下的段按顺序配给尚未认领的行（用户改了开始时刻的情况）。 */
    let mut cursor = 0usize;
    for claim in claims.iter_mut() {
        if claim.is_some() {
            continue;
        }
        while cursor < db.len() && !reusable(cursor, &taken) {
            cursor += 1;
        }
        if cursor < db.len() {
            *claim = Some(cursor);
            taken[cursor] = true;
            cursor += 1;
        }
    }
    claims
}

/// 宿主自己写出的实时段坐标：`(事项名, 开始时刻)`。
///
/// 两个来源取并集，覆盖所有「这段是本宿主上一轮写的、不是用户手写」的情况：
///
/// - **(a) 基线里带 `ongoing` 的段**：覆盖「上一轮刚写出、这一轮用户恰好点了停止」
///   的竞态。此刻库里已经没有 active 行，只看数据库会把它当成用户手写的数据；
/// - **(b) 库里当前的 active 行**：覆盖「基线为空」（进程刚重启 / 本机首次同步）的首轮。
///
/// 只用一个来源都会留洞，所以是并集；`strip` 的判据与「库里有几条记录」无关，
/// 用户手写的标记不会命中任何一条。
async fn trusted_placeholders(
    pool: &SqlitePool,
    old: &[TimerEntry],
    from: i64,
    to: i64,
) -> AppResult<HashSet<(String, i64)>> {
    let mut trusted: HashSet<(String, i64)> = HashSet::new();
    for entry in old {
        let name = normalize_item_name(&entry.item);
        for interval in entry.intervals.iter().filter(|interval| interval.ongoing) {
            trusted.insert((name.clone(), interval.start_ms));
        }
    }
    if let Some(active) = repo::active_record_in_day(pool, from, to).await? {
        trusted.insert((normalize_item_name(&active.item_name), active.started_at));
    }
    Ok(trusted)
}

/// 剔掉宿主写出的实时占位段；**不命中 trusted 的 `ongoing` 降级为普通段**。
///
/// 降级而不是剔除，是因为无法证明它是宿主写的：宁可多记一段用户真写下的时间，
/// 也不能把他的记录静默删掉。
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
            interval.ongoing = false;
            true
        });
    }
    entries.retain(|entry| !entry.intervals.is_empty());
}

/// 某事项在给定区块里的全部开始时刻（删除判定的唯一键）。
fn starts_of(entries: &[TimerEntry], name: &str) -> HashSet<i64> {
    entries
        .iter()
        .filter(|entry| normalize_item_name(&entry.item) == name)
        .flat_map(|entry| entry.intervals.iter().map(|interval| interval.start_ms))
        .collect()
}
