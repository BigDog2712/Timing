//! 便携落点决策（V0.11.6，ADR-050 §3）：探测可写性 → 必要时搬老数据 → 注入 `app_dir`。
//!
//! ## 为什么在 `Builder::run()` 之前
//!
//! 数据根是「日志目录 / md 备份目录 / `db::init_pool`」的入参（`app/bootstrap.rs`
//! 的顺序注释），而 `setup` 钩子是在窗口建出来**之后**才调的。更硬的理由：这里要弹
//! **阻塞式**原生对话框，事件循环一旦跑起来就不能同步阻塞主线程。
//!
//! ## 三个文件的边界
//!
//! - 本文件：**顺序与判据**（先探测还是先迁移、用户点了哪一项、注入哪个根）；
//! - `app/portable_prompt.rs`：**文案与按钮**（`rfd::MessageDialog`，纯 UI）；
//! - `infra/portable_probe.rs`：**碰磁盘**（可写性探测、回退标记读写）。
//!
//! 为什么用 `rfd` 而不是 `tauri-plugin-dialog`：该插件的 `blocking_show` 源码注释
//! 明写「should NOT be used when running on the main thread context」——而这一步
//! 就在主线程（`app/preboot.rs` 顶部同一段理由）。
//!
//! ## 为什么探测「每次启动」
//!
//! 权限可能被回收、整个文件夹可能被搬到别处。探测 = 建目录 + 写 16 字节 + 回读 + 删，
//! 微秒级。「探测一次存起来」会让用户改完权限后仍走 AppData，那是最难排查的一类
//! 「我明明给了权限」。唯一例外：`portable-optout.json` 存在时整段跳过。
//!
//! 本层跑在 `platform::log::init` **之前**：结果缓存在模块自己的 `Mutex` 里，由
//! `bootstrap` 在日志就绪后补记（`appdata_migrate` 的既有手法）。
//! 第 ① 步（自定义数据根）在 `app::data_root_boot`：要弹三选框，正文放这会破 300 行。

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::app::portable_prompt::{self as prompt, Choice};
use crate::infra::portable_migrate::{self as mig, Outcome};
use crate::infra::portable_probe as fs_probe;

/* 转出去给 `portable_prompt` 的文案用（提示用户「删掉这个文件即可恢复探测」）：
名字只在 `infra::portable_probe` 定义一次，这里 re-export 保证两处永远同步。 */
pub use crate::infra::portable_probe::OPTOUT_FILE;
use crate::platform::app_dir::{self, Roots};

/// 退出码：`<exe>\data` 与 `%APPDATA%` 都不可写（没有日志、没有库 = 无法诊断）。
pub const EXIT_NO_DATA_DIR: i32 = 3;
/// 退出码：便携版缺 WebView2 运行时（提示后退出，让用户装完再启动）。
pub const EXIT_NO_WEBVIEW2: i32 = 4;

/// 启动决策结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BootChoice {
    /// 继续启动（落点已注入）
    Proceed,
    /// 用户选择退出：调用方应立刻 `exit(EXIT_MIGRATION_ABORTED)`
    Abort,
    /// 没有任何可写目录：调用方应 `exit(EXIT_NO_DATA_DIR)`
    NoDataDir,
    /// 缺 WebView2 运行时：调用方应 `exit(EXIT_NO_WEBVIEW2)`
    NoWebView2,
}

/// 一次落点决策的可补记事实。
#[derive(Debug, Clone)]
pub struct Note {
    /// 最终数据根
    pub data: PathBuf,
    /// 是否便携（`false` = 回退 AppData / 拿不到 exe 目录）
    pub portable: bool,
    /// 为什么回退（`None` = 没回退）
    pub fallback: Option<&'static str>,
    /// 落点来源，`bootstrap` 补记的 `data root:` 一行里就是 `source=`：
    /// `pointer` / `portable` / `portable-optout.json` / `permission-denied` / …
    pub source: &'static str,
}

/// 启动期缓存（`log::init` 之后由 `bootstrap` 补记）。
static NOTE: Mutex<Option<Note>> = Mutex::new(None);

/// 读启动期补记（`None` = 本模块没跑过，例如移动端）。
pub fn note() -> Option<Note> {
    NOTE.lock().ok().and_then(|guard| guard.clone())
}

