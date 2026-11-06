//! 用系统文件管理器打开一个目录（**不创建目录**）。
//!
//! 与 `infra::plugin_fs::open_dir` 的区别：那个是「插件目录不存在就先建好再打开」
//! （宿主拥有那个目录，建它是合理的）；本函数用于**用户的旧数据目录**——目录不存在
//! 时应当老实返回错误，而不是替用户造一个空目录出来（否则「打开旧数据目录」会变成
//! 「在 %APPDATA% 里新建一个 com.timing.app」）。

use std::path::Path;
use std::process::Command;

/// 在资源管理器 / Finder / 文件管理器里打开 `path`。
///
/// 只 `spawn` 不 `wait`：explorer 即使成功也常以退出码 1 结束，
/// 等它返回会把「打开成功」误判成失败。
pub fn open_dir(path: &Path) -> Result<(), String> {
    if !path.is_dir() {
        return Err(format!("目录不存在：{}", path.display()));
    }
    spawn(opener(), path, "打开目录失败")
}

/// 用系统默认程序打开一个**文件**（如 Markdown 日记）。
///
/// [V0.11.3] 从 `services::md_sync` 搬过来：那里原先自己拼了一版 `Command::new("explorer")`，
/// 与这里的平台分支完全重复。搬进来之后只有一个开文件的地方，安全口径也就一处
/// ——`explorer` / `open` / `xdg-open` 都只吃一个参数、不经 shell 解析，
/// 而路径里的 `&`、`|`、`^` 在这个前提下没有意义（`cmd /C start` 才有，已弃用）。
pub fn open_file(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Err(format!("文件不存在：{}", path.display()));
    }
    spawn(opener(), path, "打开文件失败")
}

/// 用系统默认浏览器打开一个 URL（[V0.11.6] 便携版缺 WebView2 时给下载页出口）。
///
/// 判据与 `open_dir` 同一套：只 `spawn` 不 `wait`，不经 shell 解析。
/// URL 由调用方写死（不接受用户输入），因此没有参数注入面。
pub fn open_url(url: &str) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err(format!("只允许打开 https 链接：{url}"));
    }
    spawn(opener(), Path::new(url), "打开网页失败")
}

fn opener() -> &'static str {
    if cfg!(windows) {
        "explorer"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    }
}

fn spawn(opener: &str, path: &Path, what: &str) -> Result<(), String> {
    Command::new(opener)
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|err| format!("{what}：{err}"))
}
