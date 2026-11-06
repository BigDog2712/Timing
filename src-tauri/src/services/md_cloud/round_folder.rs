//! LocalFolder 那一轮（V0.11.13，设计 §3.5）。**没有网络代码**。
//!
//! 只把当天那份写进用户选的本地目录，上传交给坚果云 / OneDrive 客户端。这条路的
//! 意义是「不想把账号密码交给 Timing 也能有第二份」：所以它连 `infra::secret` 都不读。
//!
//! 也没有「待传」概念：目标是真目录，写进去就是同步完了。`pending` 表在这条路上
//! 一行都不会产生，`CloudRoundOutcome.pending` 因此填空。

use std::fs;
use std::path::PathBuf;

use sqlx::SqlitePool;

use super::absorb;
use crate::error::AppResult;
use crate::infra::md_backup;
use crate::models::md_sync::MdSyncReport;
use crate::models::md_sync_cloud::MdSyncCloud;
use crate::platform::clock::now_ms;
use crate::services::md_sync::{self, mirror};

/// 一轮：Obsidian 落点 → 云端落点（同一个目录，写进去即同步完）。
pub async fn run(pool: &SqlitePool, cloud: &MdSyncCloud) -> AppResult<MdSyncReport> {
    let mut report = MdSyncReport::new(now_ms());
    let root: PathBuf = match cloud.resolve_root() {
        Ok(path) => path,
        Err(err) => {
            report.errors.push(err);
            return Ok(report);
        }
    };
    /* 必须在云端那轮**之前**登记：`write_section` 靠注册表决定备份文件名前缀，
    登记晚了本轮的备份就会标成 `obsidian`。 */
    md_backup::register_root(root.clone(), "folder");
    if let Err(err) = fs::create_dir_all(&root) {
        report.errors.push(format!("建不了云端落点目录：{err}"));
        return Ok(report);
    }

    /* 顺序不可换：Obsidian 那份的用户手改先入库，云端这份再从「已含手改的 SQL」渲染
    出去（设计 §2.1）。反过来会让写出去的副本缺本轮的手改。 */
    let local = md_sync::run(pool).await?;
    absorb(&mut report, local);

    let cloud_report = mirror::run_in(pool, &root.to_string_lossy()).await?;
    absorb(&mut report, cloud_report);
    Ok(report)
}
