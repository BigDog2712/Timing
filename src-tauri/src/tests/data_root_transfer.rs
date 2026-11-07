//! 数据根搬迁的判据（V0.11.15，设计 §3.3 / §3.4 / §3.6）。
//!
//! 第一条用例是**唯一**能证明 `VACUUM INTO ?1` 这行代码真的产出文件、且参数绑定成立的
//! 证据（设计 §3.4 明说「没在真机验过参数绑定对 VACUUM 是否成立」）。它绿了，写法就
//! 是参数绑定；它红了，退路只剩字面量 + 单引号转义。
//!
//! **不调** `app_dir::set()`：`OnceLock` 不可清除，会污染并行用例。所有路径都由参数
//! 传进来（`support::unique_dir`），不读 `app_dir`。

use std::path::{Path, PathBuf};

use sqlx::SqlitePool;

use crate::infra::db;
use crate::infra::root_pointer;
use crate::services::data_root::{preflight, switch, transfer};
use crate::tests::support;

/// 独立临时目录（`prepare` 用同一个 tag 前缀，避免与其它用例撞车）。
async fn pool_at(tag: &str) -> (PathBuf, SqlitePool) {
    let dir = support::unique_dir(tag);
    let pool = db::init_pool(&dir).await.expect("建库");
    (dir, pool)
}

/// 往五张表各塞一行，让「行数一致」不是「都是 0」。
///
/// `items` 的 id=1 是迁移种下的「未归类」（`is_system=1`），这里只**追加**一行，
/// 不去改它：`VACUUM INTO` 复制的是整库，种子行也必须一并对上。
async fn seed(pool: &SqlitePool) {
    support::exec(
        pool,
        "INSERT INTO items (name, color, sort_order, created_at, updated_at) \
         VALUES ('写作', '#ff0000', 1, 1, 1)",
    )
    .await;
    support::exec(
        pool,
        "INSERT INTO time_records (item_id, status, started_at, ended_at, created_at, updated_at) \
         VALUES (1, 'saved', 1000, 2000, 1000, 2000)",
    )
    .await;
    support::exec(
        pool,
        "INSERT INTO notes (content, pos_x, pos_y, width, height, created_at, updated_at) \
         VALUES ('便签', 0, 0, 200, 120, 1, 1)",
    )
    .await;
    support::exec(
        pool,
        "INSERT INTO todos (title, created_at, updated_at) VALUES ('待办', 1, 1)",
    )
    .await;
}

/// ① `VACUUM INTO ?1` 真的产出文件，五表行数与源库一致，且副本没有 `-wal`。
#[tokio::test]
async fn vacuum_into_produces_a_verified_copy() {
    let (source, pool) = pool_at("transfer-vacuum").await;
    seed(&pool).await;

    let dest = support::unique_dir("transfer-vacuum-dest");
    transfer::copy_all(&pool, &source, &dest)
        .await
        .expect("复制应成功");
    let copy = dest.join("timing.db");
    assert!(copy.is_file(), "VACUUM INTO 必须真的落出一个文件");
    assert!(
        !dest.join("timing.db-wal").exists(),
        "VACUUM 的产物是单文件、无 WAL（拷 -wal 会得到一份可能撕裂的库）"
    );

    /* `verify` 就是生产路径上的核对：五表逐表相等才 Ok。 */
    transfer::verify(&pool, &dest).await.expect("行数应一致");
    /* 再直接读一次副本，证明「核对」不是自己跟自己对答案。 */
    let copy_pool = db::init_pool(&dest).await.expect("打开副本");
    let rows = support::scalar_i64(&copy_pool, "SELECT COUNT(*) FROM time_records").await;
    assert_eq!(rows, 1, "副本里要有源库那一条记录");
    copy_pool.close().await;
    pool.close().await;
    std::fs::remove_dir_all(&source).ok();
    std::fs::remove_dir_all(&dest).ok();
}

/// ② 核对失败：点名哪张表差多少，且能在目标目录留下说明文件。
#[tokio::test]
async fn verify_names_the_table_that_differs_and_incomplete_file_is_written() {
    let (source, pool) = pool_at("transfer-mismatch").await;
    seed(&pool).await;
    /* 目标里放一个**别的**空库：五张表都在，但 `items` 少一行（副本只有迁移种下的
    「未归类」，源里还多一条「写作」）。 */
    let dest = support::unique_dir("transfer-mismatch-dest");
    let other = db::init_pool(&dest).await.expect("建空库");
    other.close().await;

    let err = transfer::verify(&pool, &dest)
        .await
        .expect_err("行数不一致必须失败");
    assert_eq!(err.code, crate::error::ErrorCode::IoError);
    assert!(
        err.message.contains("items"),
        "文案要点名哪张表：{}",
        err.message
    );
    assert!(err.message.contains("源 2"), "要写出源库行数：{}", err.message);
    assert!(err.message.contains("副本 1"), "要写出副本行数：{}", err.message);

    transfer::write_incomplete(&dest, &err.message);
    assert!(
        dest.join(transfer::INCOMPLETE_FILE).is_file(),
        "核对失败必须在目标目录留一份说明（用户可自己删）"
    );
    pool.close().await;
    std::fs::remove_dir_all(&source).ok();
    std::fs::remove_dir_all(&dest).ok();
}

