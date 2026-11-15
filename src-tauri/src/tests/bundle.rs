//! [批 2 · 第 5 项] 全额数据包（`bundle`）的语义用例。
//!
//! 三条必测口径（团队验收要求）：**schema 往返 / 幂等 / 无 uid 表走 skipped 不炸**。
//! 用真库（`support::fresh_pool` 走真实迁移）+ 一份手写的活动库 DDL（形状照抄真机
//! `patina.db`：`sessions.app_key` 是生成列、`sessions.uid` 是部分唯一索引）。
//!
//! 不测的东西：UI 的按钮接线（前端 vitest 管）、`rfd` 弹窗（要真人点）。

use crate::services::activity::data::bundle::{export_full_bundle, import_full_bundle, inspect_file};
use crate::tests::support;
use serde_json::Value;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::path::PathBuf;

/// 活动库的最小真实形状（列/索引/生成列都照真机抄，只有注释和空行被删掉）。
const ACTIVITY_DDL: &[&str] = &[
    "CREATE TABLE app_category (id INTEGER PRIMARY KEY AUTOINCREMENT, app_key TEXT NOT NULL,
        category_key TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 100,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        device_id TEXT NOT NULL DEFAULT '', uid TEXT,
        updated_at_ms INTEGER NOT NULL DEFAULT 0, UNIQUE (app_key, category_key))",
    "CREATE UNIQUE INDEX uq_app_category_uid ON app_category(uid) WHERE uid IS NOT NULL",
    "CREATE TABLE focus_blocks (uid TEXT PRIMARY KEY, device_id TEXT NOT NULL,
        item_uid TEXT NOT NULL, item_name TEXT NOT NULL, category_key TEXT,
        start_time INTEGER NOT NULL, end_time INTEGER,
        updated_at_ms INTEGER NOT NULL DEFAULT 0)",
    "CREATE TABLE sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, app_name TEXT NOT NULL,
        exe_name TEXT NOT NULL, window_title TEXT, start_time INTEGER NOT NULL,
        end_time INTEGER, duration INTEGER, continuity_group_start_time INTEGER,
        device_id TEXT NOT NULL DEFAULT '', uid TEXT,
        updated_at_ms INTEGER NOT NULL DEFAULT 0, synced_seq INTEGER,
        app_key TEXT GENERATED ALWAYS AS (LOWER(exe_name)) VIRTUAL)",
    "CREATE UNIQUE INDEX uq_sessions_uid ON sessions(uid) WHERE uid IS NOT NULL",
    "CREATE UNIQUE INDEX uq_sessions_open_per_device ON sessions(device_id) WHERE end_time IS NULL",
    "CREATE TABLE icon_cache (exe_name TEXT PRIMARY KEY, icon_base64 TEXT NOT NULL,
        last_updated INTEGER)",
    "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
];

/// 一份能当活动库用的空库（真文件，不是 `:memory:`——导入要开事务、要能重开）。
/// 也被同目录的「真机数据」用例复用（它要一份照真机形状的活动库）。
pub(crate) async fn activity_pool(tag: &str) -> (SqlitePool, PathBuf) {
    let dir = support::unique_dir(tag);
    std::fs::create_dir_all(&dir).expect("建活动库目录");
    let path = dir.join("patina.db");
    let options = SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("打开活动库");
    for sql in ACTIVITY_DDL {
        sqlx::query(sql).execute(&pool).await.expect("建活动表");
    }
    (pool, path)
}

fn bundle_path(tag: &str) -> PathBuf {
    let dir = support::unique_dir(tag);
    std::fs::create_dir_all(&dir).expect("建临时目录");
    dir.join("Timing-full.json")
}

