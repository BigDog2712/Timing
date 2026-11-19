//! 「这一行是不是安装/卸载/更新器」的正词表（从 `activity_read_model.rs` 搬出来）。
//!
//! 搬的理由只有一条：`activity_read_model.rs` 正好压在 `check:size` 的冻结线上
//! （638/638），而 T03 要给 `normalize_app_key` 加 `":"` 分支。三张词表是纯数据、
//! 与归一函数没有耦合，所以整块搬走，原文件用 `pub(crate) use` 回挂（调用点零改动）。
//!
//! 词表本身**一个字都没改**：这些词决定了哪些 exe 不进投影，改一个词就等于改历史数字。

/// exe 主干里的生命周期标记（`setup.exe` / `unins000.exe` / `update.exe` …）。
pub(crate) const LIFECYCLE_MARKERS: &[&str] = &[
    "setup",
    "install",
    "installer",
    "uninstall",
    "uninstaller",
    "unins",
    "unins000",
    "update",
    "updater",
    "upgrade",
    "remove",
    "maintenance",
    "maintenancetool",
];

/// 窗口标题里的生命周期标记（比 exe 那份多几个进行时形态）。
pub(crate) const LIFECYCLE_TITLE_MARKERS: &[&str] = &[
    "setup",
    "install",
    "installer",
    "installation",
    "installing",
    "uninstall",
    "uninstaller",
    "uninstallation",
    "uninstalling",
    "unins",
    "unins000",
    "update",
    "updater",
    "updating",
    "upgrade",
    "remove",
    "maintenance",
    "maintenancetool",
];

/// 打包器附加的构建标记（`App-win-x64.exe` 之类）。与生命周期标记同时出现才算命中。
pub(crate) const LIFECYCLE_BUILD_TOKENS: &[&str] = &[
    "win", "windows", "x64", "x86", "amd64", "arm64", "ia32", "portable", "release", "latest",
    "beta", "alpha", "nightly", "stable", "desktop", "app",
];
