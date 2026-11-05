//! 数据目录迁移的边界用例（V0.5.0）：M-06 / M-07 / M-08 / M-09 / M-13、
//! 覆盖式迁移（Q3）、阶段一同目录保护，以及三条纯函数/落盘契约断言。
//!
//! 夹具（造老目录、数行数、扫备份目录）在 `appdata_migrate.rs`，这里 `use` 过来。

use std::path::PathBuf;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

use crate::infra::appdata_migrate::{self as mig, paths, MigrationOutcome};
use crate::models::migration::{MigrationSource, RowCounts};
use crate::tests::appdata_migrate::{count_db, make_legacy, premigrate_dirs, TARGET_ID};
use crate::tests::support::{insert_saved, new_item, unique_dir};

/// M-06：校验失败 → 不留临时目录、老目录完好、不产生新的目标目录。
#[tokio::test]
async fn m06_verify_failure_leaves_no_temp() {
    let base = unique_dir("m06");
    let source = base.join(paths::LEGACY_IDENTIFIER);
    std::fs::create_dir_all(&source).expect("建老目录应成功");
    /* 主库是垃圾字节：复制一定「成功」，但打开/校验一定失败 —— 这是最接近真实的
    「迁移看起来成功、其实数据不可用」场景（PRD §4.6 红线 3：不许假装成功）。 */
    std::fs::write(source.join(paths::LEGACY_DB_NAME), b"not a sqlite database")
        .expect("写坏库应成功");

    let p = paths::Paths::new(&base, TARGET_ID);
    let outcome = mig::run_at(&p, false);
    let MigrationOutcome::Failed(failure) = &outcome else {
        panic!("应迁移失败，实为 {outcome:?}");
    };
    assert_eq!(failure.stage, mig::Stage::Verify, "应停在 Verify 阶段");

    assert!(!p.temp.exists(), "临时目录必须被清理");
    assert!(!p.target.exists(), "不得留下半成品新目录");
    assert_eq!(
        std::fs::read(source.join(paths::LEGACY_DB_NAME)).expect("老库必须还在"),
        b"not a sqlite database",
        "老目录一字节不动"
    );
}

/// M-07：上次迁移被强杀留下的临时目录 → 下次启动被清理后完整重迁。
#[tokio::test]
async fn m07_leftover_temp_is_cleaned() {
    let base = make_legacy("m07").await;
    let p = paths::Paths::new(&base, TARGET_ID);
    std::fs::create_dir_all(&p.temp).expect("造残留临时目录应成功");
    std::fs::write(p.temp.join("half-copied.db"), b"x").expect("写残留文件应成功");

    let outcome = mig::run_at(&p, false);
    assert!(
        matches!(outcome, MigrationOutcome::Migrated(_)),
        "应完整重迁，实为 {outcome:?}"
    );
    assert!(!p.temp.exists(), "残留临时目录必须被清理");
    assert!(
        !p.target.join("half-copied.db").exists(),
        "残留文件不得混进新目录"
    );
    assert_eq!(count_db(&p.target, "time_records").await, 1);
}

/// M-08：老库处于 WAL 且有未 checkpoint 数据 → `-wal` 必须被一并复制。
#[tokio::test]
async fn m08_wal_records_are_carried() {
    let base = make_legacy("m08").await;
    let source = base.join(paths::LEGACY_IDENTIFIER);
    let db_path = source.join(paths::LEGACY_DB_NAME);

    /* 造「未 checkpoint」：用第二连接写一条，然后 `mem::forget` 掉池子 ——
    连接不关闭，`-wal` 就保持着那批已提交但未回写主库的帧。
    这是 M-08 唯一可靠的造法（sleep / 关 checkpoint 都不稳）。 */
    let options = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(false);
    let live = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("第二连接应成功");
    let item = new_item(&live, "WAL 事项").await;
    insert_saved(&live, item, 10_000, 70_000, 60).await;

    let wal = db_path.with_file_name(format!("{}-wal", paths::LEGACY_DB_NAME));
    let wal_len = std::fs::metadata(&wal).map(|m| m.len()).unwrap_or(0);
    assert!(wal_len > 0, "前置条件：-wal 必须非空（否则本用例没有意义）");
    std::mem::forget(live);

    let p = paths::Paths::new(&base, TARGET_ID);
    let outcome = mig::run_at(&p, false);
    let MigrationOutcome::Migrated(info) = &outcome else {
        panic!("应迁移成功，实为 {outcome:?}");
    };
    assert!(info.wal_copied, "复制阶段必须把 -wal 一起搬过来");
    /* **不能**断言 `target/<库名>-wal` 存在：`verify` 的 V2/V3 必须用可读写连接打开
    副本（见 `verify.rs` 文件头：只读连接在「-wal 需要恢复」时会失败，而恢复正是它
    该做的事），SQLite 在最后一个连接关闭时把 WAL checkpoint 回主库并删掉 `-wal`
    /`-shm`。所以「新目录里没有 -wal」正是**校验成功**的结果，不是丢数据。
    真正该断言的是：那批「只在 WAL 里」的记录也要到新库（否则就是
    「看起来迁移成功、实际少了最后一段」的经典事故）。 */
    assert_eq!(count_db(&p.target, "time_records").await, 2);
}