/// 判据 1 + 2：`format` 是硬契约；导出的行数与库内一致；能被预览读回且总行数相等。
#[tokio::test]
async fn exported_bundle_round_trips_through_inspect() {
    let business = support::fresh_pool("bundle-rt-biz").await;
    let (activity, _) = activity_pool("bundle-rt-act").await;
    support::exec(
        &business,
        "INSERT INTO todos (title, sort_order, created_at, updated_at) \
         VALUES ('买咖啡', 0, 1, 1)",
    )
    .await;
    sqlx::query(
        "INSERT INTO sessions (app_name, exe_name, start_time, end_time, duration, device_id, uid, updated_at_ms) \
         VALUES ('Code', 'code.exe', 1000, 2000, 1, 'dev-a', 's:dev-a:1', 1)",
    )
    .execute(&activity)
    .await
    .expect("插活动行");

    let path = bundle_path("bundle-rt");
    let summary = export_full_bundle(&business, &activity, &path, "dev-a")
        .await
        .expect("导出应成功");
    let raw = std::fs::read(&path).expect("读包");
    let parsed: Value = serde_json::from_slice(&raw).expect("包必须是合法 JSON");

    assert_eq!(parsed["format"], "timing.full-bundle.v1");
    assert_eq!(parsed["deviceId"], "dev-a");
    assert!(summary.bytes > 0 && summary.table_count > 0);
    /* 导出是全量（含软删）：行数必须与 `COUNT(*)` 逐字相等。 */
    let items_total = support::scalar_i64(&business, "SELECT COUNT(*) FROM items").await;
    assert_eq!(
        parsed["business"]["items"].as_array().expect("items 数组").len() as i64,
        items_total,
    );
    assert_eq!(
        parsed["activity"]["sessions"].as_array().expect("sessions 数组").len(),
        1,
    );
    /* 生成列也在包里（导入时按 `table_xinfo` 跳过，不写回去）。 */
    assert_eq!(parsed["activity"]["sessions"][0]["app_key"], "code.exe");

    let preview = inspect_file(&path).expect("预览应成功");
    assert!(preview.compatible, "同一版本导出的包必须兼容");
    assert_eq!(preview.total_rows, summary.row_count, "预览总行数应等于导出行数");
    assert!(preview.tables.iter().any(|t| t.name == "activity.sessions" && t.rows == 1));
}

/// 判据 3 的前半：导入到空库后各表行数与包内一致（含活动库的生成列表）。
#[tokio::test]
async fn importing_into_a_fresh_database_reproduces_the_counts() {
    let source = support::fresh_pool("bundle-count-src").await;
    let (source_activity, _) = activity_pool("bundle-count-src-act").await;
    support::exec(
        &source,
        "INSERT INTO todos (title, sort_order, created_at, updated_at) \
         VALUES ('写周报', 0, 10, 10)",
    )
    .await;
    sqlx::query(
        "INSERT INTO sessions (app_name, exe_name, start_time, end_time, duration, device_id, uid, updated_at_ms) \
         VALUES ('Code', 'code.exe', 1000, 2000, 1, 'dev-a', 's:dev-a:1', 1)",
    )
    .execute(&source_activity)
    .await
    .expect("插活动行");

    let path = bundle_path("bundle-count");
    export_full_bundle(&source, &source_activity, &path, "dev-a")
        .await
        .expect("导出应成功");
    let source_todos = support::scalar_i64(&source, "SELECT COUNT(*) FROM todos").await;
    let source_items = support::scalar_i64(&source, "SELECT COUNT(*) FROM items").await;

    let target = support::fresh_pool("bundle-count-dst").await;
    let (target_activity, _) = activity_pool("bundle-count-dst-act").await;
    let result = import_full_bundle(&target, &target_activity, &path)
        .await
        .expect("导入应成功");
    assert!(result.total_inserted > 0, "空库里应有新增");
    assert!(
        result.tables.iter().any(|stat| stat.name == "activity.sessions" && stat.inserted == 1),
        "活动行的统计缺失：{:?}",
        result.tables
    );

    assert_eq!(
        support::scalar_i64(&target, "SELECT COUNT(*) FROM todos").await,
        source_todos,
        "待办行数应与源库一致",
    );
    /* 源库那条种子事项（`uid` 空、`device_id` 空）现在被**合成 uid** 后照常导入，
       目标库自己还有一条种子 ⇒ 行数 = 源 + 1。从前的「按 id 忽略」会静默少一行。 */
    assert_eq!(
        support::scalar_i64(&target, "SELECT COUNT(*) FROM items").await,
        source_items + 1,
        "事项应一行不少地导进来（目标库自带的种子另算）",
    );
    let sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
        .fetch_one(&target_activity)
        .await
        .expect("数活动行");
    assert_eq!(sessions, 1);
    /* 判据 4：导入不许产生 uid 为空的事项 —— 全库只剩目标库自带的种子那一行。 */
    assert_eq!(
        support::scalar_i64(&target, "SELECT COUNT(*) FROM items WHERE uid IS NULL").await,
        1,
    );
}

