//! 待传队列的「内容变没变」判定（V0.11.13，设计 §2.2）。
//!
//! 落库在 `repositories::md_cloud_pending`（那里只管 SQL），本文件只回答一个问题：
//! 这一轮的 `<date>.md` 与上一次记下的指纹**是否不同**。
//!
//! ## 为什么要指纹，而不看「谁写了文件」
//!
//! `md_sync` 无论导入还是导出，最后都会把规范化结果写回文件；「有没有变化」这件事
//! 文件本身最清楚。按方向记账会漏掉一类真实场景：远端手改导入后又重渲染成同一份内容
//! ——库变了、远端没变，不该产生一次无谓的 PUT。
//!
//! ## 为什么是 FNV-1a 64
//!
//! `sha2` 不在依赖图里，为一个「变没变」的判断引一个哈希 crate 不值得。这里只做变更
//! 检测，不承担安全职责：碰撞的后果是「少传一次」，下一轮内容再变时会补上。
//! 16 位小写十六进制是为了和日志、SQL 里看到的样子一致。

use sqlx::SqlitePool;

use crate::error::AppResult;
use crate::repositories::md_cloud_pending;

/// FNV-1a 64 的 offset basis（`MD_CLOUD_FNV` 口径见 <http://www.isthe.com/chongo/tech/comp/fnv/>）。
const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
/// FNV-1a 64 的质数。
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

/// 内容指纹（16 位小写十六进制）。
pub fn fingerprint(bytes: &[u8]) -> String {
    let mut hash = FNV_OFFSET;
    for byte in bytes {
        hash ^= u64::from(*byte);
        /* `wrapping_mul` 是 FNV 的定义（模 2^64），不是溢出兜底。 */
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    format!("{hash:016x}")
}

/// 内容变了就记一笔欠账，返回「变没变」。
///
/// `pending_since` 的「不重置」由 `mark_pending` 的 `ON CONFLICT` 保证，这里不判断：
/// 调用方这一层记性（先读再判再写）中间任何一条早退分支都会把欠账时间刷成当下。
pub async fn record_if_changed(
    pool: &SqlitePool,
    date: &str,
    text: &str,
    now: i64,
) -> AppResult<bool> {
    let hash = fingerprint(text.as_bytes());
    let last = md_cloud_pending::get(pool, date)
        .await?
        .and_then(|row| row.last_hash);
    if last.as_deref() == Some(hash.as_str()) {
        return Ok(false);
    }
    md_cloud_pending::mark_pending(pool, date, &hash, now).await?;
    Ok(true)
}

/// 有欠账的日期（升序）。
pub async fn dates(pool: &SqlitePool) -> AppResult<Vec<String>> {
    md_cloud_pending::pending_dates(pool).await
}
