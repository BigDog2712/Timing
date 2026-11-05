//! 数据目录迁移用例（V0.5.0 / PRD §4.5）：M-01 / M-02 / M-03 / M-05。
//!
//! 全部用例都**不碰真实 `%APPDATA%`**：`Paths::new(&tmp, "com.timing.app")` 用两个
//! 临时目录假装「老目录 / 新目录」，与真实 identifier 无关。这正是 `run_at` 不读
//! identifier 的意义——identifier 还没换（阶段一）也能把这些用例跑通。
//!
//! 边界用例（失败 / WAL / 跳过 / 覆盖式）见 `appdata_migrate_edges.rs`。

use std::path::{Path, PathBuf};

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

use crate::infra::appdata_migrate::{self as mig, paths, MigrationOutcome};
use crate::tests::support::{insert_saved, new_item, unique_dir};

/// 目标目录名（测试里随便取；阶段一真实的 identifier 仍是 `com.tickbar.app`）。
pub(super) const TARGET_ID: &str = "com.timing.app";

/// 造一个「0.4.1 老目录」：真实 `init_pool` 建库 + 插数据 + 手写 window-state / plugins / logs。
pub(super) async fn make_legacy(tag: &str) -> PathBuf {
    let base = unique_dir(tag);
    let source = base.join(paths::LEGACY_IDENTIFIER);
    std::fs::create_dir_all(&source).expect("建老目录应成功");

    let pool = crate::infra::db::init_pool(&source)
        .await
        .expect("建老库应成功");
    let item = new_item(&pool, "老事项").await;
    insert_saved(&pool, item, 1_000, 61_000, 60).await;
    /* 关池 = 关闭连接，WAL 被 checkpoint 回主库：这是「已正常退出」的老用户形态，
    M-08 会另造一个「未 checkpoint」的形态。 */
    pool.close().await;

    /* 0.4.1 的用户目录里躺着的是**老库名** `tickbar.db`。阶段二把 `DB_NAME` 改成
    `timing.db` 之后，`init_pool` 建出来的是新库名 —— 不改名回来，本 fixture 就变成
    「新版本的目录」，M-01/M-05/M-08 会全部在测错对象（测的是「新库名 → 新库名」，
    而不是「老库名 → 新库名」这条真正要保的映射）。 */
    if paths::DB_NAME != paths::LEGACY_DB_NAME {
        for suffix in ["", "-wal", "-shm"] {
            let from = source.join(format!("{}{suffix}", paths::DB_NAME));
            if from.exists() {
                let to = source.join(format!("{}{suffix}", paths::LEGACY_DB_NAME));
                std::fs::rename(&from, &to).expect("老库改名应成功");
            }
        }
    }

    std::fs::create_dir_all(source.join("plugins").join("md-sync")).expect("建插件目录应成功");
    std::fs::write(
        source.join("plugins").join("md-sync").join("plugin.json"),
        "{}",
    )
    .expect("写插件头应成功");
    std::fs::create_dir_all(source.join("logs")).expect("建日志目录应成功");
    std::fs::write(source.join("logs").join("tickbar-2026-11-01.log"), "line\n")
        .expect("写日志应成功");
    std::fs::write(source.join(".window-state.json"), "{}").expect("写窗口状态应成功");
    base
}

/// 打开某目录下的库数一张表的行数（不跑迁移，纯读）。
pub(super) async fn count_db(dir: &Path, table: &str) -> i64 {
    let options = SqliteConnectOptions::new()
        .filename(dir.join(paths::DB_NAME))
        .create_if_missing(false);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("打开库应成功");
    let sql = format!("SELECT COUNT(*) FROM {table}");
    let count = sqlx::query_scalar::<_, i64>(&sql)
        .fetch_one(&pool)
        .await
        .expect("计数应成功");
    pool.close().await;
    count
}

/// `base` 下所有 `.premigrate-*` 备份目录（名字带时间戳，只能扫不能算）。
pub(super) fn premigrate_dirs(base: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(base) else {
        return Vec::new();
    };
    entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.contains(paths::PREMIGRATE_SUFFIX))
        })
        .collect()
}

