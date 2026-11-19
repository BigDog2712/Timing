use super::{FoldedBlock, TimerOp, TimerOpKind};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct RecordRevision {
    pub device_id: String,
    pub item_uid: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub accumulated_sec: i64,
    pub note: Option<String>,
    pub mode: String,
    pub target_sec: Option<i64>,
    pub deleted_at: Option<i64>,
}

impl RecordRevision {
    pub fn payload(&self) -> String {
        serde_json::json!({ "record_v1": self }).to_string()
    }

    fn valid(&self) -> bool {
        self.ended_at
            .checked_sub(self.started_at)
            .is_some_and(|span| span >= 0)
            && (0..=i64::MAX / 1000).contains(&self.accumulated_sec)
            && !self.device_id.is_empty()
            && !self.item_uid.is_empty()
            && matches!(self.mode.as_str(), "countup" | "countdown")
            && self.target_sec.is_none_or(|target| target > 0)
            && self
                .note
                .as_ref()
                .is_none_or(|note| note.chars().count() <= crate::models::constants::NOTE_MAX_LEN)
    }

    fn block(&self, op: &TimerOp) -> FoldedBlock {
        FoldedBlock {
            session_uid: op.session_uid.clone(),
            device_id: self.device_id.clone(),
            item_uid: self.item_uid.clone(),
            started_at_ms: self.started_at,
            ended_at_ms: Some(self.ended_at),
            accumulated_ms: self.accumulated_sec * 1000,
            running_since_ms: None,
            dropped: self.deleted_at.is_some(),
            item_switched: true,
            record: Some(self.clone()),
        }
    }
}

fn decode(op: &TimerOp) -> Option<Result<RecordRevision, ()>> {
    if op.kind != TimerOpKind::Adjust {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(op.payload.as_deref()?).ok()?;
    let record = value.get("record_v1")?;
    Some(
        serde_json::from_value::<RecordRevision>(record.clone())
            .map_err(|_| ())
            .and_then(|revision| {
                if revision.valid() {
                    Ok(revision)
                } else {
                    Err(())
                }
            }),
    )
}

pub(super) fn apply(block: &mut FoldedBlock, op: &TimerOp) -> Option<bool> {
    let revision = match decode(op)? {
        Ok(revision) => revision,
        Err(()) => return Some(false),
    };
    // 删除是永久墓碑；并发编辑和迟到的旧事件不能复活同一个 uid。
    if !block
        .record
        .as_ref()
        .is_some_and(|record| record.deleted_at.is_some())
    {
        *block = revision.block(op);
    }
    Some(true)
}

pub(super) fn initial_block<'a>(
    ordered: &mut Vec<&'a TimerOp>,
) -> Option<(FoldedBlock, Option<&'a str>)> {
    if let Some(index) = ordered.iter().position(|op| op.kind == TimerOpKind::Start) {
        let start = ordered.remove(index);
        return Some((
            FoldedBlock {
                session_uid: start.session_uid.clone(),
                item_uid: start.item_uid.clone(),
                device_id: start.device_id.clone(),
                started_at_ms: start.at_ms,
                ended_at_ms: None,
                accumulated_ms: 0,
                running_since_ms: Some(start.at_ms),
                dropped: false,
                item_switched: false,
                record: None,
            },
            None,
        ));
    }
    // 补记与跨天首段本来就没有 start，完整修订本身足以重建记录。
    let (index, block) = ordered
        .iter()
        .enumerate()
        .find_map(|(index, op)| decode(op)?.ok().map(|record| (index, record.block(op))))?;
    let stopped_by = ordered[..index]
        .iter()
        .find(|op| op.kind == TimerOpKind::Stop)
        .map_or(ordered[index].device_id.as_str(), |op| {
            op.device_id.as_str()
        });
    ordered.drain(..=index);
    Some((block, Some(stopped_by)))
}
