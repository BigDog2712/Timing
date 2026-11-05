//! 纯判定：要不要迁移、走哪条分支。
//!
//! 只做 `exists()` 级别的探测，**不复制、不改名、不写文件**——这样判定逻辑
//! 可以单独推理，也便于 M-05 / M-02 两条「不要动」的用例断言「真的什么都没动」。

use std::path::Path;

use super::marker::{MARKER_FILE, PENDING_FILE};
use super::paths::{Paths, DB_NAME, LEGACY_DB_NAME};

/// PRD §4.1 条件 3：旧目录里至少存在其中之一，才算「有旧数据」。
///
/// 只看**条目存在**，不看内容多少：`M-13`（只有一个空 `logs/`）也算有旧数据，
/// 迁移会把日志搬过去然后正常空库启动，不弹失败框。
const LEGACY_ENTRIES: [&str; 4] = [LEGACY_DB_NAME, "plugins", "logs", ".window-state.json"];

/// 判定所需的全部事实（一次探测，之后不再碰文件系统）。
#[derive(Debug, Clone, Copy)]
pub struct Facts {
    /// 目标目录与源目录是同一个（阶段一必然为真：identifier 还没换）
    pub same_dir: bool,
    /// 旧目录里有「旧数据」条目
    pub source_has_data: bool,
    /// 目标目录里已有库文件（新旧库名任一）
    pub target_db_exists: bool,
    /// 目标目录里有「已迁移」标记
    pub target_has_marker: bool,
    /// 目标目录里有「待迁移」标记（上次用户选了以空白数据启动）
    pub has_pending: bool,
}

/// 判定结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// 目标 == 源：什么都不做（阶段一的正常状态）
    SameDir,
    /// 全新用户：旧目录不存在或没有旧数据
    NoLegacy,
    /// 已经迁移过（有标记），或目标已有库但旧目录已无数据
    AlreadyPresent,
    /// 目标已有库、旧目录还有数据、且没有待迁移标记 → 不覆盖、不合并
    Occupied,
    /// 目标已有库、旧目录还有数据、且上次用户选了「以空白数据启动」→ 覆盖式迁移
    Overwrite,
    /// 正常迁移
    Go,
}

/// 探测事实。只调 `exists()`，无任何写操作。
pub fn inspect(paths: &Paths) -> Facts {
    Facts {
        same_dir: paths.is_same_dir(),
        source_has_data: has_legacy_data(&paths.source),
        target_db_exists: paths.target.join(DB_NAME).exists()
            || paths.target.join(LEGACY_DB_NAME).exists(),
        target_has_marker: paths.target.join(MARKER_FILE).exists(),
        has_pending: paths.target.join(PENDING_FILE).exists(),
    }
}

/// 目录里是否有「旧数据」条目（PRD §4.1 条件 3）。
pub fn has_legacy_data(dir: &Path) -> bool {
    LEGACY_ENTRIES.iter().any(|name| dir.join(name).exists())
}

/// 由事实推导动作。**顺序即优先级**，每一支的理由都写在行内。
pub fn decide(facts: &Facts) -> Decision {
    /* ① 目标 == 源。阶段一（identifier 仍是 com.tickbar.app）必走这一支：
    不做这一步，迁移会把用户自己的目录「改名备份 + 拷回来」一次。 */
    if facts.same_dir {
        return Decision::SameDir;
    }
    /* ② 旧目录没有旧数据 → 全新用户（M-04）。
    放在「目标已有库」之前：老用户删掉旧目录后又启动（M-03）也应当安静地走这里。 */
    if !facts.source_has_data {
        return Decision::NoLegacy;
    }
    if facts.target_db_exists {
        /* ③ 有标记 = 本版本已经搬过（M-02）。不再复制、不再校验、不重写标记。 */
        if facts.target_has_marker {
            return Decision::AlreadyPresent;
        }
        /* ④ 有待迁移标记 = 上次用户显式选了「以空白数据启动」（D-C / Q3）。
        不覆盖式迁移的话，空白会话在新目录建出的库会让条件永远为假，
        老数据从此再也搬不过来（ARCHITECTURE §7 N1）。 */
        if facts.has_pending {
            return Decision::Overwrite;
        }
        /* ⑤ 目标有库、旧目录也有东西、但没有标记 → 发现未采用的旧数据（M-05）。
        绝不覆盖、绝不合并、绝不自动删除；只记 WARN + 诊断一行 + 设置页提示。 */
        return Decision::Occupied;
    }
    /* ⑥ 目标无库、旧目录有数据 → 正常迁移（M-01）。 */
    Decision::Go
}
