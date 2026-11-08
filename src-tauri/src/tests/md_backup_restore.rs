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
use crate::models::md_cloud_purge::PurgeChannel;
use crate::models::md_sync_cloud::{CloudMode, MdSyncCloud};
use crate::platform::clock::now_ms;
use crate::repositories::md_cloud_pending;
use crate::services::md_backup;
use crate::services::md_sync;
use crate::tests::md_sync::{env, Env, TIMERS_HEADING};
use crate::tests::support::{exec, expect_err, insert_saved, new_item, scalar_i64, unique_dir};

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

/// `target = Some("webdav")` 的恢复**要求云端通道真的是 WebDAV**（[V0.11.14] 修 O4）。
///
/// 这条用例原本验的是「恢复完排一笔待传」，写的时候云端根本没配——它之所以能过，靠的
/// 正是 O4 那个 bug：`webdav` 落点静默回落到 `binding.root`（Obsidian），于是文件被写进
/// vault、排队也是照着 vault 那份排的。修完之后这条路是明确的配置错误，所以这里改成钉
/// 「拒绝 + 什么都不动」。
///
/// 「排待传」那一支要在真的 `%APP_DIR%\md-webdav` 上才走得到，而测试进程里那是用户的
/// 真实数据目录（`env()` 的安全底线不许写进去），故不在本文件覆盖；
/// `md_cloud_pending` 的队列语义由 `tests::md_cloud_pending` 单独覆盖。
#[tokio::test]
async fn restoring_into_the_cloud_channel_requires_a_resolvable_webdav_root() {
    let fixture = env("md-backup-webdav").await;
    let backups = backups_root();
    let item = new_item(&fixture.pool, "写作").await;
    let now = now_ms();
    insert_saved(&fixture.pool, item, now - 600_000, now, 600).await;
    md_sync::run(&fixture.pool).await.expect("首轮同步应成功");

    let good = fs::read_to_string(today_file(&fixture)).expect("今日文件应已生成");
    let name = backup_name(fixture.date, "20260303-000000");
    fs::write(backups.join(&name), &good).expect("写备份样本应成功");

    let code = expect_err(md_backup::restore(&fixture.pool, &name, Some("webdav")).await);
    assert_eq!(
        code,
        ErrorCode::MdSyncConfigInvalid,
        "云端没配时不许把 webdav 备份恢复进 Obsidian 落点"
    );
    assert_eq!(
        fs::read_to_string(today_file(&fixture)).expect("今日文件应仍可读"),
        good,
        "拒绝恢复时一个字节都不许写"
    );
    assert!(
        md_cloud_pending::get(
        &fixture.pool,
        PurgeChannel::Webdav,
        &fixture.date.format("%Y-%m-%d").to_string(),
    )
            .await
            .expect("查询应成功")
            .is_none(),
        "没恢复成就不该留下待传"
    );
}

