//! Patina 子系统的宿主侧接线：数据落点 + 首启导入。
//!
//! 为什么单独一个文件：`bootstrap.rs` 正好 300 行（门禁上限），而这段逻辑
//! 又不属于「Patina 上游代码」，放在 `src/patina/` 下会让 vendored 子树与宿主耦合。
//!
//! 两件事，顺序不能换（由 `lib.rs` 的 setup 闭包保证）：
//! 1. **定落点**：Patina 上游按 `%APPDATA%\Patina` 解析数据根——那正是用户已安装的
//!    Patina 的真实目录。融合后必须改到 Timing 自己的根下，否则两个应用同时打开
//!    同一个 sqlite 文件（WAL 抢锁 → 锁超时 / 库损坏）。
//! 2. **首启导入**：只在**第一次**从 `%APPDATA%\Patina\patina.db` 拷一份过来，让
//!    「已用过 Patina」的用户一进来就看到自己的历史。之后两边各管各的，同不同步是
//!    后续功能，不在这里做。导入本身（指针闸 / 「已处理过」标记 / 目标库兜底）在
//!    `legacy_import`。

use std::path::{Path, PathBuf};

use crate::infra::activity::activity_layout::{self, Layout};
use crate::infra::activity::storage_paths::{timing_data_root, DATA_SUBDIR};

/// 活动数据与 profile 在 Timing 数据根下的两条落点（`<数据根>/{activity,patina}` 那一层）。
///
/// ⚠️ **不含 `data` / `webview` 尾段**：下游的 `product_roaming_data_dir` /
/// `product_webview_data_dir` 各自会 `join("data")` / `join("webview")`。把尾段也带上，
/// 拿到的就是 `<数据根>/activity/data/data`——不报错，只是一份空库。
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ActivityRoots {
    pub data: PathBuf,
    pub webview: PathBuf,
}

/// 由「数据根 + 两份布局决议」算落点。**纯函数**：无 IO、不碰进程级缓存。
///
/// 生产入口传 `timing_data_root()` 与两个 `OnceLock` 开关；判据入口可以传任意临时根 +
/// 任意组合。`data = New` / `webview = Old` 这一组是约束 7 要求**必须能存在**的状态
/// （`VACUUM INTO` 成功 + `rename` 因 profile 被占用失败），只有这条缝能把它造出来——
/// 一个 `OnceLock<PathBuf>` 在结构上表达不了它，这就是它非得是两个槽的理由。
pub(crate) fn roots_in(root: &Path, data: Layout, webview: Layout) -> ActivityRoots {
    ActivityRoots {
        data: root.join(activity_layout::activity_subdir_of(data)),
        webview: root.join(activity_layout::activity_subdir_of(webview)),
    }
}

/// 生产口径：两个开关**各读各的**，中间不许有任何合并。
fn roots() -> ActivityRoots {
    roots_in(
        &timing_data_root(),
        activity_layout::data_layout(),
        activity_layout::webview_layout(),
    )
}

/// 活动**数据**落点：`<数据根>/activity`，fail-open 时是 `<数据根>/patina`。
///
/// 子目录名由 `activity_layout::data_layout()` 决定，**不写字面量**：`activity_dir_migrate`
/// fail-open 回旧布局时应用必须继续读写旧库，否则它会去开一个空的 `activity/data`，
/// 用户视角是「历史全没了、应用一切正常」。
///
/// ⚠️ 首次调用会做一次 `PRAGMA quick_check`（`block_on`），所以它必须在**同步**启动段
/// 先被调一次——[`prepare`] 一进门就调它，那就是那次。别在异步命令里首次调它。
///
/// [`roots`] 里那两个 `data_layout` / `webview_layout` 的调用，是 `check:de-patina`
/// 判据 6 的结构检查点：**两个开关都必须接上，且不许只接一个**。
pub fn activity_data_root() -> PathBuf {
    roots().data
}

/// 活动窗 **WebView2 profile** 的落点：`<数据根>/activity`，fail-open 时是 `<数据根>/patina`。
///
/// 与数据那半**各用各的开关**：profile 被占住搬不动，不该把数据也退回去（反之亦然）。
pub fn activity_webview_root() -> PathBuf {
    roots().webview
}

/// 启动期一次性准备。返回 `Ok(None)` = 本次没导入（指针在 / 标记已写 / 目标库已在 / 没有源）。
///
/// `identifier` 只用于求 `%APPDATA%\<identifier>`——指针文件（`data-root.json`）就在那里，
/// 而「数据根是用户显式选的吗」这个判据只能从它读出来。
///
/// 失败**不阻断启动**：Patina 子系统照常跑，只是历史为空——比整个应用起不来好。
pub fn prepare(identifier: &str) -> Result<Option<PathBuf>, String> {
    /* 建的是**数据侧**那一层。Old 布局下它是 `patina/data`（老用户本来就有）；绝不能
    在这里建 `activity/`——那会让下一次启动的布局决议看到「新目录已存在」而判成 New，
    于是空库变永久。整段只碰数据侧，`WEBVIEW_SUBDIR` 一个字都不出现（尾段由下游
    `product_webview_data_dir` 自己补）。 */
    let data_root = activity_data_root();
    let data_dir = data_root.join(DATA_SUBDIR);
    std::fs::create_dir_all(&data_dir)
        .map_err(|err| format!("创建 {} 失败: {err}", data_dir.display()))?;

    // 落点在创建之后立刻注入：Patina 的 setup 会拿它建库，晚一步就落到 AppData 去了。
    // 数据与 profile **分别注入**：两个布局各判各的，合并成一个值就等于把两个开关绑在一起。
    crate::infra::activity::app_paths::set_data_root_override(data_root);
    crate::infra::activity::app_paths::set_webview_root_override(activity_webview_root());

    /* 拿不到 `%APPDATA%` 就当没有指针：那种环境下也不可能读到过指针文件。 */
    let appdata = crate::platform::app_dir::appdata_dir(identifier);
    crate::app::legacy_import::seed(&data_dir, appdata.as_deref())
}

