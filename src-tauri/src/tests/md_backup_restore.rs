//! 备份恢复（V0.11.13，设计 §2.4b / 任务书 §4.4）：覆写链路的三条硬结论。
//!
//! 1. 恢复之后 **SQL 与文件都被备份覆盖**，且基线跟上（再跑一轮同步不产生新导入）；
//! 2. 恢复一个不存在的备份 → 明确的 `Err`，不 panic；
//! 3. `target = Some("webdav")` → 该日期进待传队列，下一轮自动传上去。
//!
//! ## 全局状态说明
//!
//! `md_backup::set_root` 是 `OnceLock`：一个进程只认第一份，而 `cargo test` 把所有用例
//! 跑在同一个进程里。所以这里**只设一次**、所有用例共用一个按 pid 唯一的备份目录，
//! 各用例用不同的时间戳后缀避免撞名（备份名里的日期必须等于落点日期，只有时间戳能区分）。

use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

use chrono::NaiveDate;

use crate::error::ErrorCode;
use crate::infra::md_backup as store;
use crate::infra::md_file;
use crate::platform::clock::now_ms;
use crate::repositories::md_cloud_pending;
use crate::services::md_backup;
use crate::services::md_sync;
use crate::tests::md_sync::{env, Env, TIMERS_HEADING};
use crate::tests::support::{exec, expect_err, insert_saved, new_item, scalar_i64};

/// 本测试进程的备份目录（`set_root` 只生效一次，于是整份文件共用一个）。
fn backups_root() -> PathBuf {
    static ROOT: OnceLock<PathBuf> = OnceLock::new();
    ROOT.get_or_init(|| {
        let dir = std::env::temp_dir().join(format!("timing-qa-md-backups-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        store::set_root(dir.clone());
        dir
    })
    .clone()
}

/// 今日落点文件。
fn today_file(fixture: &Env) -> PathBuf {
    fixture
        .vault
        .join(format!("{}.md", fixture.date.format("%Y-%m-%d")))
}

/// 按 `md_backup::save` 的命名规则造一个备份名（`stamp` 用于区分不同用例）。
fn backup_name(date: NaiveDate, stamp: &str) -> String {
    format!("obsidian__{}-{stamp}.md", date.format("%Y-%m-%d"))
}

/// 未删除的已保存记录条数。
async fn alive(pool: &sqlx::SqlitePool) -> i64 {
    scalar_i64(
        pool,
        "SELECT COUNT(*) FROM time_records WHERE status = 'saved' AND deleted_at IS NULL",
    )
    .await
}

/// 验收第 6 条：库被改坏 + 文件跟着变坏 → 从备份恢复 → 两边都回到备份那一刻。
#[tokio::test]
async fn restore_overwrites_both_the_database_and_the_file() {
    let fixture = env("md-backup-restore").await;
    let backups = backups_root();
    let item = new_item(&fixture.pool, "写作").await;
    let now = now_ms();
    insert_saved(&fixture.pool, item, now - 600_000, now, 600).await;

    md_sync::run(&fixture.pool).await.expect("首轮同步应成功");
    let file = today_file(&fixture);
    let good = fs::read_to_string(&file).expect("今日文件应已生成");
    assert!(good.contains("写作"), "首轮之后记录应在文件里:\n{good}");

    /* 造一份备份：内容就是「好的那一刻」的整篇文件。 */
    let name = backup_name(fixture.date, "20260101-000000");
    fs::write(backups.join(&name), &good).expect("写备份样本应成功");

    /* 把库改坏（软删这条记录）→ 再同步一次，文件跟着变成空区块。 */
    exec(
        &fixture.pool,
        &format!(
            "UPDATE time_records SET deleted_at = {now}, updated_at = {now} WHERE deleted_at IS NULL"
        ),
    )
    .await;
    md_sync::run(&fixture.pool).await.expect("第二轮同步应成功");
    assert_eq!(alive(&fixture.pool).await, 0, "准备阶段：库里已经没有活记录");
    assert!(
        !fs::read_to_string(&file).unwrap().contains("写作"),
        "准备阶段：文件也不该还留着这条"
    );

    let result = md_backup::restore(&fixture.pool, &name, None)
        .await
        .expect("恢复应成功");
    assert_eq!(result.date, fixture.date.format("%Y-%m-%d").to_string());
    assert_eq!(result.target, "obsidian", "备份名的前缀就是归属");
    assert_eq!(result.written, 1, "三个 kind 落同一个文件 → 只算一个文件");
    assert!(result.imported >= 1, "记录要被导回来，实际 {}", result.imported);

    assert_eq!(alive(&fixture.pool).await, 1, "SQL 必须被备份覆盖回去");
    let restored = fs::read_to_string(&file).expect("恢复后文件应可读");
    assert_eq!(
        md_file::body_in_text(&restored, TIMERS_HEADING),
        md_file::body_in_text(&good, TIMERS_HEADING),
        "文件里的区块必须与备份一致:\n{restored}"
    );

    /* 基线已更新：紧接着再跑一轮，不该把它当成「用户手改」再导一遍。 */
    let again = md_sync::run(&fixture.pool).await.expect("恢复后同步应成功");
    assert_eq!(
        again.imported, 0,
        "恢复后基线没跟上 → 下一轮会再导入一次（会把软删又复活一遍）"
    );
    assert_eq!(alive(&fixture.pool).await, 1);
}

/// 不存在的备份名 → 明确 `Err`，不 panic；不是备份的名字 → 配置类错误码。
#[tokio::test]
async fn restore_of_a_missing_backup_is_a_clean_error() {
    let fixture = env("md-backup-missing").await;
    let name = backup_name(fixture.date, "20260202-000000");

    let code = expect_err(md_backup::restore(&fixture.pool, &name, None).await);
    assert_eq!(code, ErrorCode::IoError, "读不到文件应报 IO_ERROR");

    let code = expect_err(md_backup::restore(&fixture.pool, "readme.md", None).await);
    assert_eq!(
        code,
        ErrorCode::MdSyncConfigInvalid,
        "根本不是备份的名字要走配置类错误，不能当成 IO 故障"
    );
}

/// `target = Some("webdav")`：恢复完排一笔待传，下一轮自动传上去。
#[tokio::test]
async fn restoring_into_the_cloud_channel_queues_an_upload() {
    let fixture = env("md-backup-webdav").await;
    let backups = backups_root();
    let item = new_item(&fixture.pool, "写作").await;
    let now = now_ms();
    insert_saved(&fixture.pool, item, now - 600_000, now, 600).await;
    md_sync::run(&fixture.pool).await.expect("首轮同步应成功");

    let good = fs::read_to_string(today_file(&fixture)).expect("今日文件应已生成");
    let name = backup_name(fixture.date, "20260303-000000");
    fs::write(backups.join(&name), &good).expect("写备份样本应成功");

    let result = md_backup::restore(&fixture.pool, &name, Some("webdav"))
        .await
        .expect("恢复应成功");
    assert_eq!(result.target, "webdav", "显式指定的归属优先于备份名前缀");

    let row = md_cloud_pending::get(&fixture.pool, &result.date)
        .await
        .expect("查询应成功")
        .expect("恢复成 webdav 之后必须排一笔待传");
    assert!(
        row.pending_since > 0,
        "排进队列却没标欠账 → 下一轮的补传会跳过它"
    );
}