/// [V0.11.14] 修 O4：`folder__` 备份必须恢复进「本地目录」落点，**不许**碰 Obsidian。
///
/// 回滚修复这条用例就红：旧 `root_of` 只认 `webdav`，`folder` 静默回落到
/// `binding.root`（Obsidian 落点）→ 记录会出现在 vault 里、云端目录一个字节都不动。
#[tokio::test]
async fn restoring_a_folder_backup_writes_the_cloud_folder_not_the_vault() {
    let fixture = env("md-backup-folder").await;
    let backups = backups_root();
    let cloud_dir = unique_dir("md-backup-folder-cloud");
    fs::create_dir_all(&cloud_dir).expect("建云端目录应成功");

    let mut stored = md_sync::config::load(&fixture.pool)
        .await
        .expect("读配置应成功");
    stored.cloud = Some(MdSyncCloud {
        enabled: true,
        mode: CloudMode::LocalFolder,
        local_root: cloud_dir.display().to_string(),
        ..Default::default()
    });
    md_sync::config::save(&fixture.pool, &stored)
        .await
        .expect("保存云端配置应成功");

    /* ① 造一份「记录还在」的现场，并把那一刻的文件抄成备份。 */
    let item = new_item(&fixture.pool, "写作").await;
    let now = now_ms();
    insert_saved(&fixture.pool, item, now - 600_000, now, 600).await;
    md_sync::run(&fixture.pool).await.expect("首轮同步应成功");
    let good = fs::read_to_string(today_file(&fixture)).expect("今日文件应已生成");
    assert!(good.contains("写作"), "准备阶段：记录应已在 vault 里");
    let name = format!(
        "folder__{}-20260404-000000.md",
        fixture.date.format("%Y-%m-%d")
    );
    fs::write(backups.join(&name), &good).expect("写备份样本应成功");

    /* ② 把库和文件都弄干净，于是「记录回到哪里」可观测。 */
    exec(
        &fixture.pool,
        &format!(
            "UPDATE time_records SET deleted_at = {now}, updated_at = {now} WHERE deleted_at IS NULL"
        ),
    )
    .await;
    md_sync::run(&fixture.pool).await.expect("第二轮同步应成功");
    assert!(
        !fs::read_to_string(today_file(&fixture)).unwrap().contains("写作"),
        "准备阶段：vault 里不该还留着这条"
    );

    /* ③ 恢复。归属来自文件名前缀（`target = None` 也走这一条）。 */
    let result = md_backup::restore(&fixture.pool, &name, None)
        .await
        .expect("恢复应成功");
    assert_eq!(result.target, "folder", "备份名的前缀就是归属");
    assert_eq!(result.written, 1, "三个 kind 落同一个文件 → 只算一个文件");

    let cloud_file = cloud_dir.join(format!("{}.md", fixture.date.format("%Y-%m-%d")));
    let restored = fs::read_to_string(&cloud_file).expect("云端目录里应出现恢复出来的那份");
    assert!(
        restored.contains("写作"),
        "恢复的内容必须落在「本地目录」落点:\n{restored}"
    );
    assert!(
        !fs::read_to_string(today_file(&fixture)).unwrap().contains("写作"),
        "不得改写 Obsidian 那份：用户以为自己恢复的是云端那份"
    );

    /* 模式不符同样算「解析不出来」：云端现在是「本地目录」，拿它的根当 webdav 落点是
    另一个错的文件。 */
    let code = expect_err(md_backup::restore(&fixture.pool, &name, Some("webdav")).await);
    assert_eq!(
        code,
        ErrorCode::MdSyncConfigInvalid,
        "落点与云端模式不符必须报错"
    );
}

/// [V0.11.14] 修 O4：云端通道没配时恢复 webdav 备份 → 明确报错，**绝不**静默写
/// Obsidian 落点（旧版就是这个行为：备份回到了错的文件，还没有任何提示）。
#[tokio::test]
async fn restoring_a_webdav_backup_without_cloud_config_is_an_error() {
    let fixture = env("md-backup-target-err").await;
    let backups = backups_root();
    let item = new_item(&fixture.pool, "写作").await;
    let now = now_ms();
    insert_saved(&fixture.pool, item, now - 600_000, now, 600).await;
    md_sync::run(&fixture.pool).await.expect("首轮同步应成功");
    let before = fs::read_to_string(today_file(&fixture)).expect("今日文件应已生成");

    let name = format!(
        "webdav__{}-20260505-000000.md",
        fixture.date.format("%Y-%m-%d")
    );
    fs::write(backups.join(&name), &before).expect("写备份样本应成功");

    let code = expect_err(md_backup::restore(&fixture.pool, &name, None).await);
    assert_eq!(
        code,
        ErrorCode::MdSyncConfigInvalid,
        "云端没配时恢复 webdav 备份必须报配置类错误，而不是回落去写 Obsidian"
    );
    assert_eq!(
        fs::read_to_string(today_file(&fixture)).expect("今日文件应仍可读"),
        before,
        "报错时一个字节都不许写"
    );
}
