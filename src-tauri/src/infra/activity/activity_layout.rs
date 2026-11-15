//! 活动数据「两种布局」的**运行期决议**（T05）。
//!
//! ## 为什么这段在 `infra` 而不在 `app`
//!
//! 搬数据根（`services::data_root`）必须知道「活动数据现在到底住哪个目录」，否则
//! Legacy 布局下它会去搬一个不存在的 `activity/data` ⇒ 用户搬盘后活动历史不被搬、
//! 且零报错。而 `services` 不许反向依赖 `app`（装配层在最上面）。这里只有
//! 「文件系统事实 + 一份记忆」，没有任何编排动作，放 `infra` 两个上层都能读。
//!
//! ## 两个开关必须分开（硬约束）
//!
//! `data_layout()` 与 `webview_layout()` **各自**一个 `OnceLock`、各自 fail-open。
//! 合成一个 `ProductLayout` 会丢掉一段历史：`VACUUM INTO` 成功 + `rename` 失败 ⇒
//! 整体停在 Old ⇒ 应用继续写旧库；某天 rename 成功 ⇒ 数据那半看到「新库已存在」跳过
//! ⇒ 切到那份**冻结在首次复制时刻**的副本 ⇒ 之后写进旧库的历史静默消失。
//!
//! ## 两份都在时取 mtime 较新（约束 8）
//!
//! 用户回滚到旧版本 → 旧版本继续写 `patina/data/patina.db` → 再升级回来。此时新库
//! 存在且完好，若按「存在即 New」切过去 ⇒ **回滚期间写的历史静默消失**。所以两份都在
//! 时比 mtime，取较新的一份（平局取 New）。
//!
//! 这条规则**只写一遍**（`activity_source_in`），`fs_only_layout_in`、`transfer` 的清单
//! 派生、`activity_copy::recover_legacy` 都用它——三处各写一遍迟早会长出三种口径。
//!
//! ## 对外只暴露「带完整性闸」的口径
//!
//! 取布局的公开入口只有三个：[`data_layout`]（进程内缓存的生产口径）、
//! [`data_layout_checked_in`]（无缓存，同样带闸）、[`activity_data_dir`]。不看完整性
//! 的那一档是 `fn fs_only_layout_in`（私有），只有本模块的 [`source_spec_in`] 用——
//! 一个「名字更短、行为更危险」的公开函数迟早会被 IDE 补全递给下一个人。

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

use super::storage_paths::{
    timing_data_root, ACTIVITY_DATA_REL, ACTIVITY_SUBDIR, LEGACY_ACTIVITY_DATA_REL,
    LEGACY_ACTIVITY_DB_FILE, SQLITE_DB_FILE_NAME, WEBVIEW_SUBDIR,
};

/// 活动数据用哪一套布局。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Layout {
    /// T05 之后：`<数据根>/activity/{data,webview}`，库名 `activity.db`。
    New,
    /// T05 之前：`<数据根>/patina/{data,webview}`，库名 `patina.db`。
    Old,
}

impl Layout {
    pub fn is_new(self) -> bool {
        matches!(self, Layout::New)
    }
}

static DATA_LAYOUT: OnceLock<Layout> = OnceLock::new();
static WEBVIEW_LAYOUT: OnceLock<Layout> = OnceLock::new();

/// 活动**数据**布局（进程内只算一次）。fail-open：任何不确定都回 [`Layout::Old`]。
///
/// ⚠️ 只在启动期**同步**段调用（`lib.rs` 里 `Builder::default()` 之前）。它会做一次
/// `PRAGMA quick_check`（见 [`data_layout_checked_in`]），不该在热路径上重复调用。
pub fn data_layout() -> Layout {
    *DATA_LAYOUT.get_or_init(|| data_layout_checked_in(&timing_data_root()))
}

/// 活动 **webview profile** 布局（独立开关，见模块头）。
pub fn webview_layout() -> Layout {
    *WEBVIEW_LAYOUT.get_or_init(|| webview_layout_in(&timing_data_root()))
}

/// 活动数据目录（**当前应当读写的那个**）的绝对路径。
///
/// 决议为 Old 时返回 `patina/data`——迁移失败（fail-open）后应用照旧读写旧库，
/// 而不是去开一个空的 `activity/data`。
pub fn activity_data_dir() -> PathBuf {
    source_dir(&timing_data_root(), data_layout())
}

/// 活动 **webview profile** 目录（当前应当用的那个）的绝对路径。
pub fn activity_webview_dir() -> PathBuf {
    timing_data_root()
        .join(activity_subdir_of(webview_layout()))
        .join(WEBVIEW_SUBDIR)
}

/// 活动**库**在给定数据根下的路径。目录名与库名出自**同一个** `Layout`——分两次取就有
/// 机会取到两套（`activity/data/patina.db` 这种空库，或反过来），而它不报错。生产口径是
/// `db_path_in(&timing_data_root(), data_layout())`；判据传临时根来断言它。
pub fn db_path_in(root: &Path, layout: Layout) -> PathBuf {
    source_dir(root, layout).join(db_file_of(layout))
}

