use crate::infra::activity::{activity_layout, app_paths, storage_control};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};

/// 活动库的**唯一真源**。
///
/// ⚠️ 这是**已落盘坐标**：它同时是用户磁盘上的文件名、`_sqlx_migrations` 之外一切
/// 搬迁/备份/核对的基准。[T05] 已由 `patina.db` 改为 `activity.db`；旧库
/// （`LEGACY_ACTIVITY_DB_FILE`）由迁移复制过来，**不删**。
pub const SQLITE_DB_FILE_NAME: &str = "activity.db";

/// 活动数据在数据根下的子目录名（`<数据根>/activity`）。
pub const ACTIVITY_SUBDIR: &str = "activity";

/// 活动数据相对数据根的子目录（`<数据根>/activity/data`）。
pub const ACTIVITY_DATA_REL: &str = "activity/data";

/// 活动数据在数据根下的子目录名（`data` 那一层，`<数据根>/activity/data`）。
pub const DATA_SUBDIR: &str = "data";

/// 活动 **webview profile** 在活动子目录下的名字（`<数据根>/activity/webview`）。
pub const WEBVIEW_SUBDIR: &str = "webview";

/// **T05 之前**活动数据相对数据根的目录（`<数据根>/patina/data`）。
///
/// 只许出现在「读旧布局」的地方：迁移的源侧、旧根探测。**不许**用它新建任何东西——
/// 这条与 `UPSTREAM_PRODUCT_FOLDER` 同性质（别人的/过去的坐标，永久冻结），
/// 区别只是那个是上游安装目录，这个是**我们自己**的旧目录。
pub const LEGACY_ACTIVITY_DATA_REL: &str = "patina/data";

/// **T05 之前**的活动库文件名（`<数据根>/patina/data/patina.db`）。
///
/// 与 `LEGACY_ACTIVITY_DATA_REL` 成对：迁移时源库叫这个名字，目标库恒用
/// `SQLITE_DB_FILE_NAME`。两者**不能合成一个常量**——合成之后「源 ≠ 目标」这件事
/// 就从代码里消失了，而它正是这次迁移的全部内容。
pub const LEGACY_ACTIVITY_DB_FILE: &str = "patina.db";

/// 活动库的伴生文件：`-wal` / `-shm` / `-journal`。
///
/// **必须带库名进来。** 曾经有一个无参版本（恒按 `SQLITE_DB_FILE_NAME` 派生），已删除：
/// Old 布局下它会给出 `activity.db-wal` 而磁盘上是 `patina.db-wal`，名字更短、答案更错，
/// 正是「IDE 补全时最先递到手上」的那一类陷阱。
pub fn sqlite_sidecar_names_of(file_name: &str) -> [String; 3] {
    ["-wal", "-shm", "-journal"].map(|suffix| format!("{file_name}{suffix}"))
}

/// 这个名字是不是「活动库本身或它的伴生文件」。
///
/// 这一类的**唯一**合法产出方式是 `VACUUM INTO`（T05 迁移、数据根搬迁、首启导入三处
/// 都一样）。任何一个 `fs::copy` 落到它们身上都会得到撕裂的一页或漏掉 `-wal` 里尚未
/// checkpoint 的数据，所以「判定」只写在这里，调用方不许自己拼名字。
///
/// 两个库名都算：旧布局下 `patina.db` 是**真库**（读它是对的），新布局下它是**旧库**
/// （复制它必须走 `VACUUM INTO`，不能直拷）。
pub fn is_database_file_name(name: &str) -> bool {
    if name == SQLITE_DB_FILE_NAME || name == LEGACY_ACTIVITY_DB_FILE {
        return true;
    }
    [SQLITE_DB_FILE_NAME, LEGACY_ACTIVITY_DB_FILE]
        .iter()
        .flat_map(|db| sqlite_sidecar_names_of(db))
        .any(|sidecar| sidecar == name)
}

const BACKUP_DIR_NAME: &str = "backups";
const REMOTE_BACKUP_TEMP_DIR_NAME: &str = "remote-backup-temp";

