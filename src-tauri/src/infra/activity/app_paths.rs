use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager, Runtime};

/// 宿主注入的落点（Timing 融合用，上游没有这个入口）。
///
/// 上游按「`app_data_dir()` 的父目录 + `Patina`」反推，即 `%APPDATA%\Patina`——
/// 那正是**用户已安装的 Patina 的真实数据目录**。融合后若照旧解析，两个应用会
/// 同时打开同一个 sqlite 文件（WAL 抢锁 → 锁超时 / 库损坏）。
///
/// 所以宿主在启动最早处注入自己的数据根，这里优先使用；注入为空时行为与上游一致
/// （`cargo test` 直接跑本 crate 时不会注入，测试语义不变）。
static ROOT_OVERRIDE: OnceLock<PathBuf> = OnceLock::new();

/// 宿主注入的 **profile** 落点（T05 起与数据落点分开注入）。
///
/// 为什么必须是两个 `OnceLock` 而不是一个：`patina/{data,webview}` → `activity/{data,webview}`
/// 的两半各自 fail-open（`VACUUM INTO` 成功 + `rename` 失败时，数据必须已经切到新目录，
/// 而 profile 还留在旧目录）。合成一个值，等于把两个布局绑在一起——那正是约束 7
/// 要防的「切到一份冻结在首次复制时刻的副本」那个洞。
static WEBVIEW_ROOT_OVERRIDE: OnceLock<PathBuf> = OnceLock::new();

/// 由宿主调用一次（重复调用只生效第一次）。
pub fn set_root_override(root: PathBuf) {
    let _ = ROOT_OVERRIDE.set(root);
}

/// 由宿主调用一次（重复调用只生效第一次）。语义同 [`set_root_override`]，作用于 profile。
pub fn set_webview_root_override(root: PathBuf) {
    let _ = WEBVIEW_ROOT_OVERRIDE.set(root);
}

pub const PRODUCT_FOLDER: &str = "Patina";
pub const PRODUCT_FOLDER_LOCAL: &str = "Patina Local";
pub const PRODUCT_FOLDER_DEV: &str = "Patina Dev";

pub const IDENTIFIER_PROD: &str = "com.ceceliaee.patina";
pub const IDENTIFIER_LOCAL: &str = "com.ceceliaee.patina.local";
pub const IDENTIFIER_DEV: &str = "com.ceceliaee.patina.dev";

/// **上游**（用户自己独立安装的 Patina）的数据目录名。永久冻结。
///
/// 与 `PRODUCT_FOLDER` 分成两个常量，不是为了整洁能合并的那种重复：`PRODUCT_FOLDER`
/// 是**我们自己**的坐标，上游目录是**别人**的坐标。两者现在**同值**，但不是一回事，
/// 也不许合并：合并之后首启导入就会去我们自己那个目录里找历史——那里什么都没有，
/// 导入静默失效。
///
/// ⚠️ `PRODUCT_FOLDER` 保持 `Patina`（T05 只翻活动库的文件名与子目录名，不翻产品目录名：
/// 那是安装/数据目录那一层的外部坐标，改了等于让老用户的目录搬家）。所以这对常量
/// **不是**「新旧名」的关系，同值会一直是常态——`app_paths_tests` 里那条
/// `assert_ne!(UPSTREAM_DB_FILE, SQLITE_DB_FILE_NAME)` 钉的是**库名**那一侧的分叉，
/// 不是这一侧。
pub const UPSTREAM_PRODUCT_FOLDER: &str = "Patina";
/// **上游**的库文件名（`%APPDATA%\Patina\patina.db`）。永久冻结，理由同上。
pub const UPSTREAM_DB_FILE: &str = "patina.db";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AppProfile {
    Production,
    Local,
    Dev,
}

impl AppProfile {
    pub fn from_identifier(identifier: &str) -> Self {
        match identifier {
            IDENTIFIER_PROD => Self::Production,
            IDENTIFIER_LOCAL => Self::Local,
            IDENTIFIER_DEV => Self::Dev,
            _ => Self::Production,
        }
    }

