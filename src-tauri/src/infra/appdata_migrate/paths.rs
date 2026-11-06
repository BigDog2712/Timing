//! 数据迁移的路径与命名常量（**唯一口径**，其它文件不得自创变体）。
//!
//! 本模块只做纯路径拼接，不做任何 IO，也不读 identifier / 环境变量：
//! 迁移目标由调用方（生产 = `lib.rs` 里的 `ctx.config().identifier`；
//! 测试 = 任意临时目录名）传进来。这样「改名」与「迁移」可以分阶段落地。

use std::path::{Path, PathBuf};

/// 旧版本的 identifier。阶段二改 identifier 后它**仍然**指向老目录——它就是「从哪来」。
pub const LEGACY_IDENTIFIER: &str = "com.tickbar.app";

/// 旧版本的库文件名。
pub const LEGACY_DB_NAME: &str = "tickbar.db";

/// 旧版本的自启注册表值名 = 旧版 `productName`（**不是 identifier**，见 ADR-037/ARCHITECTURE §7 N6）。
pub const LEGACY_PRODUCT_NAME: &str = "TickBar";

/// 本版本的库文件名。
///
/// 阶段一（B1）曾与老库同名（迁移只是「同一个库名、换一个目录」，映射是恒等映射）；
/// 阶段二（B2，0.5.0）随 `tauri.conf.json::identifier` 同批改成 `timing.db`，
/// 映射自此真正生效：迁移时 `tickbar.db*` → `timing.db*`（含 `-wal` / `-shm`）。
pub const DB_NAME: &str = "timing.db";

/// 迁移临时目录后缀：`<target>.migrating`。
pub const TEMP_SUFFIX: &str = ".migrating";

/// 覆盖式迁移时旧目标目录的备份后缀：`<target>.premigrate-<ts>`。
pub const PREMIGRATE_SUFFIX: &str = ".premigrate-";

/// 迁移涉及的五个路径（纯拼接结果）。
///
/// `backup` 的构造时刻即 `Paths` 的构造时刻：生产侧在 `run()` 开头构造、
/// 立刻执行迁移，两者相差毫秒级；测试侧同样是「构造后立即调用」。
#[derive(Debug, Clone)]
pub struct Paths {
    /// 数据根目录（Windows = `%APPDATA%`）
    pub base: PathBuf,
    /// 旧目录：`<base>/com.tickbar.app`
    pub source: PathBuf,
    /// 新目录：`<base>/<identifier>`
    pub target: PathBuf,
    /// 迁移临时目录：`<base>/<identifier>.migrating`
    pub temp: PathBuf,
    /// 覆盖式迁移的备份目录：`<base>/<identifier>.premigrate-<ts>`
    pub backup: PathBuf,
}

impl Paths {
    /// 纯拼接，无 IO（测试用任意两个临时目录时也走这个构造函数）。
    pub fn new(base: &Path, target_id: &str) -> Self {
        let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
        Self {
            base: base.to_path_buf(),
            source: base.join(LEGACY_IDENTIFIER),
            target: base.join(target_id),
            temp: base.join(format!("{target_id}{TEMP_SUFFIX}")),
            backup: base.join(format!("{target_id}{PREMIGRATE_SUFFIX}{ts}")),
        }
    }

    /// 生产入口一：`dirs::data_dir()` + identifier（来自 `lib.rs` 的 `Context`）。
    ///
    /// 与 Tauri 完全同源：Tauri 2.12.4 内部即 `dirs 7` + identifier
    /// （所以 `Cargo.toml` 必须声明 `dirs = "7"`，见 ARCHITECTURE §1.3.4）。
    #[cfg(desktop)]
    pub fn resolve(target_id: &str) -> Option<Self> {
        let base = data_dir()?;
        Some(Self::new(&base, target_id))
    }

    /// 生产入口二：由权威 `app_data_dir` 反推（命令层用，避免再算一遍 identifier）。
    pub fn from_app_data_dir(app_data_dir: &Path) -> Option<Self> {
        let base = app_data_dir.parent()?;
        let target_id = app_data_dir.file_name()?.to_str()?;
        Some(Self::new(base, target_id))
    }

    /// 目标与源是同一个目录（阶段一必然如此：identifier 仍是 `com.tickbar.app`）。
    ///
    /// 必须显式判掉：否则「把源目录改名备份、再把自己拷回来」会在阶段一的
    /// release 构建上真的执行一次——用户数据没丢，但目录被改名，M-12 回滚通道
    /// 之外的观感极差。
    pub fn is_same_dir(&self) -> bool {
        self.target == self.source
    }
}

/// 旧数据目录（由权威 `app_data_dir` 的父目录重算，**不读任何标记文件**）。
///
/// 存在性判断由调用方做：这里只回答「按规则应该在哪」。
///
/// 实现走 `Paths::from_app_data_dir` 而不是自己拼一遍：命令层的「反推」与
/// 测试里的「正拼」必须走同一段代码，否则 `LEGACY_IDENTIFIER` 哪天变了，
/// 只有其中一侧跟着变。
///
/// **谁用哪个**（V0.11.6 起两个函数共存，职责不同）：
/// - `legacy_dir_of(app_data_dir)` = **迁移执行期**用：那时数据根还没决定（甚至可能
///   已经不是 `%APPDATA%`），只能从「当前权威数据根」反推同级的旧 identifier 目录；
/// - `legacy_dir()` = **展示 / 命令层**用：与当前数据根**无关**，恒为
///   `%APPDATA%\com.tickbar.app`。便携模式下数据根是 `<exe>\data`，用
///   `legacy_dir_of` 会算出 `<exe>\com.tickbar.app`（一个永不存在的路径）。
pub fn legacy_dir_of(app_data_dir: &Path) -> Option<PathBuf> {
    Paths::from_app_data_dir(app_data_dir).map(|paths| paths.source)
}

/// 旧品牌数据目录（**与当前数据根无关**：品牌改名迁移的目标恒在 `%APPDATA%` 下）。
///
/// 只用于「告诉用户旧目录在哪」（设置页、诊断快照、`open_legacy_dir`），不参与搬运算。
///
/// 实现故意走 `legacy_dir_of` 而不是自己 `base.join(LEGACY_IDENTIFIER)`：
/// 「旧目录在哪」只允许有一份推导（`legacy_dir_of` 只看父目录 + 固定旧 identifier，
/// 锚点目录本身叫什么无关紧要），旧名将来再变时两边不会分叉。
///
/// 移动端返回 `None`：Android 换包名 = 新应用，系统层面没有「旧目录」这个概念
/// （`dirs` 也只进桌面 target 段，这里不可能算出路径）。
#[cfg(desktop)]
pub fn legacy_dir() -> Option<PathBuf> {
    let base = data_dir()?;
    legacy_dir_of(&base.join(LEGACY_IDENTIFIER))
}

#[cfg(mobile)]
pub fn legacy_dir() -> Option<PathBuf> {
    None
}

/// `dirs::data_dir()`：Windows = `%APPDATA%`（Roaming）。
///
/// 桌面独占：`dirs` 只进桌面 target 段（移动端没有「用户数据根目录」这个概念，
/// 应用沙箱由系统给定，迁移也不在移动端执行）。
#[cfg(desktop)]
pub fn data_dir() -> Option<PathBuf> {
    dirs::data_dir()
}