/// M-07 的反面：残留临时目录**删不掉**时必须停在 `CleanTemp`。
/// 否则半成品会混进新目录（`copy_tree` 不清空目标，`verify` 也查不出「多」）。
#[cfg(windows)]
#[tokio::test]
async fn unremovable_temp_fails_at_clean_temp() {
    let base = make_legacy("clean-temp").await;
    let p = paths::Paths::new(&base, TARGET_ID);
    std::fs::create_dir_all(&p.temp).expect("造残留临时目录应成功");
    /* `File::create` 默认带 `FILE_SHARE_DELETE`（仍然删得掉），必须收窄共享模式，
    `remove_dir_all` 才会因共享冲突失败 —— 真实形态就是上次被强杀的进程还占着目录。 */
    let held = {
        use std::os::windows::fs::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .share_mode(0x0000_0001 | 0x0000_0002)
            .open(p.temp.join("half-copied.db"))
            .expect("写残留文件应成功")
    };

    let outcome = mig::run_at(&p, false);
    let MigrationOutcome::Failed(failure) = &outcome else {
        panic!("应停在 CleanTemp 阶段，实为 {outcome:?}");
    };
    assert_eq!(failure.stage, mig::Stage::CleanTemp);
    assert!(!p.target.exists(), "不得留下半成品新目录");
    assert!(
        p.source.join(paths::LEGACY_DB_NAME).is_file(),
        "老数据必须完好"
    );

    /* 放开句柄后目录就删得掉了 —— 证明失败原因确实只是「占用」，不是别的东西。 */
    drop(held);
    assert!(std::fs::remove_dir_all(&p.temp).is_ok());
}

/// M-09：跳过开关 → 完全不迁移，也不创建目标目录。
#[tokio::test]
async fn m09_skip_flag_returns_skipped() {
    let base = make_legacy("m09").await;
    let p = paths::Paths::new(&base, TARGET_ID);
    assert!(matches!(mig::run_at(&p, true), MigrationOutcome::Skipped));
    assert!(!p.target.exists(), "跳过时不得创建目标目录");
    assert!(!p.temp.exists());
}

/// M-13：老目录只有一个空 `logs/` → 视为有旧数据，复制后正常空库启动，不判失败。
#[tokio::test]
async fn m13_only_logs_dir_counts_as_legacy() {
    let base = unique_dir("m13");
    let source = base.join(paths::LEGACY_IDENTIFIER);
    std::fs::create_dir_all(source.join("logs")).expect("建空日志目录应成功");

    let p = paths::Paths::new(&base, TARGET_ID);
    let outcome = mig::run_at(&p, false);
    let MigrationOutcome::Migrated(info) = &outcome else {
        panic!("只有日志也应算迁移成功，实为 {outcome:?}");
    };
    assert_eq!(info.row_counts, RowCounts::default(), "没有库 → 行数全 0");
    assert!(p.target.join("logs").is_dir(), "日志目录应被复制");
}

/// Q3（覆盖式迁移）：用户上次选了「以空白数据启动」，这次必须把老数据搬上来，
/// 空白会话期间的数据**改名保留**（绝不删除）。
#[tokio::test]
async fn blank_start_then_retry_migrates_over() {
    let base = make_legacy("q3").await;
    let p = paths::Paths::new(&base, TARGET_ID);

    /* 空白会话：目标目录里已经建出了自己的库（这正是「不覆盖式迁移就永远搬不过来」的成因）。 */
    std::fs::create_dir_all(&p.target).expect("建目标目录应成功");
    let pool = crate::infra::db::init_pool(&p.target)
        .await
        .expect("建空白库应成功");
    let item = new_item(&pool, "空白期事项").await;
    insert_saved(&pool, item, 1, 2, 1).await;
    pool.close().await;
    mig::marker::write_pending(&p.target, &p).expect("写待迁移标记应成功");

    let outcome = mig::run_at(&p, false);
    let MigrationOutcome::Migrated(info) = &outcome else {
        panic!("应覆盖式迁移成功，实为 {outcome:?}");
    };
    assert_eq!(info.row_counts.time_records, 1, "搬的是老库那条");

    /* 空白期的目录被改名保留，内容一条不少。 */
    let backups = premigrate_dirs(&base);
    assert_eq!(backups.len(), 1, "应恰好有一个 premigrate 备份目录");
    assert_eq!(count_db(&backups[0], "time_records").await, 1);

    /* 待迁移标记已清 → 下次启动走 AlreadyPresent，不会反复覆盖。 */
    assert!(mig::read_pending(&p.target).is_none());
    assert_eq!(count_db(&p.target, "time_records").await, 1);
}

