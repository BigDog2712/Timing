//! 云端待传队列（V0.11.13，ADR-061；V0.11.26 起按通路隔离）：`md_cloud_pending` 的读写。
//!
//! 只写 SQL + 行映射，**不含「该不该传」的判断**：判据（内容指纹变没变）在
//! `services::md_cloud`，这里只负责把结论落库。分层上它和别的仓库一样在
//! `repositories`，不认 `MdSyncCloud`、不连网。
//!
//! ## [V0.11.26] 主键改 `(date, channel)`
//!
//! 双通路拆分后 folder 的 `last_hash` 与 webdav 的 `etag` 不能再共写一行：
//! 一次 round 里两条通路各记各的账，共用一行会互相覆盖。`channel` 列的取值
//! 唯一出处是 `models::md_cloud_purge::PurgeChannel::as_str`（`'folder' / 'webdav'`，
//! 与 purge 水位键、备份 `target` 同源）。迁移 `0007` 把旧行全部折给 `'webdav'`
//! （欠账行只可能来自 WebDAV 轮，折给 folder 会永久丢补传清单）。
//!
//! ## `pending_since` 只在 SQL 里保证「不重置」
//!
//! 欠账时间要的是「第一次发现有未传改动的时刻」——它是用户判断「这份到底压了多久」
//! 的唯一依据。若靠调用方记性（先读再判再写），中间任何一条早退分支都会把它刷成
//! 当下时间。所以这条不变式写在 `mark_pending` 的 `ON CONFLICT` 里：
//! 已有非 0 值就原样保留，只有 0（无欠账）才写入新时间。
//!
//! ## 为什么 `mark_synced` 也带 INSERT
//!
//! 今天第一次同步成功时，表里可能一行都没有（本轮没产生过「有改动」的判定）。
//! 那条 `etag` 必须留下来：下一轮 PUT 要拿它做 `If-Match`，否则每次都是无条件覆盖，
//! `412` 这条防线等于不存在。

#![allow(dead_code)]

use sqlx::SqlitePool;

use crate::error::AppResult;
use crate::models::md_cloud_purge::PurgeChannel;

/// 某一天的欠账状态。`pending_since = 0` 表示无欠账。
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct CloudPendingRow {
    /// `yyyy-MM-dd`（本地时区，与文件模板的 `{date}` 同源）。
    pub date: String,
    /// 上次成功同步时远端的 ETag；`None` = 远端还没有这天。
    pub etag: Option<String>,
    /// 上次记下的内容指纹。
    pub last_hash: Option<String>,
    /// 第一次发现有未传改动的时刻（毫秒）；`0` = 无欠账。
    pub pending_since: i64,
}

impl CloudPendingRow {
    /// 这天是否有欠账（上传过就为 `false`）。
    pub fn is_pending(&self) -> bool {
        self.pending_since > 0
    }
}

/// 全部行（`date` 升序）。设置页与日志用；待传清单请用 `pending_dates`。
pub async fn list(pool: &SqlitePool, channel: PurgeChannel) -> AppResult<Vec<CloudPendingRow>> {
    let rows = sqlx::query_as::<_, CloudPendingRow>(
        "SELECT date, etag, last_hash, pending_since FROM md_cloud_pending \
         WHERE channel = ? ORDER BY date ASC",
    )
    .bind(channel.as_str())
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// 单行。没有这天（从没记过）返回 `None`，不是错误。
pub async fn get(
    pool: &SqlitePool,
    channel: PurgeChannel,
    date: &str,
) -> AppResult<Option<CloudPendingRow>> {
    let row = sqlx::query_as::<_, CloudPendingRow>(
        "SELECT date, etag, last_hash, pending_since FROM md_cloud_pending \
         WHERE channel = ? AND date = ?",
    )
    .bind(channel.as_str())
    .bind(date)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// 有欠账的日期（`pending_since > 0`，升序）——补传清单就是它。
pub async fn pending_dates(pool: &SqlitePool, channel: PurgeChannel) -> AppResult<Vec<String>> {
    let dates = sqlx::query_scalar::<_, String>(
        "SELECT date FROM md_cloud_pending \
         WHERE channel = ? AND pending_since > 0 ORDER BY date ASC",
    )
    .bind(channel.as_str())
    .fetch_all(pool)
    .await?;
    Ok(dates)
}

/// 记一笔欠账：内容变了、但还没传上去。
///
/// 已有 `pending_since > 0` 时**不重置**（见模块注释）；`last_hash` 每次都更新为
/// 当前内容指纹——它记的是「本地最后看到的内容」，而「传没传成功」由
/// `pending_since` 单独表达。
pub async fn mark_pending(
    pool: &SqlitePool,
    channel: PurgeChannel,
    date: &str,
    hash: &str,
    now: i64,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO md_cloud_pending (date, channel, last_hash, pending_since) VALUES (?, ?, ?, ?) \
         ON CONFLICT(date, channel) DO UPDATE SET \
           last_hash = excluded.last_hash, \
           pending_since = CASE WHEN md_cloud_pending.pending_since = 0 \
                                THEN excluded.pending_since \
                                ELSE md_cloud_pending.pending_since END",
    )
    .bind(date)
    .bind(channel.as_str())
    .bind(hash)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

/// 上传成功：记下远端 `etag` 与内容指纹，并把欠账清成 0。
///
/// `etag` 为 `None` 时同样写入（覆盖成 NULL）：远端这次没回 ETag，就不能拿旧的
/// 去 `If-Match`——那会稳定地 412。
pub async fn mark_synced(
    pool: &SqlitePool,
    channel: PurgeChannel,
    date: &str,
    etag: Option<&str>,
    hash: &str,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO md_cloud_pending (date, channel, etag, last_hash, pending_since) \
         VALUES (?, ?, ?, ?, 0) \
         ON CONFLICT(date, channel) DO UPDATE SET \
           etag = excluded.etag, \
           last_hash = excluded.last_hash, \
           pending_since = 0",
    )
    .bind(date)
    .bind(channel.as_str())
    .bind(etag)
    .bind(hash)
    .execute(pool)
    .await?;
    Ok(())
}

/// 删掉这天的记录（`md_cloud_pending` 只是缓存性质的状态，删了最多多传一次）。
///
/// 目前只有排障与测试用它：`pending_since` 归 0 走 `mark_synced`，
/// 因为那条路必须同时留下 `etag`。
pub async fn clear(pool: &SqlitePool, channel: PurgeChannel, date: &str) -> AppResult<()> {
    sqlx::query("DELETE FROM md_cloud_pending WHERE channel = ? AND date = ?")
        .bind(channel.as_str())
        .bind(date)
        .execute(pool)
        .await?;
    Ok(())
}
