//! 数据根 / 插件根解析（V0.11.6，ADR-050）：**一个进程只做一次落点决策**。
//!
//! ## 为什么在这里，而不是 `infra` / `AppState`
//!
//! 解析必须发生在 `AppState::manage` **之前**——日志根、md 备份根、`db::init_pool`
//! 全部以数据根为入参（`app/bootstrap.rs` 的顺序注释写明了这条依赖）。放进
//! `AppState` 就是「建库之后才能知道库在哪」。放在叶子层还有一个硬理由：`infra` 与
//! `commands` 都要读它，放 `infra` 会让 `platform` 之外多一个环。
//!
//! ## 为什么用 `OnceLock` 而不是每次现算
//!
//! 落点是一次**有副作用**的决策（探测可写性 + 搬运老数据 + 用户在对话框里选过）。
//! 现算会让用户的选择在后续调用里被推翻：`current_exe()` 永远能算出一个路径，但它
//! 无法表达「这个进程已经决定回退到 AppData 了」。
//!
//! ## 未注入时的兜底
//!
//! `data_root()` / `plugins_root()` 返回 `PathBuf` 而不是 `Result`：单测与移动端早期
//! 会先读一次，若改成 `Result`，`plugin_cmd` / `md_env` 三处就要各自编一条错误消息，
//! 口径必然漂开。未注入时一律走 `fallback_appdata()`（纯函数，无 IO）。
//!
//! 分层：本模块是**叶子**，只依赖 `std` 与 `dirs`（桌面）。**不得** `use crate::infra`。

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// 一次落点决策的完整结果。
#[derive(Debug, Clone)]
pub struct Roots {
    /// 数据根（库 / 日志 / 备份 / md 出厂落点）
    pub data: PathBuf,
    /// 插件根（用户往这儿放插件）
    pub plugins: PathBuf,
    /// 是否落在应用旁边（`<exe>\data`）。`false` = 回退到 `%APPDATA%`
    pub portable: bool,
}

/// 进程内唯一、写入后不可变。
static ROOTS: OnceLock<Roots> = OnceLock::new();

/// md 落点的数据根占位符（**唯一口径**：`infra::md_env` 直接引用本常量）。
pub const TOKEN: &str = "%APP_DIR%";

/// 兜底 identifier。**只**在 `ROOTS` 未注入时使用（单测 / 移动端早期）；
/// 生产路径由 `lib.rs` 用 `ctx.config().identifier` 注入。
pub const FALLBACK_IDENTIFIER: &str = "com.timing.app";

impl Roots {
    /// 移动端沙箱：数据根 = 系统给的应用目录，插件根 = 其下的 `plugins`。
    ///
    /// 移动端没有「exe 同级」这个概念，沙箱目录由系统给定，因此 `portable` 恒为
    /// `false`——它不是「回退」，是平台本来就这样。
    ///
    /// 只在移动端编译：桌面侧的 `Roots` 由 `app::portable_boot` 直接构造，
    /// 留一个桌面构建永远走不到的分支等于给自己留死码（`-D warnings` 会直接抓）。
    #[cfg(mobile)]
    pub fn sandbox(app_data_dir: PathBuf) -> Self {
        let plugins = app_data_dir.join("plugins");
        Self {
            data: app_data_dir,
            plugins,
            portable: false,
        }
    }
}

/// 注入落点决策。返回是否写入成功（`false` = 本进程已经注入过）。
///
/// 已被占用时**不 panic**：重复注入只会来自「两处都试图决策」的编码失误，
/// 让后到的那次静默失败 + 一条 WARN，比启动即崩更容易定位（`platform/log.rs`
/// 的 `log_warn!` 在 `log::init` 之前自带降级，不会丢信息）。
pub fn set(roots: Roots) -> bool {
    if ROOTS.set(roots).is_ok() {
        return true;
    }
    crate::log_warn!("app_dir: roots 已注入，忽略本次写入（一个进程只做一次落点决策）");
    false
}

/// 显式询问「解析过没有」（`None` = 还没决策）。
pub fn get() -> Option<&'static Roots> {
    ROOTS.get()
}

