//! 便携落点（V0.11.6）**独立验收** · A1 组（「只复制不删除」是否真成立）。
//!
//! 两个用例，合起来就是「旧目录一个字节都不改」的机械判据：
//!
//! 1. `a1_source_files_keep_their_bytes` —— 源里**原有**的文件内容不变、一个都不少。
//! 2. `a1b_migration_must_not_add_files_to_source` —— 源目录**不许多出文件**。
//! 3. `a1d` / `a1e` —— 备份落点的两条防回归守门人（见文件后半段的说明）。
//!
//! 历史：`a1b` 原先红——`verify()` 的 V4 行数比对用只读连接打开源库，SQLite 对 WAL
//! 库即使 `SQLITE_OPEN_READONLY` 也必须落地 `-shm`(32 KB) / `-wal`(0 B)。
//! 修法是 V4 改成在**影子副本**上开库（`appdata_migrate/verify.rs::shadow_facts`），
//! 源目录只剩读操作。归因用例 `a1c_culprit_is_verify_not_copy_tree` 按它自己的
//! 注释约定删除（"若这里也干净……把本用例删掉"）。

use std::collections::BTreeSet;

use crate::infra::portable_migrate as mig;

use super::portable_dir_qa::{legacy_with_db, snapshot, temp};

/// 源里原有的文件：内容逐字节不变，一个都不少。
#[tokio::test]
async fn a1_source_files_keep_their_bytes() {
    let source = legacy_with_db("qa-a1-src").await;
    let target = temp("qa-a1-dst");
    let before = snapshot(&source);
    assert!(
        before.contains_key("timing.db"),
        "源应有库：{:?}",
        before.keys()
    );

    let outcome = mig::run_once(&source, &target);
    assert!(
        matches!(outcome, mig::Outcome::Migrated(_)),
        "实为 {outcome:?}"
    );

    let after = snapshot(&source);
    for (rel, bytes) in &before {
        assert_eq!(
            after.get(rel),
            Some(bytes),
            "源文件 {rel} 内容被改动或丢失（迁移必须只读源）"
        );
    }
    /* 副本也真的带上了 logs / plugins，不是只搬了库。 */
    assert!(
        target.join("logs").join("app.log").is_file(),
        "logs 应被复制"
    );
    assert!(
        target
            .join("plugins")
            .join("demo")
            .join("plugin.json")
            .is_file(),
        "plugins 应被复制"
    );
}

/// 源目录**文件集合**必须不变（含新增文件：`-shm` / `-wal` 也算脏）。
#[tokio::test]
async fn a1b_migration_must_not_add_files_to_source() {
    let source = legacy_with_db("qa-a1b-src").await;
    let target = temp("qa-a1b-dst");
    let before_set: BTreeSet<String> = snapshot(&source).into_keys().collect();

    assert!(matches!(
        mig::run_once(&source, &target),
        mig::Outcome::Migrated(_)
    ));

    let after_set: BTreeSet<String> = snapshot(&source).into_keys().collect();
    let added: Vec<&String> = after_set.difference(&before_set).collect();
    let removed: Vec<&String> = before_set.difference(&after_set).collect();
    assert!(
        added.is_empty(),
        "迁移往旧目录里**新增**了文件（旧目录必须一个字节都不改）：{added:?}"
    );
    assert!(removed.is_empty(), "迁移从旧目录删掉了文件：{removed:?}");
}

// ---------------------------------------------------------------------------
// A1d / A1e：备份落点的两条防回归守门人
//
// 背景：`portable_boot.rs` 的 `remove_dir(&data_dir)` 在 `data\` 非空时失败——而便携包
// 里就带着 `data\README.txt`，所以「目标已存在」是**绝大多数**便携用户的实际路径。
// 走这条分支时会把已存在的目标挪到备份位置；备份放在哪里，直接决定 A1 的承诺成不成立。
//
// 现状（`portable_migrate.rs:136`）：备份 = `sibling(source, ".portable-premigrate-<ts>")`
// = `%APPDATA%\<identifier>.portable-premigrate-<ts>\`，是 **source 的兄弟目录**，
// 所以源目录本身不被写 —— 两条用例因此是绿的。
//
// 它们仍然是**守门人**，不是白写的：
// - `a1d` 会在「备份被改回放进 `source` 里面」时立刻变红；
// - `a1e` 防的是「备份躺在被复制的那棵树里」——那样用户删掉 `data\` 重来时，
//   下一次迁移会把备份当成用户数据一起拷进新数据目录。
// ---------------------------------------------------------------------------

/// A1d：目标已存在时，迁移不许往**源目录**写任何东西。
#[tokio::test]
async fn a1d_existing_target_must_not_write_into_source() {
    let source = legacy_with_db("qa-a1d-src").await;
    /* 等价于便携包解压后的形态：`data\` 已存在且非空（`README.txt` 占位）。 */
    let target = temp("qa-a1d-dst");
    std::fs::create_dir_all(&target).expect("建目标目录");
    std::fs::write(target.join("README.txt"), b"placeholder").expect("写占位");

    let before: BTreeSet<String> = snapshot(&source).into_keys().collect();
    let outcome = mig::run_once(&source, &target);
    assert!(
        matches!(outcome, mig::Outcome::Migrated(_)),
        "目标只有占位文件时应照常迁移，实为 {outcome:?}"
    );

    let after: BTreeSet<String> = snapshot(&source).into_keys().collect();
    let added: Vec<&String> = after.difference(&before).collect();
    assert!(
        added.is_empty(),
        "目标已存在时迁移往旧目录里写了东西（「旧目录一个字节都不改」）：{added:?}"
    );
}

/// A1e：备份目录在**被复制的源树里**，重迁会把它当用户数据拷进新数据目录。
#[tokio::test]
async fn a1e_premigrate_backup_is_not_reinjected_into_data() {
    let source = legacy_with_db("qa-a1e-src").await;
    let target = temp("qa-a1e-dst");
    std::fs::create_dir_all(&target).expect("建目标目录");
    std::fs::write(target.join("README.txt"), b"placeholder").expect("写占位");
    assert!(matches!(
        mig::run_once(&source, &target),
        mig::Outcome::Migrated(_)
    ));

    /* 用户排障：删掉 data 目录重来。 */
    std::fs::remove_dir_all(&target).expect("删目标目录");
    assert!(matches!(
        mig::run_once(&source, &target),
        mig::Outcome::Migrated(_)
    ));

    let leaked: Vec<String> = std::fs::read_dir(&target)
        .expect("读新数据目录")
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .filter(|name| name.starts_with("portable-premigrate-"))
        .collect();
    assert!(
        leaked.is_empty(),
        "重迁把旧备份当成「用户数据」拷进了新数据目录：{leaked:?}"
    );
}
