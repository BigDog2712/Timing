//! [T05] 活动数据目录去 Patina 化：`<数据根>/patina/{data,webview}` →
//! `<数据根>/activity/{data,webview}`，库名 `patina.db` → `activity.db`。
//!
//! ## 两个子步，处置**故意不同**
//!
//! | | `data/`（历史 + `backups/` + `diagnostics/` + 导入标记） | `webview/`（WebView2 profile，176 MB） |
//! |---|---|---|
//! | 做法 | **复制**（库 `VACUUM INTO`，其余 `fs::copy`） | **`fs::rename` 搬一次** |
//! | 为什么 | 旧路径消失 ⇒ 回滚到旧版本看到空历史；复制满足约束 4「旧库不删」 | 复制 176 MB 不可接受（升级卡住、`LOCK` 在场时无意义），而 localStorage 就落在 profile 里，重建 profile = mini 窗/通知窗偏好**确定丢失** |
//!
//! ## 没有标记、没有删除、没有 `*.db` 的 `fs::copy`
//!
//! 幂等判据全是**文件系统事实**：`activity/data/activity.db` 存在且 `quick_check` 通过
//! ⇒ 数据那步已完成；`activity/webview` 是目录 ⇒ profile 那步已完成。两子步各管自己的
//! 开关，任一步失败只影响自己（理由见 `infra::activity::activity_layout` 模块头）。
//! 本模块**没有**删除旧路径的代码；唯一的 `remove_file` 在 [`discard_partial_copy`] 里，
//! 删的是我们自己被 kill 时留下的半截副本。
//!
//! ## 顺序
//!
//! 由 `lib.rs` 保证：排在 `portable_boot::prepare`（数据根已注入）之后、
//! `Builder::default()` 之前。晚一步的后果是 `mini_window` / `tool_notifications` 的
//! `.data_directory()` 先在新路径建出一份空 profile ⇒ rename 要么失败、要么把老 profile
//! 挤掉。**迁移全过程一个 `data_layout()` / `webview_layout()` 都不许读**（`OnceLock`
//! 一旦填了 Old 就永远是 Old），末尾由 [`check_layout_cache`] 强制读一次。

use std::path::Path;

use crate::infra::activity::activity_layout::{self, Layout};
use crate::infra::activity::storage_paths::{
    self, ACTIVITY_DATA_REL, ACTIVITY_SUBDIR, LEGACY_ACTIVITY_DATA_REL, LEGACY_ACTIVITY_DB_FILE,
    SQLITE_DB_FILE_NAME, WEBVIEW_SUBDIR,
};

/// 一个子步的结局（只用于日志与取证，不参与判据）。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Step {
    /// 不需要做：没有旧数据，或目标已齐全。
    Nothing,
    /// 这一趟做成了。
    Done,
    /// 失败了。**调用方只记日志、继续启动**（fail-open）。
    Failed,
}

/// 子步结局 + 「这一趟真的产出了一份新副本」。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Outcome {
    step: Step,
    fresh_copy: bool,
}

impl Outcome {
    fn nothing() -> Self {
        Self { step: Step::Nothing, fresh_copy: false }
    }

    fn done(fresh_copy: bool) -> Self {
        Self { step: Step::Done, fresh_copy }
    }

    fn failed() -> Self {
        Self { step: Step::Failed, fresh_copy: false }
    }
}

/// 迁移报告（两半各一行，日志与真机取证都按它核）。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Report {
    pub data: Step,
    pub webview: Step,
}

/// 启动期入口。**不返回 `Err`**：任何失败都只落日志并回退旧布局，绝不阻断启动。
pub fn prepare(data_root: &Path) -> Report {
    let data = match step_data(data_root) {
        Ok(outcome) => outcome,
        Err(err) => {
            crate::log_warn!("activity: 数据目录迁移失败，本次用旧布局继续启动：{err}");
            Outcome::failed()
        }
    };
    /* 顺序是硬要求（约束 3）：webview 的 rename 必须排在数据复制 + 核对**之后**。
    先让新位置可读，再动旧位置——反过来一旦 rename 成功而复制失败，用户既没有新库、又
    丢了旧 profile。 */
    let webview = match step_webview(data_root) {
        Ok(outcome) => outcome,
        Err(err) => {
            crate::log_warn!("activity: profile 目录迁移失败，本次用旧 profile 继续启动：{err}");
            Outcome::failed()
        }
    };
    let report = Report {
        data: data.step,
        webview: webview.step,
    };
    /* 两个开关各打一条：只打成功那条 = 失败那一半在真机上不可见。 */
    crate::log_info!(
        "activity: 迁移完成 data={:?} webview={:?}（root={}）",
        report.data,
        report.webview,
        data_root.display()
    );
    check_layout_cache(data_root, data.fresh_copy);
    report
}