/// ③ 五项清单与体积：源里没有的项 `present: false` 且 0 字节（**不造空目录**）。
#[test]
fn entries_report_presence_and_skip_missing_dirs() {
    let root = support::unique_dir("transfer-entries");
    std::fs::create_dir_all(root.join("md")).expect("建 md");
    std::fs::write(root.join("md/2026-11-07.md"), b"# 1").expect("写文件");
    std::fs::write(root.join("timing.db"), b"0123456789").expect("写库");

    let entries = transfer::entries(&root);
    let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
    assert_eq!(
        names,
        vec![
            "timing.db",
            "backups",
            "logs",
            "md",
            "migrated-from-tickbar-app.json"
        ],
        "五项与顺序是 PRD 4.2 的口径"
    );
    let db_entry = &entries[0];
    assert!(db_entry.present && db_entry.bytes == 10 && !db_entry.is_dir);
    let md_entry = &entries[3];
    assert!(md_entry.present && md_entry.is_dir && md_entry.bytes == 3);
    let backups = &entries[1];
    assert!(!backups.present, "源里没有就不许报 0 字节");
    assert_eq!(transfer::total_bytes(&root), 13, "只算五项之和");
    std::fs::remove_dir_all(&root).ok();
}

/// ④ 预检四类拒绝，逐条断言文案（用户唯一的行动依据，不能含糊）。
#[test]
fn preflight_rejects_four_shapes_with_exact_wording() {
    let base = support::unique_dir("preflight");
    let current = base.join("current");
    std::fs::create_dir_all(&current).expect("建当前根");

    let same = preflight(&current, &current).expect_err("同一个目录必须拒绝");
    assert_eq!(same.message, "已经在用这个目录");

    let child = preflight(&current.join("sub"), &current).expect_err("子目录必须拒绝");
    assert_eq!(
        child.message,
        "不能选当前数据目录里面的文件夹（或它的上级）"
    );
    let parent = preflight(&base, &current).expect_err("上级目录必须拒绝");
    assert_eq!(
        parent.message,
        "不能选当前数据目录里面的文件夹（或它的上级）",
        "祖先与后代是同一句：对用户是同一件事"
    );

    let used = base.join("used");
    std::fs::create_dir_all(&used).expect("建非空目录");
    std::fs::write(used.join("keep.txt"), b"x").expect("写文件");
    let non_empty = preflight(&used, &current).expect_err("非空目录必须拒绝");
    assert_eq!(
        non_empty.message,
        "这个文件夹里已有文件，请选一个空文件夹或新建一个"
    );

    /* 不可写：拿「父路径是一个文件」构造，比 set_readonly 稳定（Windows 上对目录设
    只读位并不阻止 ACL 允许的写入）。 */
    let blocker = base.join("blocker.txt");
    std::fs::write(&blocker, b"x").expect("写文件");
    let unwritable = preflight(&blocker.join("data"), &current).expect_err("必然写不进去");
    assert!(
        unwritable.message.starts_with("不可写："),
        "不可写要带系统原文：{}",
        unwritable.message
    );
    std::fs::remove_dir_all(&base).ok();
}

/// ⑤ 空目录通过预检（会被 probe 建出来），且 `switch` 成功后指针写对、`previous`
/// 指回切换前生效的根。
#[tokio::test]
async fn switch_writes_pointer_with_previous_root() {
    let (source, pool) = pool_at("switch-ok").await;
    seed(&pool).await;
    let appdata = support::unique_dir("switch-appdata");
    let target = support::unique_dir("switch-target");

    switch(&pool, &appdata, &source, &target.to_string_lossy())
        .await
        .expect("切换应成功");
    let pointer = root_pointer::read(&appdata).expect("指针要写出来");
    assert_eq!(
        PathBuf::from(&pointer.data_dir),
        target,
        "指针指向用户选的那个目录"
    );
    assert_eq!(
        pointer.previous.as_deref().map(Path::new),
        Some(source.as_path()),
        "previous 必须是切换那一刻**正在生效**的根（撤销时用它回退）"
    );
    assert!(target.join("timing.db").is_file(), "库要真的搬过去");
    assert!(source.join("timing.db").is_file(), "旧目录**不删**");
    pool.close().await;
    std::fs::remove_dir_all(&source).ok();
    std::fs::remove_dir_all(&appdata).ok();
    std::fs::remove_dir_all(&target).ok();
}

/// ⑥ 预检失败时**不写指针**：用户点完「确认」却什么都没变，配置也不能被改坏。
#[tokio::test]
async fn failed_switch_leaves_no_pointer() {
    let (source, pool) = pool_at("switch-fail").await;
    let appdata = support::unique_dir("switch-fail-appdata");
    let target = support::unique_dir("switch-fail-target");
    std::fs::create_dir_all(&target).expect("建目标");
    std::fs::write(target.join("keep.txt"), b"x").expect("写文件");

    let err = switch(&pool, &appdata, &source, &target.to_string_lossy())
        .await
        .expect_err("非空目录必须拒绝");
    assert_eq!(err.message, "这个文件夹里已有文件，请选一个空文件夹或新建一个");
    assert!(
        root_pointer::read(&appdata).is_none(),
        "预检失败绝不能写指针"
    );
    pool.close().await;
    std::fs::remove_dir_all(&source).ok();
    std::fs::remove_dir_all(&appdata).ok();
    std::fs::remove_dir_all(&target).ok();
}