/* ─────────────────────────── 数据互见（读侧） ───────────────────────────
宿主要在自己的统计里显示「同期电脑活动」，就得读 Patina 的活动库。这里只读、
不写、不建表：**写入永远是 Patina 自己的事**，宿主插一脚会跟它的补写/回滚逻辑打架。

为什么另开一条连接而不是复用 Patina 的池：那个池是 `crate::services::activity::data::sqlite_pool` 的
私有状态，借出来等于让宿主代码依赖 vendored 子树的内部实现；而且它是**可写**连接，
一旦被宿主拿去跑查询，将来有人顺手写一条 UPDATE 就绕过了 Patina 的全部不变量。
单开一条 `mode=ro` 的池，物理上就写不进去。 */

/// 活动库连接池：只读、单连接、懒建。
///
/// `OnceCell` 只缓存**成功**的连接（`get_or_try_init`）：库当时还不存在（首次启动
/// Patina 尚未建库）时会在下一次调用重试，而不是永久缓存一个「没有」。
static ACTIVITY_POOL: tokio::sync::OnceCell<sqlx::SqlitePool> = tokio::sync::OnceCell::const_new();

/// 活动库的绝对路径。
///
/// 目录名与库名**一起**由 `activity_layout::db_path_in` 给：库名是单真源，任何一处自带
/// 字面量都会在改名/回退时与主路径分叉，导致同进程开两个库文件（一个新建、一个已存在，
/// WAL 互不锁）。Old 布局下库名是 `patina.db`——这里若还写 `SQLITE_DB_FILE_NAME`，读侧会去
/// 开 `patina/data/activity.db` 这个空库。
fn activity_db_path() -> PathBuf {
    activity_layout::db_path_in(&timing_data_root(), activity_layout::data_layout())
}

/// 活动库连接池：只读、单连接、懒建。**导出全额数据包也用它**（`bundle_cmd`），
/// 所以是 `pub(crate)`——但依旧是 `mode=ro` 的那一条，拿不到写能力。
pub(crate) async fn activity_pool() -> Result<&'static sqlx::SqlitePool, String> {
    ACTIVITY_POOL
        .get_or_try_init(|| async {
            use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

            let path = activity_db_path();
            if !path.is_file() {
                return Err(format!("{} 不存在", path.display()));
            }
            let options = SqliteConnectOptions::new()
                .filename(&path)
                .read_only(true)
                /* Patina 正在写（WAL）时读会被短暂挡住：给 2 秒余量，超时就当本次没数据，
                不能让它把记录面板拖成转圈。 */
                .busy_timeout(std::time::Duration::from_secs(2));
            SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(options)
                .await
                .map_err(|err| format!("打开 {} 失败: {err}", path.display()))
        })
        .await
}

/// 查询区间是否值得查库（纯函数：空/反向区间直接返回空，不碰数据库）。
fn range_is_queryable(from_ms: i64, to_ms: i64, limit: i64) -> bool {
    to_ms > from_ms && limit > 0
}

/// 活动聚合查询。抽成常量是为了让用例跑**同一条**语句——SQL 里那段裁剪口径是唯一
/// 容易写错的地方，测试另写一份 SQL 就失去意义了。
const ACTIVITY_SQL: &str = "\
    SELECT app_name AS app, \
           exe_name AS exe, \
           CAST(SUM(MIN(end_time, ?2) - MAX(start_time, ?1)) / 1000 AS INTEGER) AS sec, \
           COUNT(*) AS samples \
    FROM sessions \
    WHERE end_time > ?1 AND start_time < ?2 \
    GROUP BY app_name, exe_name \
    ORDER BY sec DESC \
    LIMIT ?3";

/// 区间内的电脑活动，按应用聚合、按秒降序。
///
/// **跨界裁剪**：会话可能横跨查询区间（例如 8:00 就在用编辑器，而区间从 10:00 开始），
/// 所以时长取 `min(end, to) - max(start, from)`，不能直接用 `duration` 列——那是会话原始
/// 时长，会把区间外的部分算进来。
///
/// 失败一律返回空数组：这条数据是**旁证**，拿不到就不显示，绝不能因为它让记录面板报错。
pub async fn activity_summary(
    from_ms: i64,
    to_ms: i64,
    limit: i64,
) -> Vec<crate::models::stats::ActivitySlice> {
    if !range_is_queryable(from_ms, to_ms, limit) {
        return Vec::new();
    }
    let pool = match activity_pool().await {
        Ok(pool) => pool,
        Err(err) => {
            crate::log_warn!("patina: activity summary unavailable: {err}");
            return Vec::new();
        }
    };
    match sqlx::query_as::<_, crate::models::stats::ActivitySlice>(ACTIVITY_SQL)
        .bind(from_ms)
        .bind(to_ms)
        .bind(limit)
        .fetch_all(pool)
        .await
    {
        Ok(rows) => rows.into_iter().filter(|row| row.sec > 0).collect(),
        Err(err) => {
            crate::log_warn!("patina: activity summary query failed: {err}");
            Vec::new()
        }
    }
}

/* 本文件已贴着 300 行门禁：用例住到 `activity_bridge_tests.rs`（仓里既有做法，
见 `storage_paths_tests.rs` / `activity_layout_tests.rs`）。 */
#[cfg(test)]
#[path = "activity_bridge_tests.rs"]
mod activity_bridge_tests;