/// 数据那一步：库走 `VACUUM INTO`，其余（`backups/` `diagnostics/` 导入标记……）原样复制。
fn step_data(root: &Path) -> Result<Outcome, String> {
    let new_dir = root.join(ACTIVITY_DATA_REL);
    let new_db = new_dir.join(SQLITE_DB_FILE_NAME);
    let old_dir = root.join(LEGACY_ACTIVITY_DATA_REL);
    let old_db = old_dir.join(LEGACY_ACTIVITY_DB_FILE);

    if new_db.is_file() && !activity_layout::integrity_ok(&new_db) {
        /* 上次进程在 `VACUUM INTO` 中途被 kill 留下的半截副本。它**是我们自己造的**，
        不是用户数据（旧库全程完好），删掉重试是安全的。 */
        discard_partial_copy(&new_db);
    }
    let mut fresh_copy = false;
    if !new_db.is_file() {
        if !old_db.is_file() {
            return Ok(Outcome::nothing());
        }
        std::fs::create_dir_all(&new_dir)
            .map_err(|err| format!("建 {} 失败：{err}", new_dir.display()))?;
        vacuum_into(&old_db, &new_db)?;
        if !activity_layout::integrity_ok(&new_db) {
            discard_partial_copy(&new_db);
            return Err(format!(
                "{} 的副本核对没通过（quick_check），已丢弃，下次启动重试",
                new_db.display()
            ));
        }
        fresh_copy = true;
    }
    /* **只搬库 = 备份面板变空**：文件还在盘上、列表里没有、零报错。所以 `data/` 下
    除库与伴生文件之外的一切都要跟过去。返回值是非库文件的复制条数（幂等的判据）。 */
    let topped_up = copy_missing(&old_dir, &new_dir)?;
    if fresh_copy || topped_up > 0 {
        Ok(Outcome::done(fresh_copy))
    } else {
        Ok(Outcome::nothing())
    }
}

/// profile 那一步：`fs::rename` 一次，不复制。
fn step_webview(root: &Path) -> Result<Outcome, String> {
    let new_dir = root.join(ACTIVITY_SUBDIR).join(WEBVIEW_SUBDIR);
    let old_dir = root
        .join(activity_layout::activity_subdir_of(Layout::Old))
        .join(WEBVIEW_SUBDIR);
    if new_dir.is_dir() || !old_dir.is_dir() {
        return Ok(Outcome::nothing());
    }
    if let Some(parent) = new_dir.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("建 {} 失败：{err}", parent.display()))?;
    }
    std::fs::rename(&old_dir, &new_dir).map_err(|err| {
        /* 目标被占住（不是我们造成的）：保留两份、**不 merge、不删、不 exit**，
        fail-open 回旧 profile 继续启动，下次启动重试（约束 7，与数据那半同一条规则）。 */
        format!(
            "把 {} 搬到 {} 失败（两份都保留）：{err}",
            old_dir.display(),
            new_dir.display()
        )
    })?;
    Ok(Outcome::done(false))
}

/// 迁移末尾**强制读一次**两个开关，并把结论与磁盘事实对齐。
///
/// 两个作用：① 证明「迁移早于一切读取」这个顺序成立（若真有代码先读了，`OnceLock` 会
/// 把旧结论钉死，这里立刻能看出来）；② 把缓存填成迁移后的真相。
/// 失败**只打 WARN、不 panic**（发布配置是 `panic = "abort"`，panic 等于让应用起不来）。
fn check_layout_cache(root: &Path, fresh_copy: bool) {
    /* 只对**真实**数据根碰全局缓存：用例传的是临时目录，把 `OnceLock` 填成临时目录的
    结论会污染同一进程里的其它用例（`cargo test` 全在一个进程里跑）。 */
    if root != crate::infra::activity::storage_paths::timing_data_root() {
        crate::log_debug!("activity: 迁移跑在非产品数据根上，跳过布局缓存的全局校验");
        return;
    }
    let fresh_data = activity_layout::data_layout_checked_in(root);
    if fresh_copy && fresh_data != Layout::New {
        crate::log_warn!(
            "activity: 刚产出的副本没赢得判据（磁盘结论 {:?}）——旧库 mtime 更新？本次仍按旧布局跑",
            fresh_data
        );
    }
    let cached_data = activity_layout::data_layout();
    if cached_data != fresh_data {
        crate::log_warn!(
            "activity: 布局缓存与磁盘不一致（缓存 {:?} / 磁盘 {:?}）——有代码在迁移之前读过布局，历史可能指向旧路径",
            cached_data,
            fresh_data
        );
    }
    let cached_webview = activity_layout::webview_layout();
    let fresh_webview = activity_layout::webview_layout_in(root);
    if cached_webview != fresh_webview {
        crate::log_warn!(
            "activity: profile 布局缓存与磁盘不一致（缓存 {:?} / 磁盘 {:?}）",
            cached_webview,
            fresh_webview
        );
    }
}

