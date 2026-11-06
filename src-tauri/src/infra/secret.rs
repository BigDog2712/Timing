//! WebDAV 应用密码的加密存储（V0.11.13，设计 §2.5）。
//!
//! ## 为什么单独一层、为什么密码不跟配置走
//!
//! `MdSyncConfig` 会随 `settings` 表序列化成明文 JSON，还会被「导出整库」带走。密码一旦
//! 进去，它就会出现在备份、日志和别人的机器上。所以密文自成一条链路：
//! 桌面 → DPAPI（`CryptProtectData`，绑当前用户）→ `<数据根>\webdav.bin`；
//! Android → Keystore 派生的 AES-GCM → `SharedPreferences`。视图只回 `hasSecret: bool`。
//!
//! ## 为什么用枚举而不是 trait
//!
//! `trait` 里的 `async fn` 要 `async-trait` 才能当 trait object 用，为一个只有两个实现的
//! 存储引一个宏 crate 不值。枚举 + `cfg` 分派一行就能表达，也让「这平台上到底有没有实现」
//! 在源码里一眼可见。
//!
//! ## 失败口径
//!
//! 解不开就是解不开：**绝不回落明文、绝不猜、绝不把密码写进日志**。调用方（云端那轮）
//! 拿到 `Err` 后跳过 PUT 并记一条 error——这比"用错密码反复 401"好排查得多。
//!
//! ## 死码说明
//!
//! `get` / `put` / `clear` / `available` 的调用点在 T03（`services/md_cloud`）。接线之前
//! 只有 `install_from_data_root` 被 `app::bootstrap` 调用，其余必被判死码。

#![allow(dead_code)]

use std::path::Path;
use std::sync::OnceLock;

/* [V0.11.13] `PathBuf` 只被 `cfg(target_os = "windows")` 的代码用到（密文落点与
`dpapi_file`）。无条件 import 会让 Android 构建出一条 unused import 警告，而
`-D warnings` 一开就是错误。 */
#[cfg(target_os = "windows")]
use std::path::PathBuf;

#[cfg(target_os = "windows")]
use crate::infra::secret_dpapi;
#[cfg(mobile)]
use crate::infra::secret_bridge;

#[cfg(mobile)]
use tauri::plugin::PluginHandle;
#[cfg(mobile)]
use tauri::{AppHandle, Wry};

/// 唯一的凭据键名（设计 §6-2）。DPAPI 的 `webdav.bin`、SharedPreferences 的 `webdav`
/// 都由它派生——不许在别处另写一份字面量。
pub const KEY_WEBDAV: &str = "webdav";

/// 有实现但读不出来（密文损坏 / 换了 Windows 账户 / 桥没装）。
#[cfg(any(target_os = "windows", mobile))]
pub(crate) const MISSING: &str = "系统凭据不可用";
/// 这个平台根本没有实现（Linux / macOS）。**和上一句必须分开**：一个是故障，
/// 一个是「这条路这个平台走不通」，混成一句会让排障方向完全错掉。
#[cfg(not(any(target_os = "windows", mobile)))]
pub(crate) const MISSING: &str = "当前平台不支持凭据存储";

/// 平台实现。`path` 是 `Dpapi` 的落点（`<数据根>\webdav.bin`），由 `KEY_WEBDAV` 派生。
enum Backend {
    Unavailable,
    #[cfg(target_os = "windows")]
    Dpapi { path: PathBuf },
    #[cfg(mobile)]
    Bridge {
        app: AppHandle,
        handle: PluginHandle<Wry>,
    },
}

static STORE: OnceLock<Backend> = OnceLock::new();

/// 由 `app::bootstrap` 注入。桌面按数据根算密文落点；Android 走 `install_mobile`。
///
/// 参数名带下划线：Windows 之外的分支用不到它，删除传参又会让 `bootstrap` 长出 `cfg`。
pub fn install_from_data_root(_data_root: &Path) {
    #[cfg(target_os = "windows")]
    {
        let mut path = _data_root.to_path_buf();
        path.push(format!("{KEY_WEBDAV}.bin"));
        let _ = STORE.set(Backend::Dpapi { path });
    }
    /* 非 Windows 桌面明确记一条 Unavailable：`available()` 才有确定答案，
    不会因为「忘了装」和「装了但不支持」长得一样。 */
    #[cfg(all(not(target_os = "windows"), not(mobile)))]
    let _ = STORE.set(Backend::Unavailable);
}

/// Android：插件 `setup` 里装（那里才拿得到 `PluginHandle`）。
#[cfg(mobile)]
pub fn install_mobile(app: AppHandle, handle: PluginHandle<Wry>) {
    let _ = STORE.set(Backend::Bridge { app, handle });
}

/// 这个平台现在能不能真的存密码。只在「装过且是支持的后端」时返回 true。
pub fn available() -> bool {
    match STORE.get() {
        #[cfg(target_os = "windows")]
        Some(Backend::Dpapi { .. }) => true,
        #[cfg(mobile)]
        Some(Backend::Bridge { .. }) => true,
        _ => false,
    }
}

/// 读一个键。`Ok(None)` = 从来没存过（正常）；`Err` = 存过但读不出来（要提示用户重填）。
pub async fn get(key: &str) -> Result<Option<String>, String> {
    match STORE.get() {
        #[cfg(target_os = "windows")]
        Some(Backend::Dpapi { path }) => secret_dpapi::get(&dpapi_file(path, key)),
        #[cfg(mobile)]
        Some(Backend::Bridge { handle, .. }) => secret_bridge::get(handle, key).await,
        _ => Err(MISSING.to_string()),
    }
}

/// 覆盖写一个键。写成功返回前密文已经落盘（tmp + rename）。
pub async fn put(key: &str, value: &str) -> Result<(), String> {
    match STORE.get() {
        #[cfg(target_os = "windows")]
        Some(Backend::Dpapi { path }) => secret_dpapi::put(&dpapi_file(path, key), value),
        #[cfg(mobile)]
        Some(Backend::Bridge { handle, .. }) => secret_bridge::put(handle, key, value).await,
        _ => Err(MISSING.to_string()),
    }
}

/// 删一个键。删不存在的键算成功（幂等：用户连按两次「清除」不该弹错）。
pub async fn clear(key: &str) -> Result<(), String> {
    match STORE.get() {
        #[cfg(target_os = "windows")]
        Some(Backend::Dpapi { path }) => secret_dpapi::clear(&dpapi_file(path, key)),
        #[cfg(mobile)]
        Some(Backend::Bridge { handle, .. }) => secret_bridge::clear(handle, key).await,
        _ => Err(MISSING.to_string()),
    }
}

/// 键名决定文件名，目录不变：`webdav` → `<数据根>\webdav.bin`。
/// 这样将来多一个键（比如代理密码）不用改落点布局。
#[cfg(target_os = "windows")]
fn dpapi_file(path: &Path, key: &str) -> PathBuf {
    path.with_file_name(format!("{key}.bin"))
}
