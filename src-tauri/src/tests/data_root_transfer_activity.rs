//! 搬迁清单第六项（`patina/data/patina.db`）的复制与核对。
//!
//! 与 `data_root_transfer_patina` 分成两个文件，是因为它们钉的是**两件事**：那边钉
//! 「活动数据到底有没有跟着搬」「搬完还会不会再导一次」，这边钉「搬过去的那份是不是
//! 一份**能用的**库」。合成一个文件就 308 行了（门禁 300），而且失败时该看哪一个也不清楚。
//!
//! 两条用例各自钉一条具体失效：
//! ① 按目录拷 → 主文件与 `-wal` 是两个时刻的拼接。搬迁是**运行时命令**，执行那一刻
//!    分析窗开着、活动库的池也开着、`-wal` 里还躺着没 checkpoint 的帧——所以这里故意
//!    让池保持打开，并先断言 `-wal` 非空（否则用例什么也证明不了）。
//! ② 副本坏了没人发现。`verify()` 比的是 `timing.db` 那五张表的行数，活动库不在其中；
//!    所以给副本补一次 `PRAGMA quick_check`，坏库必须当场报出来。
//!
//! 两种失效都必须靠**能只读打开 + 结构自检**才发现，所以夹具从
//! `data_root_transfer_patina` 借（同一套活动库造法，避免两份 DDL 各自漂移）。

use crate::infra::db;
use crate::services::data_root::transfer;
use crate::tests::support;
use crate::tests::data_root_transfer_patina::{inspect_activity, open_activity_db, write_activity_db};

/// ① 活库搬迁：`-wal` 里未合并的帧也必须在新根里，且副本是单文件、结构完好、源库不动。
#[tokio::test]
async fn live_activity_database_is_copied_as_one_consistent_snapshot() {
    let source = support::unique_dir("patina-live");
    let pool = db::init_pool(&source).await.expect("建业务库");
    let activity = source.join("patina").join("data");
    std::fs::create_dir_all(&activity).expect("建 patina/data");
    /* 池**不关**：这就是「分析窗开着、活动库的池也开着」那一刻的真实状态。 */
    let live = open_activity_db(&activity.join("patina.db"), 3, true).await;
    let wal = activity.join("patina.db-wal");
    assert!(
        std::fs::metadata(&wal).map_or(false, |meta| meta.len() > 0),
        "前提：`-wal` 里必须有没 checkpoint 的帧，否则这条用例什么也证明不了"
    );

    let dest = support::unique_dir("patina-live-dest");
    transfer::copy_all(&pool, &source, &dest)
        .await
        .expect("复制应成功");
    transfer::verify(&pool, &dest).await.expect("核对应通过");

    let copied = dest.join("patina/data/patina.db");
    assert!(copied.is_file(), "活动库必须落在新根");
    let (rows, verdict) = inspect_activity(&copied).await;
    assert_eq!(
        rows, 3,
        "三行都得在：`-wal` 里那部分不能因为「只拷主文件」丢掉"
    );
    assert_eq!(verdict, "ok", "副本必须是 SQLite 自己认的结构完整库");
    assert!(
        !dest.join("patina/data/patina.db-wal").exists()
            && !dest.join("patina/data/patina.db-shm").exists(),
        "VACUUM INTO 的产物是单文件：目标里不该有 -wal / -shm"
    );
    let source_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
        .fetch_one(&live)
        .await
        .expect("读源库");
    assert_eq!(source_rows, 3, "源库一行都不许少（搬迁只复制、不删除）");
    live.close().await;
    pool.close().await;
    std::fs::remove_dir_all(&source).ok();
    std::fs::remove_dir_all(&dest).ok();
}

/// ② 副本坏了要当场报：「搬过去一份打不开的库」不许当成功。
#[tokio::test]
async fn corrupted_activity_copy_fails_verification() {
    let source = support::unique_dir("patina-corrupt");
    let pool = db::init_pool(&source).await.expect("建业务库");
    let activity = source.join("patina").join("data");
    std::fs::create_dir_all(&activity).expect("建 patina/data");
    write_activity_db(&activity.join("patina.db"), 1).await;
    let dest = support::unique_dir("patina-corrupt-dest");
    transfer::copy_all(&pool, &source, &dest)
        .await
        .expect("复制应成功");

    std::fs::write(dest.join("patina/data/patina.db"), b"not a database").expect("弄坏副本");
    let err = transfer::verify(&pool, &dest)
        .await
        .expect_err("坏副本必须核对失败");
    assert!(
        err.message.contains("活动库副本"),
        "文案要点名是活动库：{}",
        err.message
    );
    pool.close().await;
    std::fs::remove_dir_all(&source).ok();
    std::fs::remove_dir_all(&dest).ok();
}
