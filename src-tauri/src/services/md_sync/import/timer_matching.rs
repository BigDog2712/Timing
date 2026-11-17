use crate::repositories::md_sync::RecordWithItem;
use super::super::format::TimerInterval;

type Span = (i64, Option<i64>);

pub(super) struct TimerChanges {
    pub write: Vec<(Option<i64>, TimerInterval)>,
    pub delete: Vec<i64>,
}

pub(super) fn second(ms: i64) -> i64 {
    ms.div_euclid(1000) * 1000
}

fn coordinates(interval: &TimerInterval) -> Span {
    (interval.start_ms, Some(interval.end_ms))
}

fn pair(left: &[Span], right: &[Span], match_start: bool, fallback: bool) -> Vec<Option<usize>> {
    let mut taken = vec![false; right.len()];
    let mut claims = vec![None; left.len()];
    // 完整坐标优先，防止同秒开始的段互相抢占。
    for exact in [true, false] {
        if !exact && !match_start {
            continue;
        }
        for (slot, span) in left.iter().enumerate() {
            if claims[slot].is_some() {
                continue;
            }
            if let Some(row) = right.iter().enumerate().position(|(row, candidate)| {
                !taken[row] && if exact { span == candidate } else { span.0 == candidate.0 }
            }) {
                claims[slot] = Some(row);
                taken[row] = true;
            }
        }
    }
    if fallback {
        let mut remaining = taken.iter().enumerate().filter_map(|(row, taken)| (!taken).then_some(row));
        for claim in &mut claims {
            if claim.is_none() {
                *claim = remaining.next();
            }
        }
    }
    claims
}

pub(super) fn changes(
    db: &[RecordWithItem],
    old: &[TimerInterval],
    new: &[TimerInterval],
) -> TimerChanges {
    let baseline: Vec<_> = old.iter().map(coordinates).collect();
    let current: Vec<_> = new.iter().map(coordinates).collect();
    let stored: Vec<_> = db.iter().map(|row| (second(row.started_at), row.ended_at.map(second))).collect();
    let new_to_old = pair(&current, &baseline, true, true);
    let mut old_to_db = pair(&baseline, &stored, false, false);
    let mut used_old = vec![false; old.len()];
    let mut used_db = vec![false; db.len()];
    for row in old_to_db.iter().flatten() {
        used_db[*row] = true;
    }
    // 重试时完整的新坐标比旧 start 更可靠，先锁住已应用的编辑。
    let mut edited_old = vec![false; old.len()];
    for (slot, old_slot) in new_to_old.iter().enumerate() {
        let Some(old_slot) = old_slot else { continue; };
        edited_old[*old_slot] = current[slot] != baseline[*old_slot];
        if old_to_db[*old_slot].is_none() && edited_old[*old_slot] {
            if let Some(row) = stored.iter().enumerate().position(|(row, span)| !used_db[row] && *span == current[slot]) {
                old_to_db[*old_slot] = Some(row);
                used_db[row] = true;
            }
        }
    }
    for edited in [true, false] {
        for (slot, span) in baseline.iter().enumerate() {
            if old_to_db[slot].is_some() || edited_old[slot] != edited {
                continue;
            }
            if let Some(row) = stored.iter().enumerate().position(|(row, candidate)| !used_db[row] && span.0 == candidate.0) {
                old_to_db[slot] = Some(row);
                used_db[row] = true;
            }
        }
    }
    let mut claims = Vec::with_capacity(new.len());
    let mut unchanged = Vec::with_capacity(new.len());
    for (slot, old_slot) in new_to_old.iter().enumerate() {
        if let Some(old_slot) = old_slot {
            used_old[*old_slot] = true;
            claims.push(old_to_db[*old_slot]);
            unchanged.push(current[slot] == baseline[*old_slot]);
        } else {
            claims.push(None);
            unchanged.push(false);
        }
    }

    // 基线坐标已被编辑移走时，按新坐标识别重试；未编辑的缺失段不能复活。
    for exact in [true, false] {
        for (slot, span) in current.iter().enumerate() {
            if claims[slot].is_some() || unchanged[slot] || (!exact && new_to_old[slot].is_some()) {
                continue;
            }
            if let Some(row) = stored.iter().enumerate().position(|(row, candidate)| {
                !used_db[row] && if exact { span == candidate } else { span.0 == candidate.0 }
            }) {
                claims[slot] = Some(row);
                used_db[row] = true;
            }
        }
    }

    let mut result = TimerChanges { write: Vec::new(), delete: Vec::new() };
    for (slot, interval) in new.iter().enumerate() {
        if unchanged[slot] {
            continue;
        }
        match claims[slot] {
            Some(row) if stored[row] != current[slot] => {
                result.write.push((Some(db[row].id), *interval));
            }
            None => result.write.push((None, *interval)),
            _ => {}
        }
    }
    for (slot, row) in old_to_db.iter().enumerate() {
        if let Some(row) = row {
            // 删除只认仍与基线完整坐标相符的行，不能误删同秒新增或并发改动。
            if !used_old[slot] && baseline[slot] == stored[*row] {
                result.delete.push(db[*row].id);
            }
        }
    }
    result
}