/// 全部编排：探测 →（迁移）→ 注入 `app_dir`。
pub fn prepare(identifier: &str) -> BootChoice {
    let Some(exe_dir) = app_dir::exe_dir() else {
        /* 拿不到自己所在目录（极端环境）：没有「应用旁边」可言，直接用 AppData。 */
        return use_appdata(identifier, "exe-dir-unavailable", "拿不到程序所在目录");
    };
    let data_dir = exe_dir.join("data");

    /* WebView2 探针（仅 Windows）：缺运行时用户看到的是一条「双击没反应」，
    比一个能读懂的错误提示差得多（ADR-051 §1）。安装版的运行时由
    `embedBootstrapper` 在安装阶段补齐，这条探针在那边恒为 true，无副作用。 */
    if !prompt::webview2_ok() {
        prompt::ask_webview2();
        return BootChoice::NoWebView2;
    }

    /* ①【V0.11.15】自定义数据根优先（指针 > optout > 探测），正文在 `data_root_boot`。 */
    if let Some(choice) = super::data_root_boot::apply(identifier) {
        return choice;
    }
    /* ② 用户已经明确选过 AppData：不再探测、不再询问（删除标记即可恢复探测）。 */
    if let Some(appdata) = app_dir::appdata_dir(identifier) {
        if fs_probe::read_optout(&appdata).is_some() {
            set_roots(&appdata, "portable-optout.json");
            return BootChoice::Proceed;
        }
    }

    /* ② 探测可写性：不可写时三选一循环。 */
    loop {
        match fs_probe::probe(&data_dir) {
            Ok(()) => break,
            Err(reason) => match prompt::ask_permission(&reason, &data_dir) {
                Choice::Proceed => continue,
                Choice::AppData(detail) => {
                    return use_appdata(identifier, "permission-denied", &detail)
                }
                Choice::Quit => return BootChoice::Abort,
            },
        }
    }

    /* 探测会**创建** `<exe>\data`；便携包自己也预置了 `data\README.txt` 占位。
    两者都必须清掉，迁移才能直接 `rename` 上去（否则 Windows 上目标已存在必失败，
    只能走备份分支，每个便携用户都会在 `%APPDATA%` 里留下一份空备份）。 */
    make_room_for_migration(&data_dir);

    /* ③ 搬老数据（只复制、不删除）。 */
    let source = app_dir::appdata_dir(identifier);
    let mut outcome = migrate(&source, &data_dir);
    while let Outcome::Failed { stage, reason } = outcome {
        match prompt::ask_migrate_failed(&reason, source.as_deref()) {
            Choice::Proceed => outcome = migrate(&source, &data_dir),
            Choice::AppData(detail) => {
                return use_appdata(identifier, "migrate-failed", &format!("{stage}: {detail}"));
            }
            Choice::Quit => return BootChoice::Abort,
        }
    }

    /* ④ 插件目录：`<data>\plugins` → `<exe>\plugins`（只在目标不存在时 rename）。 */
    let plugins_dir = exe_dir.join("plugins");
    move_plugins(&data_dir, &plugins_dir);

    set_roots_pair(&data_dir, &plugins_dir);
    BootChoice::Proceed
}

/// 跑一次迁移（`source` 为 `None` = 系统里根本没有旧数据根 → 无事可做）。
fn migrate(source: &Option<PathBuf>, data_dir: &Path) -> Outcome {
    match source.as_deref() {
        Some(appdata) => mig::run_once(appdata, data_dir),
        None => Outcome::NoLegacy,
    }
}

/// 便携包里预置的 `data\README.txt` 内容。
///
/// **与打包脚本共用同一份文件**（`scripts/build-desktop.mjs` 也读它）：如果两处各写
/// 一份字面量，改了文案就会「删不掉自己的占位」→ 每个用户白留一份备份目录。
pub(crate) const DATA_README: &str = include_str!("../../packaging/data-readme.txt");

/// 迁移前腾出 `<exe>\data`：先删**我们自己写的** `README.txt`，再试着删空目录。
///
/// 判据很严：只删**内容与我们模板匹配**的那一个文件。用户自己建一个同名 `README.txt`
/// 时必须原样保留——那时 `data\` 非空、`remove_dir` 失败，迁移走备份分支，一份不丢。
pub(crate) fn make_room_for_migration(data_dir: &Path) {
    drop_own_readme(data_dir);
    /* 非空（用户自己放过东西 / README 内容不匹配）时 `remove_dir` 会失败，
    正好什么都不做。 */
    let _ = std::fs::remove_dir(data_dir);
}

/// 内容匹配才删：比「按文件名删」安全，用户手写的 `README.txt` 不会被误删。
fn drop_own_readme(data_dir: &Path) {
    let path = data_dir.join("README.txt");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return;
    };
    if normalize_readme(&text) == normalize_readme(DATA_README) {
        let _ = std::fs::remove_file(&path);
    }
}

