//! 便携落点（V0.11.6 / ADR-050 §3–§4）：可写性探测、老数据搬运、插件根去重。
//!
//! 覆盖三条产品口径里的**可机械验证**部分：
//! 1. 迁移**只复制、不删除**（跑完源目录字节数不变）；
//! 2. 幂等（跑两次，第二次 `AlreadyPresent`，绝不覆盖）；
//! 3. 判据只看 `timing.db` / 标记文件（`logs`、`backups` 不算「有数据」）。
//!
//! **禁止**在本文件调用 `platform::app_dir::set()`：`OnceLock` 一旦写入不可清除，
//! 会污染同进程里并行跑的其它用例（设计 §6）。所有用例只用两个临时目录注入路径。

use std::path::PathBuf;

use crate::infra::{db, portable_migrate as mig, portable_probe};

fn temp(tag: &str) -> PathBuf {
    crate::tests::support::unique_dir(tag)
}

/// 造一份「老数据目录」：走真实 `init_pool`，库结构与发布版一致。
async fn legacy_dir_with_db(tag: &str) -> std::path::PathBuf {
    let dir = temp(tag);
    let pool = db::init_pool(&dir).await.expect("init_pool 应成功");
    pool.close().await;
    dir
}

fn bytes(path: &std::path::Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

#[tokio::test]
async fn empty_source_is_no_legacy_and_target_untouched() {
    let source = temp("portable-nolegacy-src");
    std::fs::create_dir_all(&source).expect("建源目录");
    let target = temp("portable-nolegacy-dst");

    match mig::run_once(&source, &target) {
        mig::Outcome::NoLegacy => {}
        other => panic!("旧目录没有 timing.db 时应为 NoLegacy，实为 {other:?}"),
    }
    assert!(!target.exists(), "不搬就不该创建目标目录");
}

#[tokio::test]
async fn migrates_without_deleting_source() {
    let source = legacy_dir_with_db("portable-migrate-src").await;
    let target = temp("portable-migrate-dst");
    let before = bytes(&source.join("timing.db"));
    assert!(before > 0, "源库应非空");

    let outcome = mig::run_once(&source, &target);
    let facts = match outcome {
        mig::Outcome::Migrated(facts) => facts,
        other => panic!("应迁移成功，实为 {other:?}"),
    };

    assert!(target.join("timing.db").is_file(), "目标应有库");
    assert!(target.join(mig::MARKER_FILE).is_file(), "目标应有幂等标记");
    assert_eq!(bytes(&source.join("timing.db")), before, "源库不许被改动");
    assert_eq!(
        facts.db_bytes,
        bytes(&target.join("timing.db")),
        "事实里的字节数应等于落地文件"
    );
    assert_eq!(facts.source, source);
}

#[tokio::test]
async fn second_run_is_already_present() {
    let source = legacy_dir_with_db("portable-idem-src").await;
    let target = temp("portable-idem-dst");
    assert!(matches!(
        mig::run_once(&source, &target),
        mig::Outcome::Migrated(_)
    ));

    let before = bytes(&target.join("timing.db"));
    std::fs::write(target.join("timing.db"), b"sentinel").expect("用哨兵覆盖目标库");

    match mig::run_once(&source, &target) {
        mig::Outcome::AlreadyPresent(path) => assert_eq!(path, target),
        other => panic!("第二次应为 AlreadyPresent，实为 {other:?}"),
    }
    assert_eq!(
        std::fs::read(target.join("timing.db")).expect("读目标库"),
        b"sentinel",
        "已有数据时绝不覆盖（哪怕源里有更新的一份）"
    );
    assert!(before > 0);
}

#[test]
fn marker_alone_means_already_present() {
    /* 标记随数据走：用户把 data\ 整个搬走后，标记还在 → 不再从 %APPDATA% 拉一遍
    （否则删掉的旧记录会「复活」）。 */
    let source = temp("portable-marker-src");
    std::fs::create_dir_all(&source).expect("建源目录");
    std::fs::write(source.join("timing.db"), b"pretend-old-db").expect("写假源库");
    let target = temp("portable-marker-dst");
    std::fs::create_dir_all(&target).expect("建目标目录");
    std::fs::write(target.join(mig::MARKER_FILE), b"{}").expect("写标记");

    match mig::run_once(&source, &target) {
        mig::Outcome::AlreadyPresent(_) => {}
        other => panic!("有标记即视为已搬过，实为 {other:?}"),
    }
    assert!(!target.join("timing.db").exists(), "有标记时不该再复制");
}

#[test]
fn probe_rejects_path_under_a_file() {
    let base = temp("portable-probe");
    std::fs::create_dir_all(&base).expect("建目录");
    let file = base.join("a-file");
    std::fs::write(&file, b"x").expect("写文件");
    let err = portable_probe::probe(&file.join("data")).expect_err("文件下面建不了目录");
    assert!(err.contains("无法创建目录"), "{err}");
    std::fs::remove_dir_all(&base).ok();
}

/// 插件搬运：目标已存在时**逐个子目录**合并，撞名留原地。
///
/// 这条对应真实形态：便携包里带 `plugins\README.txt` 占位（否则空目录不进 zip），
/// 所以每个解压便携包的用户 `<exe>\plugins` 都存在。旧实现「目标存在就整目录放弃」
/// 会让升级用户的插件全部失效（文件还在 `data\plugins`，而扫描拓扑里没有那个目录）。
#[test]
fn plugin_merge_moves_subdirs_and_keeps_name_clashes_in_place() {
    let base = temp("portable-plugins");
    let data = base.join("data");
    let exe = base.join("exe");
    let from = data.join("plugins");
    let to = exe.join("plugins");
    for dir in [from.join("demo"), from.join("clash"), to.join("clash")] {
        std::fs::create_dir_all(&dir).expect("建插件目录");
    }
    std::fs::write(from.join("demo").join("plugin.json"), br#"{"id":"demo"}"#).expect("写清单");
    std::fs::write(
        from.join("clash").join("plugin.json"),
        br#"{"id":"clash","v":1}"#,
    )
    .expect("写旧清单");
    std::fs::write(
        to.join("clash").join("plugin.json"),
        br#"{"id":"clash","v":2}"#,
    )
    .expect("写新清单");
    /* 顶层散文件：不是插件，不搬也不删。 */
    std::fs::write(from.join("README.txt"), b"placeholder").expect("写占位说明");
    std::fs::write(to.join("README.txt"), b"placeholder").expect("写占位说明");

    crate::app::portable_boot::move_plugins(&data, &to);

    assert!(
        to.join("demo").join("plugin.json").is_file(),
        "不撞名的插件必须搬过去（否则升级后功能全丢）"
    );
    assert!(!from.join("demo").exists(), "搬走的不该留副本");
    assert!(
        from.join("clash").is_dir(),
        "撞名的留在原地，不许删用户那份"
    );
    assert_eq!(
        std::fs::read(to.join("clash").join("plugin.json")).expect("读新清单"),
        br#"{"id":"clash","v":2}"#,
        "撞名时目标那份不许被覆盖"
    );
    assert!(to.join("README.txt").is_file(), "顶层散文件不动");
    assert!(from.join("README.txt").is_file(), "顶层散文件不删");
    std::fs::remove_dir_all(&base).ok();
}

/// 目标目录不存在时走整目录 rename（零拷贝快路径）。
#[test]
fn plugin_move_uses_whole_dir_rename_when_target_absent() {
    let base = temp("portable-plugins-fast");
    let data = base.join("data");
    let from = data.join("plugins");
    std::fs::create_dir_all(from.join("demo")).expect("建插件目录");
    std::fs::write(from.join("demo").join("plugin.json"), br#"{"id":"demo"}"#).expect("写清单");
    let to = base.join("exe").join("plugins");
    std::fs::create_dir_all(to.parent().expect("有父目录")).expect("建 exe 目录");

    crate::app::portable_boot::move_plugins(&data, &to);

    assert!(
        to.join("demo").join("plugin.json").is_file(),
        "应整体搬过去"
    );
    assert!(!from.exists(), "整目录搬走后源目录不该还在");
    std::fs::remove_dir_all(&base).ok();
}

/* 插件扫描根的形态（`scan_roots_*`）已拆到 `portable_dir_scan.rs`：那边是纯路径
拼接、不碰磁盘，与本文的「搬运 / 探测」不是同一件事，混在一起会越过 300 行门禁。 */

/// 便携包预置的 `data\README.txt` 必须被当成「我们自己的占位」清掉，否则每个便携
/// 用户首次启动都会走一次 `stash_aside`，在 `%APPDATA%` 留下永不删除的空备份。
#[tokio::test]
async fn own_placeholder_does_not_trigger_a_backup() {
    let source = legacy_dir_with_db("portable-ph-src").await;
    let data = temp("portable-ph").join("data");
    std::fs::create_dir_all(&data).expect("建 data");
    /* 故意用 LF 写：打包脚本写的是 CRLF，判据必须与换行无关。 */
    std::fs::write(
        data.join("README.txt"),
        crate::app::portable_boot::DATA_README.replace("\r\n", "\n"),
    )
    .expect("写占位");

    crate::app::portable_boot::make_room_for_migration(&data);
    assert!(!data.exists(), "只有我们的占位时，空目录应当删得掉");

    assert!(matches!(
        mig::run_once(&source, &data),
        mig::Outcome::Migrated(_)
    ));
    assert!(
        backup_siblings(&source).is_empty(),
        "为一份占位文件留备份是没有意义的"
    );
}

/// 用户真放了东西：目录不许删，迁移走备份分支，备份里必须有那个文件。
#[tokio::test]
async fn user_files_block_removal_and_are_kept_in_the_backup() {
    let source = legacy_dir_with_db("portable-user-src").await;
    let data = temp("portable-user").join("data");
    std::fs::create_dir_all(&data).expect("建 data");
    std::fs::write(
        data.join("README.txt"),
        crate::app::portable_boot::DATA_README,
    )
    .expect("写占位");
    std::fs::write(data.join("my-notes.txt"), b"keep me").expect("写用户文件");

    crate::app::portable_boot::make_room_for_migration(&data);
    assert!(data.exists(), "用户文件在场时不许删目录");

    assert!(matches!(
        mig::run_once(&source, &data),
        mig::Outcome::Migrated(_)
    ));
    let backups = backup_siblings(&source);
    assert_eq!(backups.len(), 1, "应当留一份备份：{backups:?}");
    assert_eq!(
        std::fs::read(backups[0].join("my-notes.txt")).expect("读备份里的用户文件"),
        b"keep me",
        "备份必须把用户的文件带上"
    );
}

/// 判据是**内容**不是文件名：用户自己写的 `README.txt` 一个字节都不许动。
#[test]
fn user_written_readme_is_never_deleted() {
    let dir = temp("portable-user-readme");
    std::fs::create_dir_all(&dir).expect("建目录");
    std::fs::write(dir.join("README.txt"), "这是我自己写的说明".as_bytes()).expect("写文件");

    crate::app::portable_boot::make_room_for_migration(&dir);

    assert!(dir.join("README.txt").is_file(), "同名但内容不同 → 不删");
}

/// `<source>` 的兄弟备份目录（`<source>.portable-premigrate-<ts>`）。
fn backup_siblings(source: &std::path::Path) -> Vec<PathBuf> {
    let Some(parent) = source.parent() else {
        return Vec::new();
    };
    let prefix = format!(
        "{}.portable-premigrate-",
        source
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default()
    );
    std::fs::read_dir(parent)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with(&prefix))
        })
        .collect()
}