/// 阶段一的核心安全阀：目标 == 源时什么都不做，尤其**不能**把用户自己目录改名备份。
#[test]
fn same_dir_is_never_migrated() {
    let base = unique_dir("same-dir");
    let source = base.join(paths::LEGACY_IDENTIFIER);
    std::fs::create_dir_all(&source).expect("建目录应成功");
    std::fs::write(source.join(paths::LEGACY_DB_NAME), b"payload").expect("写文件应成功");

    /* 阶段一真实的 identifier 仍是 com.tickbar.app → target 与 source 必然同名。 */
    let p = paths::Paths::new(&base, paths::LEGACY_IDENTIFIER);
    assert!(
        p.is_same_dir(),
        "前置条件：阶段一的 target 必须与 source 同名"
    );

    let outcome = mig::run_at(&p, false);
    assert!(
        matches!(outcome, MigrationOutcome::NoLegacy),
        "同目录必须判 NoLegacy，实为 {outcome:?}"
    );
    assert!(
        source.join(paths::LEGACY_DB_NAME).is_file(),
        "数据必须原地不动"
    );
    assert!(
        premigrate_dirs(&base).is_empty(),
        "绝不能把自己的目录改名备份"
    );
}

/// 库文件名映射：阶段一是恒等映射；只有三种后缀参与映射。
#[test]
fn db_name_mapping_is_narrow() {
    assert_eq!(mig::copy::map_name(paths::LEGACY_DB_NAME), paths::DB_NAME);
    assert_eq!(
        mig::copy::map_name(&format!("{}-wal", paths::LEGACY_DB_NAME)),
        format!("{}-wal", paths::DB_NAME)
    );
    /* 用户自己的备份文件（`tickbar.db.bak`）不参与映射：宁可留一个没人读的文件。 */
    assert_eq!(
        mig::copy::map_name(&format!("{}.bak", paths::LEGACY_DB_NAME)),
        format!("{}.bak", paths::LEGACY_DB_NAME)
    );
}

/// 标记文件 schema 稳定性（QA 按字段核对；字段改名即破坏契约）。
#[test]
fn marker_schema_roundtrip() {
    let dir = unique_dir("marker");
    std::fs::create_dir_all(&dir).expect("建目录应成功");
    let migrated = mig::Migrated {
        at: "2026-11-04T15:20:31+08:00".to_string(),
        source: PathBuf::from(r"C:\Users\x\AppData\Roaming\com.tickbar.app"),
        db_bytes: 81_920,
        row_counts: RowCounts {
            items: 8,
            time_records: 512,
            todos: 20,
            notes: 3,
            settings: 14,
        },
        wal_copied: true,
    };
    mig::marker::write_marker(&dir, &migrated).expect("写标记应成功");
    let read = mig::read_marker(&dir).expect("应能读回标记");
    assert_eq!(read.db_bytes, 81_920);
    assert_eq!(read.row_counts.time_records, 512);
    assert_eq!(read.schema, mig::marker::SCHEMA);
    let raw = std::fs::read_to_string(dir.join(mig::marker::MARKER_FILE)).expect("应能读文件");
    assert!(raw.contains("\"rowCounts\""), "字段名必须是 camelCase");
    assert!(raw.contains("\"appVersion\""));
}

/// `source` 判定的优先级（命令层纯函数，与 ARCHITECTURE §3.3 的表逐行对应）。
#[test]
fn migration_source_priority() {
    use crate::commands::migration_cmd::resolve_source;
    assert_eq!(
        resolve_source(true, true, true, true, false),
        MigrationSource::Legacy,
        "有标记就是 legacy，压过一切"
    );
    assert_eq!(
        resolve_source(false, true, true, true, false),
        MigrationSource::Pending
    );
    assert_eq!(
        resolve_source(false, false, true, false, true),
        MigrationSource::Skipped
    );
    assert_eq!(
        resolve_source(false, false, false, false, false),
        MigrationSource::Fresh
    );
    assert_eq!(
        resolve_source(false, false, true, true, false),
        MigrationSource::Unattached
    );
}