/// 换行与行尾空白不参与比较：打包脚本写的是 CRLF，模板文件也可能被编辑器改成 LF。
fn normalize_readme(text: &str) -> String {
    text.replace("\r\n", "\n").trim_end().to_string()
}

/// 回退到 `%APPDATA%\<identifier>`：写标记 + 二次显式告知（回退必须**可见**）。
///
/// 拿不到 / 写不进 AppData 时返回 `NoDataDir`：两个落点都不可用 = 不带病启动。
fn use_appdata(identifier: &str, reason: &'static str, detail: &str) -> BootChoice {
    let Some(appdata) = app_dir::appdata_dir(identifier) else {
        prompt::ask_no_data_dir("既不能在应用目录写入数据，也拿不到 %APPDATA%。");
        return BootChoice::NoDataDir;
    };
    if fs_probe::probe(&appdata).is_err() {
        prompt::ask_no_data_dir(&format!(
            "应用目录与 %APPDATA% 都不可写：\n  {}",
            appdata.display()
        ));
        return BootChoice::NoDataDir;
    }
    fs_probe::write_optout(&appdata, reason, detail);
    set_roots(&appdata, reason);
    prompt::ask_appdata_notice(&appdata);
    BootChoice::Proceed
}

/// 注入便携落点（`<exe>\data`）。
fn set_roots_pair(data: &Path, plugins: &Path) {
    app_dir::set(Roots {
        data: data.to_path_buf(),
        plugins: plugins.to_path_buf(),
        portable: true,
    });
    cache_note(data, true, None, "portable");
}

/// 注入 AppData 落点。
fn set_roots(appdata: &Path, reason: &'static str) {
    app_dir::set(Roots {
        data: appdata.to_path_buf(),
        plugins: appdata.join("plugins"),
        portable: false,
    });
    cache_note(appdata, false, Some(reason), reason);
}

/// 缓存启动期补记（`bootstrap` 在日志就绪后读一次）。`pub(super)`：`data_root_boot`
/// 注入自定义根之后也要留一条同样形状的记录。
pub(super) fn cache_note(
    data: &Path,
    portable: bool,
    fallback: Option<&'static str>,
    source: &'static str,
) {
    if let Ok(mut guard) = NOTE.lock() {
        *guard = Some(Note {
            data: data.to_path_buf(),
            portable,
            fallback,
            source,
        });
    }
}

/// 把 `<data>\plugins` 里的插件搬到 `<exe>\plugins`：**逐个子目录**搬，撞名才留原地。
///
/// 为什么不能「目标存在就整体放弃」：便携包里带着 `plugins\README.txt` 占位
/// （否则空目录不进 zip），所以**每个**解压便携包的用户 `<exe>\plugins` 都存在。
/// 整目录放弃 = 升级后旧插件文件还在、功能全没了（`data\plugins` 不在
/// `plugin_fs::scan_roots` 的扫描拓扑里）。「不合并」的正确粒度是**单个插件**：
/// 拆到子目录后，撞名的那个留原地并 WARN，其余照常搬过去。
///
/// 顶层的散文件（`README.txt` 之类）不动、也不搬：那不是插件。
pub(crate) fn move_plugins(data_dir: &Path, plugins_dir: &Path) {
    let from = data_dir.join("plugins");
    if !from.is_dir() {
        return;
    }
    /* 目标不存在：整目录 rename（同盘原子、零拷贝），最省事的一条路。 */
    if !plugins_dir.exists() {
        if let Err(err) = std::fs::rename(&from, plugins_dir) {
            crate::log_warn!("portable: 迁移插件目录失败 {}：{err}", from.display());
        }
        return;
    }
    let entries = match std::fs::read_dir(&from) {
        Ok(entries) => entries,
        Err(err) => {
            crate::log_warn!("portable: 读不了 {}：{err}", from.display());
            return;
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let dest = plugins_dir.join(&name);
        if dest.exists() {
            crate::log_warn!(
                "portable: 插件 {} 与已有的重名，两份都保留，{} 里那份需要你自己处理",
                name.to_string_lossy(),
                from.display()
            );
            continue;
        }
        if let Err(err) = std::fs::rename(&path, &dest) {
            crate::log_warn!("portable: 搬运插件 {} 失败：{err}", path.display());
        }
    }
    /* 全搬完就顺手删掉空的 `data\plugins`；还有重名遗留时 `remove_dir` 会失败，
    正好把里面的用户数据留着。 */
    let _ = std::fs::remove_dir(&from);
}