    pub fn product_folder(self) -> &'static str {
        match self {
            Self::Production => PRODUCT_FOLDER,
            Self::Local => PRODUCT_FOLDER_LOCAL,
            Self::Dev => PRODUCT_FOLDER_DEV,
        }
    }

    pub fn webview_product_folder(self) -> &'static str {
        #[cfg(debug_assertions)]
        {
            if self == Self::Production {
                return PRODUCT_FOLDER_DEV;
            }
        }

        self.product_folder()
    }

    pub fn key(self) -> &'static str {
        match self {
            Self::Production => "production",
            Self::Local => "local",
            Self::Dev => "dev",
        }
    }
}

pub fn app_profile<R: Runtime>(app: &AppHandle<R>) -> AppProfile {
    AppProfile::from_identifier(&app.config().identifier)
}

pub fn product_roaming_data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Some(root) = ROOT_OVERRIDE.get() {
        return Ok(root.join("data"));
    }
    #[cfg(debug_assertions)]
    {
        let isolated_root = isolated_e2e_root()?;
        ensure_persistent_profile_isolated(app_profile(app), isolated_root.is_some())?;
        if let Some(root) = isolated_root {
            return Ok(root.join("data"));
        }
    }

    Ok(roaming_root(app)?.join(app_profile(app).product_folder()))
}

pub fn product_webview_data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Some(root) = WEBVIEW_ROOT_OVERRIDE.get() {
        return Ok(root.join("webview"));
    }
    #[cfg(debug_assertions)]
    {
        let isolated_root = isolated_e2e_root()?;
        ensure_persistent_profile_isolated(app_profile(app), isolated_root.is_some())?;
        if let Some(root) = isolated_root {
            return Ok(root.join("webview"));
        }
    }

    Ok(local_root(app)?.join(app_profile(app).webview_product_folder()))
}

#[cfg(any(debug_assertions, test))]
fn persistent_profile_is_allowed(
    profile: AppProfile,
    debug_build: bool,
    has_isolated_override: bool,
) -> bool {
    !debug_build || profile != AppProfile::Production || has_isolated_override
}

#[cfg(debug_assertions)]
fn ensure_persistent_profile_isolated(
    profile: AppProfile,
    has_isolated_override: bool,
) -> Result<(), String> {
    if persistent_profile_is_allowed(profile, cfg!(debug_assertions), has_isolated_override) {
        return Ok(());
    }

    Err(
        "refusing to open production Patina data from a debug build; start development with `pnpm run tauri dev` so src-tauri/tauri.dev.conf.json is applied"
            .to_string(),
    )
}

#[cfg(debug_assertions)]
fn isolated_e2e_root() -> Result<Option<PathBuf>, String> {
    if std::env::var("PATINA_E2E").as_deref() != Ok("1") {
        return Ok(None);
    }

    let root = std::env::var_os("PATINA_E2E_DATA_ROOT")
        .map(PathBuf::from)
        .ok_or_else(|| "PATINA_E2E_DATA_ROOT is required when PATINA_E2E=1".to_string())?;
    if !root.is_absolute() {
        return Err("PATINA_E2E_DATA_ROOT must be absolute".to_string());
    }
    Ok(Some(root))
}

fn roaming_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    parent_of_identifier_dir(
        app.path()
            .app_data_dir()
            .map_err(|error| format!("failed to resolve app data dir: {error}"))?,
    )
}

fn local_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    parent_of_identifier_dir(
        app.path()
            .app_local_data_dir()
            .map_err(|error| format!("failed to resolve app local data dir: {error}"))?,
    )
}

fn parent_of_identifier_dir(path: PathBuf) -> Result<PathBuf, String> {
    path.parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            format!(
                "failed to resolve parent directory for identifier path `{}`",
                path.display()
            )
        })
}

/* 本文件已贴着 300 行门禁：用例住到 `app_paths_tests.rs`（仓里既有做法，
见 `storage_paths_tests.rs` / `activity_layout_tests.rs`）。 */
#[cfg(test)]
#[path = "app_paths_tests.rs"]
mod app_paths_tests;
