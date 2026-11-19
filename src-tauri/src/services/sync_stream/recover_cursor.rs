use sqlx::SqlitePool;

use super::repository;
use super::segment::{decode_segment, format_seq};
use super::transport::Transport;
use crate::services::timer_ops::TimerOp;

pub(super) async fn verified_prefix(
    pool: &SqlitePool,
    scope: &str,
    transport: &Transport,
    device: &str,
    local: &[(i64, TimerOp)],
    last_seq: i64,
    dir: &str,
) -> Result<(usize, i64), String> {
    let mut offset = 0;
    let mut seq = u32::try_from(last_seq)
        .ok()
        .and_then(|seq| seq.checked_add(1))
        .ok_or("分段序号已用尽")?;
    loop {
        let rel = format!("{dir}/{}.jsonl", format_seq(seq));
        let Some(bytes) = transport.get(&rel).await? else {
            return Ok((offset, i64::from(seq) - 1));
        };
        let remote =
            decode_segment(&bytes).map_err(|err| format!("核对已有分段 {rel} 失败：{err}"))?;
        let end = offset + remote.len();
        if remote.is_empty()
            || !local
                .get(offset..end)
                .is_some_and(|slice| remote.iter().eq(slice.iter().map(|(_, op)| op)))
        {
            return Err(format!(
                "已有分段 {rel} 与本机事件不一致：不覆盖文件，不推进该段游标"
            ));
        }
        // 每段都落检查点，限流或断网后从下一段核验；SQL 水位不使用源端事件序号。
        repository::upsert(pool, scope, device, local[end - 1].0, i64::from(seq))
            .await
            .map_err(|err| err.message)?;
        offset = end;
        seq = seq.checked_add(1).ok_or("分段序号已用尽")?;
    }
}