/// 某个**数据目录**里实际装着哪一份库（两份都在时取新库名，都不在也取新库名）。
///
/// 唯一用途是 `storage_paths::resolve_roots` 给**自定义数据根**定库名：迁移例程只跑
/// 产品数据根，自定义根里可能还躺着 T05 之前的 `patina.db`，那里只能看磁盘事实——
/// 拿进程级的 [`data_layout`] 去回答它是「产品根的答案」，会把自定义根判成新库名，
/// 于是应用在用户自己的目录里开一个空的新库。自定义根里两份都在时取新库名是有意的：
/// 只有 `activity.db` 会被 T05 之后的写入碰到，`patina.db` 那份是只读快照。
pub fn db_file_in(dir: &Path) -> &'static str {
    let new_db = dir.join(SQLITE_DB_FILE_NAME).is_file();
    let old_db = dir.join(LEGACY_ACTIVITY_DB_FILE).is_file();
    if old_db && !new_db {
        return LEGACY_ACTIVITY_DB_FILE;
    }
    SQLITE_DB_FILE_NAME
}

/// 活动子目录名（`activity` / `patina`）。
///
/// 旧名**不从字面量再写一遍**，而是从 `LEGACY_ACTIVITY_DATA_REL` 取父段——旧名在仓里
/// 只能有一个住所，否则「改一处忘一处」会变成这次迁移自己的 bug。
pub fn activity_subdir_of(layout: Layout) -> &'static str {
    match layout {
        Layout::New => ACTIVITY_SUBDIR,
        Layout::Old => Path::new(LEGACY_ACTIVITY_DATA_REL)
            .parent()
            .and_then(Path::to_str)
            .unwrap_or(LEGACY_ACTIVITY_DATA_REL),
    }
}

fn source_dir(root: &Path, layout: Layout) -> PathBuf {
    match layout {
        Layout::New => root.join(ACTIVITY_DATA_REL),
        Layout::Old => root.join(LEGACY_ACTIVITY_DATA_REL),
    }
}

/// 活动数据的**源**相对名（给清单/搬迁用）：New → `activity/data`，Old → `patina/data`。
///
/// 目标侧恒为 `ACTIVITY_DATA_REL`：**新根永远是新布局**，不需要兼容旧名。
pub fn activity_source_rel_in(root: &Path) -> &'static str {
    source_spec_in(root).0
}

/// 某种布局下活动库的文件名（New → `activity.db`，Old → `patina.db`）。
pub fn db_file_of(layout: Layout) -> &'static str {
    match layout {
        Layout::New => SQLITE_DB_FILE_NAME,
        Layout::Old => LEGACY_ACTIVITY_DB_FILE,
    }
}

/// **源侧**的两个名字一次给全：`(相对目录, 库文件名)`。
///
/// 拆成两个 `match` 迟早会有一个漏改；而要搬的那一份数据「住在哪、叫什么」本来就是
/// 同一件事的两半。
///
/// ⚠️ **这里故意不做完整性判定**（用私有的 `fs_only_layout_in`），两条理由缺一不可：
///
/// 1. 调用方是 `services::data_root::copy_all`（`async`）与 `total_bytes`。完整性判定
///    要 `block_on` 一次 sqlx，而 `tokio` 明确禁止在运行时工作线程上 `block_on`
///    （panic），把它塞进异步命令等于给搬盘加一颗定时炸弹。
/// 2. 搬迁的语义是「磁盘上哪一份有点新的数据，就把它搬过去」——判据那一层
///    （[`data_layout`]）已经用完整性闸决定了应用**读写**谁；源侧不重复判，避免出现
///    「应用读 A、清单却搬 B」的第二套口径。
pub fn source_spec_in(root: &Path) -> (&'static str, &'static str) {
    let layout = fs_only_layout_in(root);
    let rel = match layout {
        Layout::New => ACTIVITY_DATA_REL,
        Layout::Old => LEGACY_ACTIVITY_DATA_REL,
    };
    (rel, db_file_of(layout))
}

/// 纯文件系统决议（不碰库，可在异步/热路径里调）。
///
/// 判据只看「文件在不在、谁更新」，**不判完整性**——完整性是 [`data_layout_checked_in`]
/// 的事。
///
/// **故意私有**：这是「一次判定里不安全的那一档」，公开出去就会被当成默认伸手可及的
/// 那个（名字还更短）。唯一的调用点是 [`source_spec_in`]，理由写在它的文档里。
fn fs_only_layout_in(root: &Path) -> Layout {
    match activity_source_in(root) {
        Some((layout, _)) => layout,
        None => Layout::Old,
    }
}