/// 判据 3 的后半：同一份包再导一次，**什么都没变**（`inserted == 0 && updated == 0`）。
#[tokio::test]
async fn importing_the_same_bundle_twice_inserts_nothing_new() {
    let source = support::fresh_pool("bundle-idem-src").await;
    let (source_activity, _) = activity_pool("bundle-idem-src-act").await;
    support::exec(
        &source,
        "INSERT INTO todos (title, sort_order, created_at, updated_at) VALUES ('取快递', 0, 5, 5)",
    )
    .await;
    /* 一条**原生带 uid** 的事项（种子那一行的 uid 是空的，走的是合成那条路）。 */
    support::exec(
        &source,
        "INSERT INTO items (name, status, is_system, sort_order, created_at, updated_at, \
         device_id, uid, updated_at_ms) \
         VALUES ('事项A', 'active', 0, 0, 100, 100, 'dev-a', 'i:dev-a:99', 100)",
    )
    .await;
    sqlx::query(
        "INSERT INTO app_category (app_key, category_key, created_at, updated_at, device_id, uid) \
         VALUES ('code.exe', 'development', 1, 1, 'dev-a', 'c:dev-a:1')",
    )
    .execute(&source_activity)
    .await
    .expect("插分类行");

    let path = bundle_path("bundle-idem");
    export_full_bundle(&source, &source_activity, &path, "dev-a")
        .await
        .expect("导出应成功");

    let target = support::fresh_pool("bundle-idem-dst").await;
    let (target_activity, _) = activity_pool("bundle-idem-dst-act").await;
    import_full_bundle(&target, &target_activity, &path)
        .await
        .expect("第一次导入应成功");
    let items_after_first = support::scalar_i64(&target, "SELECT COUNT(*) FROM items").await;
    let second = import_full_bundle(&target, &target_activity, &path)
        .await
        .expect("第二次导入应成功");
    assert_eq!(
        second.total_inserted, 0,
        "第二次不应再插任何行：{:?}",
        second.tables
    );
    /* 判据 ②：连「更新」也得是 0 —— uid 类表的守卫是「内容没变就不写」，
       否则 `AFTER UPDATE OF ...` 的 touch 触发器会把每一行的 `updated_at_ms` 推到
       「现在」，重复导入变成一次全库写风暴。 */
    assert_eq!(
        second.total_updated, 0,
        "第二次不应再改任何行：{:?}",
        second.tables
    );
    assert_eq!(
        support::scalar_i64(&target, "SELECT COUNT(*) FROM items").await,
        items_after_first,
        "重复导入不许长出新事项",
    );
}

/// 判据 5 的第三条：无 uid 的表（`todos` / `notes` / 活动库 `settings`）走 `skipped`，
/// 既不报错也不重复插。
#[tokio::test]
async fn tables_without_uid_report_skipped_instead_of_failing() {
    let source = support::fresh_pool("bundle-nouid-src").await;
    let (source_activity, _) = activity_pool("bundle-nouid-src-act").await;
    support::exec(
        &source,
        "INSERT INTO notes (item_id, content, pos_x, pos_y, width, height, is_open, created_at, updated_at) \
         VALUES (NULL, '便签内容', 1, 2, 3, 4, 1, 1, 1)",
    )
    .await;
    sqlx::query("INSERT INTO settings (key, value) VALUES ('color_scheme_dark', 'custom')")
        .execute(&source_activity)
        .await
        .expect("插活动设置");

    let path = bundle_path("bundle-nouid");
    export_full_bundle(&source, &source_activity, &path, "dev-a")
        .await
        .expect("导出应成功");

    let target = support::fresh_pool("bundle-nouid-dst").await;
    let (target_activity, _) = activity_pool("bundle-nouid-dst-act").await;
    import_full_bundle(&target, &target_activity, &path)
        .await
        .expect("第一次导入应成功");
    let second = import_full_bundle(&target, &target_activity, &path)
        .await
        .expect("无 uid 的表不应让整包失败");

    let notes = second
        .tables
        .iter()
        .find(|stat| stat.name == "business.notes")
        .expect("应回报 notes 统计");
    assert_eq!(notes.inserted, 0, "便签不该被重复插");
    assert!(notes.skipped > 0, "便签应记成 skipped：{notes:?}");
    let activity_settings = second
        .tables
        .iter()
        .find(|stat| stat.name == "activity.settings")
        .expect("应回报活动库 settings 统计");
    assert_eq!(activity_settings.inserted, 0);
    assert!(activity_settings.skipped > 0, "本地已有则跳过：{activity_settings:?}");
    /* 机器身份类键**永不**跨设备搬。 */
    let token: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM settings WHERE key IN \
         ('web_activity_token', 'remote_status_bridge_token', 'remote_status_bridge_machine_id')",
    )
    .fetch_one(&target_activity)
    .await
    .expect("数身份键");
    assert_eq!(token, 0, "活动库身份键不该被导入");
    /* 本机 `install_id.txt` 不动：包里的 deviceId 不落库。 */
    let device: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sessions WHERE device_id <> 'dev-a' AND device_id <> ''",
    )
    .fetch_one(&target_activity)
    .await
    .expect("数 device_id");
    assert_eq!(device, 0, "导入行必须保留包里的 device_id");
}
