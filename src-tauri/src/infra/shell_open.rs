//! 用系统文件管理器打开一个目录（**不创建目录**）。
//!
//! 与 `infra::plugin_fs::open_dir` 的区别：那个是「插件目录不存在就先建好再打开」
//! （宿主拥有那个目录，建它是合理的）；本函数用于**用户的旧数据目录**——目录不存在
//! 时应当老实返回错误，而不是替用户造一个空目录出来（否则「打开旧数据目录」会变成
//! 「在 %APPDATA% 里新建一个 com.tickbar.app」）。

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
    let opener = if cfg!(windows) {
        "explorer"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    Command::new(opener)
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|err| format!("打开目录失败：{err}"))
}