/// 生产口径的决议：在 `activity_source_in` 之上加一道**完整性**闸（约束 7）。
///
/// 为什么必须有这道闸：`VACUUM INTO` 写到一半被 kill ⇒ `activity.db` 是个半截文件，
/// 而它比旧库**新**⇒ 只看 mtime 会把它判成 New ⇒ 应用去开一个坏库。这里让
/// 「读不出来的新库」等于「没有新库」，fail-open 回旧布局，下次启动重试迁移。
///
/// 闸门失败**必须留一条 WARN**：这是「用户的历史看起来突然空了、应用一切正常」的
/// 分支，静默 fail-open 等于把最坏的一种故障伪装成正常启动。
///
/// ⚠️ 会 `block_on` 一次 sqlx（只读短连接）。仅限启动期同步段或同步测试；
/// **不许在异步上下文里调**（`tokio` 禁止在工作线程上 `block_on`）。
pub fn data_layout_checked_in(root: &Path) -> Layout {
    match activity_source_in(root) {
        Some((Layout::New, dir)) => {
            let db = dir.join(SQLITE_DB_FILE_NAME);
            if integrity_ok(&db) {
                return Layout::New;
            }
            let old_db = root
                .join(LEGACY_ACTIVITY_DATA_REL)
                .join(LEGACY_ACTIVITY_DB_FILE);
            if old_db.is_file() {
                crate::log_warn!(
                    "活动库 `{}` 完整性检测未通过（PRAGMA quick_check），已回退旧布局 `{}`",
                    db.display(),
                    old_db.display()
                );
            } else {
                crate::log_warn!(
                    "活动库 `{}` 完整性检测未通过（PRAGMA quick_check），旧库 `{}` 也不存在——本次将新建空库",
                    db.display(),
                    old_db.display()
                );
            }
            Layout::Old
        }
        Some((layout, _)) => layout,
        None => Layout::Old,
    }
}

/// 活动数据**源**目录 + 它属于哪套布局；两套都不存在时 `None`。
///
/// 两份都在 ⇒ 比 mtime，取较新（平局取 New）。这是约束 8 的**唯一实现**。
pub fn activity_source_in(root: &Path) -> Option<(Layout, PathBuf)> {
    let new_dir = root.join(ACTIVITY_DATA_REL);
    let old_dir = root.join(LEGACY_ACTIVITY_DATA_REL);
    let new_db = new_dir.join(SQLITE_DB_FILE_NAME);
    let old_db = old_dir.join(LEGACY_ACTIVITY_DB_FILE);
    match (new_db.is_file(), old_db.is_file()) {
        (false, false) => None,
        (true, false) => Some((Layout::New, new_dir)),
        (false, true) => Some((Layout::Old, old_dir)),
        (true, true) => {
            if mtime_of(&old_db) > mtime_of(&new_db) {
                Some((Layout::Old, old_dir))
            } else {
                Some((Layout::New, new_dir))
            }
        }
    }
}

/// webview profile 的布局：`activity/webview` 是目录就是 New。
///
/// 与数据那一半**独立**：profile 搬不动（目标被占住）不该把数据也退回去。
pub fn webview_layout_in(root: &Path) -> Layout {
    if root.join(ACTIVITY_SUBDIR).join(WEBVIEW_SUBDIR).is_dir() {
        Layout::New
    } else {
        Layout::Old
    }
}

/// 文件的 mtime；读不到时给「最旧」（这样平局与异常都落回 New，与约束 8 的「平局取 New」
/// 同向）。
fn mtime_of(path: &Path) -> SystemTime {
    std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .unwrap_or(UNIX_EPOCH)
}

/// 只读打开 + `PRAGMA quick_check`，只查**这一份文件自己**。
///
/// 与 `services::data_root::activity_copy::verify_copy` 同口径（那边查搬过去的副本，
/// 这边查「能不能拿它当新库」），但**不能复用**它：`infra` 不许依赖 `services`（L4）。
///
/// `pub(crate)` 的唯一外部调用点是 `app::activity_dir_migrate`（迁移产出副本后核对
/// **副本自身**，约束 2）。它不接受第二个路径参数，结构上就不可能去查源库。
pub(crate) fn integrity_ok(path: &Path) -> bool {
    let options = SqliteConnectOptions::new().filename(path).read_only(true);
    tauri::async_runtime::block_on(async move {
        let pool = match SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
        {
            Ok(pool) => pool,
            Err(_) => return false,
        };
        let verdict: Result<String, _> = sqlx::query_scalar("PRAGMA quick_check")
            .fetch_one(&pool)
            .await;
        pool.close().await;
        matches!(verdict, Ok(value) if value == "ok")
    })
}

/* 本文件已贴着 300 行门禁：用例住到 `activity_layout_tests.rs`（仓里既有做法，
见 `storage_usage_tests.rs` / `bound_process_watch_tests.rs`）。 */
#[cfg(test)]
#[path = "activity_layout_tests.rs"]
mod activity_layout_tests;