/// M-01：正常迁移——全部数据搬过去，老目录一字节不动。
#[tokio::test]
async fn m01_migrates_all_data() {
    let base = make_legacy("m01").await;
    let p = paths::Paths::new(&base, TARGET_ID);

    let outcome = mig::run_at(&p, false);
    let MigrationOutcome::Migrated(info) = &outcome else {
        panic!("应迁移成功，实为 {outcome:?}");
    };

    assert_eq!(info.row_counts.items, 2, "系统事项 + 新建事项");
    assert_eq!(info.row_counts.time_records, 1);
    assert!(info.db_bytes > 0);
    assert!(!info.wal_copied, "老库已 checkpoint，不该有 -wal");

    /* 整树都过来了：库 / 插件目录 / 日志 / 窗口状态。 */
    assert!(p.target.join(paths::DB_NAME).is_file());
    assert!(p.target.join("plugins/md-sync/plugin.json").is_file());
    assert!(p.target.join("logs").is_dir());
    assert!(p.target.join(".window-state.json").is_file());

    /* 老目录仍是原样（只有复制、没有移动）。 */
    assert!(p.source.join(paths::LEGACY_DB_NAME).is_file());
    assert!(p.source.join("plugins/md-sync/plugin.json").is_file());

    /* 标记文件落地且字段是 camelCase（前端按此解析）。 */
    let raw =
        std::fs::read_to_string(p.target.join(mig::marker::MARKER_FILE)).expect("应有迁移标记");
    assert!(raw.contains("\"rowCounts\"") && raw.contains("\"walCopied\""));

    /* 新库能真的读出数据（不只是文件字节数对齐）。 */
    assert_eq!(count_db(&p.target, "time_records").await, 1);
}

/// M-02：迁移成功后再次启动 → 不再迁移、不重复写数据。
#[tokio::test]
async fn m02_second_run_is_noop() {
    let base = make_legacy("m02").await;
    let p = paths::Paths::new(&base, TARGET_ID);
    assert!(matches!(
        mig::run_at(&p, false),
        MigrationOutcome::Migrated(_)
    ));

    let outcome = mig::run_at(&p, false);
    assert!(
        matches!(outcome, MigrationOutcome::AlreadyPresent(_)),
        "第二次应判 AlreadyPresent，实为 {outcome:?}"
    );
    assert_eq!(count_db(&p.target, "time_records").await, 1, "不得重复写入");
    assert!(premigrate_dirs(&base).is_empty(), "第二次不得动目标目录");
}

/// M-03：迁移成功后删掉老目录，再启动仍然正常（代码零处依赖老目录存在）。
#[tokio::test]
async fn m03_works_after_legacy_dir_removed() {
    let base = make_legacy("m03").await;
    let p = paths::Paths::new(&base, TARGET_ID);
    assert!(matches!(
        mig::run_at(&p, false),
        MigrationOutcome::Migrated(_)
    ));

    std::fs::remove_dir_all(&p.source).expect("删老目录应成功");
    let outcome = mig::run_at(&p, false);
    assert!(
        matches!(outcome, MigrationOutcome::NoLegacy),
        "老目录没了应判 NoLegacy，实为 {outcome:?}"
    );
    assert_eq!(count_db(&p.target, "time_records").await, 1);
}

/// M-05：目标已有库 → 不迁移、不覆盖（本机现状就是这个分支）。
#[tokio::test]
async fn m05_target_with_db_is_not_overwritten() {
    let base = make_legacy("m05").await;
    let p = paths::Paths::new(&base, TARGET_ID);

    std::fs::create_dir_all(&p.target).expect("建目标目录应成功");
    let pool = crate::infra::db::init_pool(&p.target)
        .await
        .expect("建目标库应成功");
    let item = new_item(&pool, "目标已有事项").await;
    insert_saved(&pool, item, 1, 2, 1).await;
    pool.close().await;
    let before = count_db(&p.target, "time_records").await;

    let outcome = mig::run_at(&p, false);
    assert!(
        matches!(outcome, MigrationOutcome::TargetOccupied(_)),
        "应判 TargetOccupied，实为 {outcome:?}"
    );
    assert_eq!(
        count_db(&p.target, "time_records").await,
        before,
        "目标库一字节都不许被替换"
    );
    assert!(
        !p.target.join(mig::marker::MARKER_FILE).is_file(),
        "不迁移就不得写迁移标记"
    );
    assert!(
        p.source.join(paths::LEGACY_DB_NAME).is_file(),
        "老数据必须完好"
    );
}