/// 半截副本的**唯一**删除点。
///
/// 名字里必须留 `partial`：`check:de-patina` 判据 3 允许 `remove_file` 存在于名字含
/// `partial` 的函数体内，其余任何删除都算「动了旧路径」。
fn discard_partial_copy(path: &Path) {
    if let Err(err) = std::fs::remove_file(path) {
        crate::log_warn!("activity: 丢弃半截副本 {} 失败：{err}", path.display());
    }
}

/// `VACUUM INTO` 出一份不含 `-wal`/`-shm` 的单文件副本。
///
/// 不用 `fs::copy`：库在 WAL 模式下主文件与 `-wal` 是两个时刻的快照，直拷会拿到撕裂的
/// 页。这里**没有** `legacy_import::copy_database` 那样的「VACUUM 失败就退化成文件复制」
/// 退路——搬活动库时退化成撕裂副本，比本次不搬更坏（判据 2 就是这么规定的）。
fn vacuum_into(source: &Path, target: &Path) -> Result<(), String> {    let escaped_target = target.display().to_string().replace('\'', "''");
    let target_label = target.display().to_string();
    let source_owned = source.to_path_buf();
    tauri::async_runtime::block_on(async move {
        use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

        let options = SqliteConnectOptions::new()
            .filename(&source_owned)
            .read_only(true)
            /* sqlx 0.8 默认就是 `false`，显式写出来是说给下一个人听：**不许**因为源文件
            刚在 TOCTOU 窗口里消失，就静默拿一份空库去 `VACUUM INTO`。 */
            .create_if_missing(false);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .map_err(|err| format!("打开旧库 {} 失败：{err}", source_owned.display()))?;
        let outcome = sqlx::query(&format!("VACUUM INTO '{escaped_target}'"))
            .execute(&pool)
            .await
            .map(|_| ())
            .map_err(|err| format!("VACUUM INTO {target_label} 失败：{err}"));
        pool.close().await;
        outcome
    })
}

/// 把 `from` 目录下**目标没有的**东西照原样补进 `to`；已存在的文件一律不覆盖。
///
/// 返回实际复制的**文件**条数：0 就是「这趟什么都没做」，`step_data` 靠它把第二趟判成
/// [`Step::Nothing`]。不覆盖是幂等的关键：第二趟若按「复制」语义重写一遍，会把用户这一
/// 趟新增的备份用旧的盖掉。
fn copy_missing(from: &Path, to: &Path) -> Result<u64, String> {
    let entries =
        std::fs::read_dir(from).map_err(|err| format!("读 {} 失败：{err}", from.display()))?;
    std::fs::create_dir_all(to).map_err(|err| format!("建 {} 失败：{err}", to.display()))?;
    let mut copied = 0_u64;
    for entry in entries {
        let entry = entry.map_err(|err| format!("读 {} 失败：{err}", from.display()))?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if storage_paths::is_database_file_name(&name) {
            continue;
        }
        let target = to.join(name.as_ref());
        if target.exists() {
            continue;
        }
        let source = entry.path();
        let is_dir = entry
            .file_type()
            .map_err(|err| format!("读 {} 类型失败：{err}", source.display()))?
            .is_dir();
        if is_dir {
            copied += copy_missing(&source, &target)?;
            continue;
        }
        std::fs::copy(&source, &target).map_err(|err| {
            format!(
                "复制 {} 到 {} 失败：{err}",
                source.display(),
                target.display()
            )
        })?;
        copied += 1;
    }
    Ok(copied)
}

#[cfg(test)]
#[path = "activity_dir_migrate_tests.rs"]
mod activity_dir_migrate_tests;