/// Timing 真正的数据根（`%APPDATA%\com.timing.app`）。
///
/// `StoragePaths` 描述的是它下面 `activity/data` 那一层（活动库 + 备份 + 远端临时件）。
/// 设置页「数据目录」那一行要给用户看的是**数据根**，不是这一层——用户问的是
/// 「我的数据都在哪」，答案里有 `timing.db`、`md/`、`logs/`、`plugins/`、`activity/`。
///
/// 顺带核实（V0.13.x，**只做判定，不做清理**）：老布局里 `<数据根>/patina/patina.db`
/// 与 `<数据根>/patina/data/patina.db` 在真机上同时存在，前者是 **0 字节的遗留空文件**
/// （早期融合布局把 `data_root` 当成 `patina/` 时留下的），活库在后者。T05 迁移后
/// 这两份都留在 `patina/` 下当只读快照，由用户自己删。
pub fn timing_data_root() -> PathBuf {
    crate::platform::app_dir::data_root()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoragePaths {
    pub data_root: PathBuf,
    pub db_path: PathBuf,
    pub backup_dir: PathBuf,
    pub remote_backup_temp_dir: PathBuf,
    pub webview_root: PathBuf,
    pub is_custom_data_root: bool,
    pub is_custom_webview_root: bool,
}

impl StoragePaths {
    /// 由「两个根 + 库名」拼出全套落点。**库名是入参**，不在这里推布局。
    ///
    /// 为什么不推：本构造器同时服务三种根——E2E 根、自定义数据根、产品数据根。前两种
    /// 与产品根的布局互不相干（E2E 恒为本次新建的根，自定义根里可能还是 `patina.db`），
    /// 在这里读一次 `data_layout()` 等于用产品根的答案回答另外两个。
    ///
    /// `db_file_name` 的来源只能是 [`activity_layout::db_file_of`] 或
    /// [`activity_layout::db_file_in`]——两者都是「已经判过的结论」，本函数只负责拼。
    pub(crate) fn from_roots(
        data_root: PathBuf,
        webview_root: PathBuf,
        is_custom_data_root: bool,
        is_custom_webview_root: bool,
        db_file_name: &'static str,
    ) -> Self {
        Self {
            db_path: data_root.join(db_file_name),
            backup_dir: data_root.join(BACKUP_DIR_NAME),
            remote_backup_temp_dir: data_root.join(REMOTE_BACKUP_TEMP_DIR_NAME),
            data_root,
            webview_root,
            is_custom_data_root,
            is_custom_webview_root,
        }
    }
}

pub fn default_storage_paths<R: Runtime>(app: &AppHandle<R>) -> Result<StoragePaths, String> {
    #[cfg(debug_assertions)]
    if std::env::var("PATINA_E2E").as_deref() == Ok("1") {
        let root = std::env::var_os("PATINA_E2E_DATA_ROOT")
            .map(PathBuf::from)
            .ok_or_else(|| "PATINA_E2E_DATA_ROOT is required when PATINA_E2E=1".to_string())?;
        if !root.is_absolute() {
            return Err("PATINA_E2E_DATA_ROOT must be absolute".to_string());
        }
        return Ok(StoragePaths::from_roots(
            root.join(DATA_SUBDIR),
            root.join(WEBVIEW_SUBDIR),
            false,
            false,
            /* E2E 根是本趟新建的临时目录，里面不可能有旧库 ⇒ 恒新布局。 */
            SQLITE_DB_FILE_NAME,
        ));
    }

    Ok(StoragePaths::from_roots(
        app_paths::product_roaming_data_dir(app)?,
        app_paths::product_webview_data_dir(app)?,
        false,
        false,
        /* 产品根这两条路径的目录名已经由 `activity_bridge` 按布局定过，库名必须跟着
        同一个布局走：Old 下目录是 `patina/data`，库是 `patina.db`。接错一个，应用就在
        用户的历史旁边开一个空库，界面正常、日志干净。 */
        activity_layout::db_file_of(activity_layout::data_layout()),
    ))
}

pub fn resolve_storage_paths<R: Runtime>(app: &AppHandle<R>) -> Result<StoragePaths, String> {
    resolve_roots(default_storage_paths(app)?, storage_control::read(app)?)
}

fn resolve_roots(
    defaults: StoragePaths,
    state: storage_control::StorageControl,
) -> Result<StoragePaths, String> {
    let custom_data = state.data_root.is_some();
    let custom_cache = state.webview_root.is_some();
    let data_root = state.data_root.unwrap_or(defaults.data_root);
    /* 自定义数据根的库名只能看**磁盘事实**：迁移例程只跑产品数据根，用户自己挑的那个
    目录里可能还躺着 T05 之前的 `patina.db`。按进程级 `data_layout()` 取名会让应用在
    自己的自定义根里开一个空的新库——用户视角是「换了目录之后历史全空了」。 */
    let db_file_name = if custom_data {
        activity_layout::db_file_in(&data_root)
    } else {
        activity_layout::db_file_of(activity_layout::data_layout())
    };
    let paths = StoragePaths::from_roots(
        data_root,
        state.webview_root.unwrap_or(defaults.webview_root),
        custom_data,
        custom_cache,
        db_file_name,
    );
    if custom_data {
        let metadata = std::fs::metadata(&paths.db_path).map_err(|e| {
            format!(
                "custom database `{}` is unavailable: {e}",
                paths.db_path.display()
            )
        })?;
        if !metadata.is_file() {
            return Err(format!(
                "custom database `{}` is not a file",
                paths.db_path.display()
            ));
        }
    }
    if custom_cache {
        std::fs::read_dir(&paths.webview_root).map_err(|e| {
            format!(
                "custom cache directory `{}` is unavailable: {e}",
                paths.webview_root.display()
            )
        })?;
    }
    Ok(paths)
}

pub fn derive_custom_webview_root(data_root: &Path) -> PathBuf {
    data_root.to_path_buf()
}

pub fn derive_custom_data_root(selected_root: &Path, product_folder: &str) -> PathBuf {
    if selected_root
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| product_folder_name_eq(name, product_folder))
    {
        return selected_root.to_path_buf();
    }

    selected_root.join(product_folder)
}

/// 这个目录里是不是已经装着一份活动库（**两种库名都算**）。
///
/// 唯一调用点是自定义数据根那道闸「目标目录不能已经有一份库」
/// （`services::activity::data::storage_migration`）。只查新库名会让这道闸在 T05 之前的
/// 目录上恒假——那种目录里是 `patina.db`，于是搬迁会直接盖掉用户在那里的历史。
pub fn holds_activity_db(data_root: &Path) -> bool {
    [SQLITE_DB_FILE_NAME, LEGACY_ACTIVITY_DB_FILE]
        .iter()
        .any(|name| data_root.join(name).exists())
}

pub fn backup_dir_for_data_root(data_root: &Path) -> PathBuf {
    data_root.join(BACKUP_DIR_NAME)
}

fn product_folder_name_eq(left: &str, right: &str) -> bool {
    #[cfg(windows)]
    {
        left.eq_ignore_ascii_case(right)
    }

    #[cfg(not(windows))]
    {
        left == right
    }
}

/* 本文件已贴着 300 行门禁：用例住到 `storage_paths_tests.rs`（仓里既有做法，
见 `activity_layout_tests.rs` / `storage_usage_tests.rs`）。 */
#[cfg(test)]
#[path = "storage_paths_tests.rs"]
mod storage_paths_tests;
