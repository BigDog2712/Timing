//! `activity_bridge` 的判据：SQL 裁剪口径 + **装配级**的双开关分离。
//!
//! 拆出本文件只为 300 行门禁（仓里既有做法，见 `storage_paths_tests.rs`）。

use super::*;
use sqlx::sqlite::SqlitePoolOptions;

use crate::infra::activity::activity_layout::{activity_subdir_of, db_file_of};
use crate::infra::activity::storage_paths::{
    StoragePaths, ACTIVITY_DATA_REL, ACTIVITY_SUBDIR, DATA_SUBDIR, SQLITE_DB_FILE_NAME,
    WEBVIEW_SUBDIR,
};

#[test]
fn inverted_range_is_rejected_before_touching_the_database() {
    /* 前置判断做成纯函数，才能在**不建库**的情况下钉住「空区间不查库」。
    直接断言 `activity_summary` 返回空是断不出东西的——它对任何错误都返回空。 */
    assert!(!range_is_queryable(10, 5, 10));
    assert!(!range_is_queryable(5, 5, 10));
    assert!(!range_is_queryable(5, 10, 0));
    assert!(range_is_queryable(5, 10, 10));
}

/* 真正容易写错的是那段 SQL 的裁剪口径：拿 `duration` 直接求和，在整段查询里看起来
完全正常，只有**横跨区间边界**的会话会凭空多算。这里用内存库跑同一条语句钉死它：
会话 10 分钟，区间只覆盖末尾 2 分钟 → 120 秒，而不是 600。 */
#[tokio::test]
async fn overlapping_sessions_are_clipped_to_the_range() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("in-memory sqlite");
    sqlx::query(
        "CREATE TABLE sessions (
            app_name TEXT NOT NULL, exe_name TEXT NOT NULL,
            start_time INTEGER NOT NULL, end_time INTEGER NOT NULL, duration INTEGER NOT NULL)",
    )
    .execute(&pool)
    .await
    .expect("create table");

    let start = 1_000_000_i64;
    // ① 横跨左边界：0-10 分钟，区间从第 8 分钟开始 → 应计 2 分钟
    insert_session(&pool, "Editor", "editor.exe", start, start + 600_000).await;
    // ② 完全落在区间内：第 8.3 到第 9.3 分钟 → 应计 60 秒
    insert_session(
        &pool,
        "Browser",
        "chrome.exe",
        start + 500_000,
        start + 560_000,
    )
    .await;
    // ③ 完全在区间之前：不该出现在结果里
    insert_session(&pool, "Mail", "mail.exe", start - 900_000, start - 600_000).await;

    let from = start + 480_000;
    let to = start + 600_000;
    let rows = sqlx::query_as::<_, crate::models::stats::ActivitySlice>(ACTIVITY_SQL)
        .bind(from)
        .bind(to)
        .bind(10_i64)
        .fetch_all(&pool)
        .await
        .expect("query");

    assert_eq!(rows.len(), 2, "区间外的应用不该出现在结果里");
    assert_eq!(rows[0].app, "Editor");
    assert_eq!(
        rows[0].sec, 120,
        "跨界会话必须按区间裁剪，不能拿 duration 求和"
    );
    assert_eq!(rows[0].samples, 1);
    assert_eq!(rows[1].app, "Browser");
    assert_eq!(rows[1].sec, 60, "完全落在区间内的会话按原样计入");
}

/* ── 装配级判据：两个开关一路分开走到 `StoragePaths` ─────────────────────────
`activity_layout_tests::webview_layout_is_independent_of_the_data_layout` 只证明
**两个纯函数**在同一个根上给不同结论。它证明不了装配层没把它们合并——而装配层曾经
就是用一个 `OnceLock<PathBuf>` 合并的（一个值喂两条路径），于是
`data = New` / `webview = Old` 这个状态**没有任何取值能表达**。

这一条从 `roots_in` 一路走到 `StoragePaths.db_path` / `webview_root`：
  · 目录接错（`activity_root` 硬编码 `"patina"`）→ 第一条断言红；
  · 库名接错（恒用 `SQLITE_DB_FILE_NAME` 而不看布局）→ 第三条断言红；
  · 两个槽被合成一个（profile 跟着数据走）→ 第二条断言红。
纯函数、不建任何目录：这三处接错都发生在**拼接**那一层，与磁盘无关。 */
#[test]
fn the_two_layouts_stay_separate_all_the_way_into_storage_paths() {
    let root = Path::new("timing-root");
    let roots = roots_in(root, Layout::New, Layout::Old);

    assert_eq!(
        roots.data,
        root.join(ACTIVITY_SUBDIR),
        "数据那半必须落在新目录（写死旧名就是「历史全空、界面正常」）"
    );
    assert_eq!(
        roots.webview,
        root.join(activity_subdir_of(Layout::Old)),
        "profile 那半必须留在旧目录：rename 失败不该把已经切好的数据也退回去"
    );

    /* 下游两条 `product_*_dir` 各自补一个尾段，这里按同一算术拼出 `StoragePaths`。
    库名取**数据**布局那一份——这正是 `default_storage_paths` 传的那个值。 */
    let paths = StoragePaths::from_roots(
        roots.data.join(DATA_SUBDIR),
        roots.webview.join(WEBVIEW_SUBDIR),
        false,
        false,
        db_file_of(Layout::New),
    );
    assert_eq!(
        paths.db_path,
        root.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME),
        "库名与目录名必须出自同一套布局"
    );
    assert_eq!(
        paths.webview_root,
        root.join(activity_subdir_of(Layout::Old))
            .join(WEBVIEW_SUBDIR),
        "profile 落点不许被数据落点带着走（`patina/webview`，不是 `patina/data/webview`）"
    );
}

async fn insert_session(pool: &sqlx::SqlitePool, app: &str, exe: &str, start: i64, end: i64) {
    sqlx::query("INSERT INTO sessions (app_name, exe_name, start_time, end_time, duration) VALUES (?, ?, ?, ?, ?)")
        .bind(app)
        .bind(exe)
        .bind(start)
        .bind(end)
        .bind(end - start)
        .execute(pool)
        .await
        .expect("insert session");
}