/// 数据根：已决策返回决策结果，否则走兜底。
pub fn data_root() -> PathBuf {
    match get() {
        Some(roots) => roots.data.clone(),
        None => fallback_appdata(),
    }
}

/// 插件根：口径同 `data_root()`。
pub fn plugins_root() -> PathBuf {
    match get() {
        Some(roots) => roots.plugins.clone(),
        None => fallback_appdata().join("plugins"),
    }
}

/// 插件根**的父目录**——`infra::plugin_fs::user_plugin_dir(root)` 自己会 `join("plugins")`。
///
/// 存在的理由：`plugins_root()` 返回的是插件目录本身（`<exe>\plugins`），直接喂给
/// `user_plugin_dir` 会得到 `<exe>\plugins\plugins`。两个口径必须分开命名，否则
/// 「插件放哪」这件事会以「多一层 plugins」的形式悄悄坏掉。
///
/// **不变式（latent 耦合，改前先看）**：本函数无条件丢掉路径末段，所以
/// `plugins_root()` 的末段**必须是字面量 `plugins`**。改成 `<exe>\extensions` 之类的
/// 名字，这里会静默指到 `<exe>` 的父目录、扫错地方——不会报错，只会「插件都不见了」。
/// 今天三处构造（`platform::app_dir` 的 exe / appdata / mobile sandbox）末段都是
/// `plugins`，所以恒成立；这也是 `plugin_fs::scan_roots` 去重能依赖的前提。
pub fn plugin_base() -> PathBuf {
    let root = plugins_root();
    root.parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| root.clone())
}

/// 是否便携模式（`false` = 回退到 AppData，或还没决策）。
pub fn is_portable() -> bool {
    get().is_some_and(|roots| roots.portable)
}

/// exe 所在目录（`<exe>`）。拿不到时返回 `None`，由调用方决定兜底。
pub fn exe_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.parent().map(Path::to_path_buf)
}

/// `%APPDATA%\<identifier>`（Windows = Roaming）。与 Tauri 同源（`dirs 7`）。
#[cfg(desktop)]
pub fn appdata_dir(identifier: &str) -> Option<PathBuf> {
    dirs::data_dir().map(|base| base.join(identifier))
}

/// 兜底数据根：`%APPDATA%\com.timing.app`。纯函数、无 IO。
pub fn fallback_appdata() -> PathBuf {
    /* 拿不到 Roaming（域账户 + 重定向漫游目录的极端情况）时**不能退成 `.`**：
    `%APP_DIR%\md` 会因此变成 `.\md`，在进程当前目录里长出一棵树——正是
    `infra/md_env.rs` 顶部明说要避免的事，而且用户永远找不到那堆文件。
    退到临时目录：至少是绝对路径、至少可写，且诊断快照里能看到真实位置。 */
    #[cfg(desktop)]
    {
        appdata_dir(FALLBACK_IDENTIFIER)
            .unwrap_or_else(|| std::env::temp_dir().join(FALLBACK_IDENTIFIER))
    }
    /* 移动端正常永远走不到这里：`bootstrap::setup` 第一件事就是注入沙箱根。
    给一个可写路径好过 panic —— 万一顺序被改坏，宁可数据落到临时目录并被诊断
    快照记下来，也不要整个应用起不来。 */
    #[cfg(mobile)]
    {
        std::env::temp_dir().join(FALLBACK_IDENTIFIER)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /* 只测**纯函数**：`set()` 会污染 OnceLock，同进程并行用例会互相看见
    （设计 §6「禁止」明确要求任何测试都不得调 `app_dir::set()`）。 */

    #[test]
    fn fallback_is_appdata_identifier() {
        let dir = fallback_appdata();
        assert!(
            dir.ends_with(FALLBACK_IDENTIFIER),
            "兜底必须落在 identifier 目录：{}",
            dir.display()
        );
    }

    #[test]
    fn token_is_stable() {
        assert_eq!(TOKEN, "%APP_DIR%");
    }

    #[test]
    fn plugin_base_drops_last_segment() {
        /* `plugin_base().join("plugins")` 必须等于 `plugins_root()`：
        这是「插件到底放哪」的唯一断言，改口径时它会先红。 */
        assert_eq!(plugin_base().join("plugins"), plugins_root());
    }
}
