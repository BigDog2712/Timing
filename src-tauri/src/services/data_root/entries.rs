//! 数据根搬迁的**六项清单**：算体积、报现状、给出每项的源与目标。
//!
//! 从 `transfer.rs` 拆出来有两个理由，都不是洁癖：
//!
//! 1. `transfer.rs` 当时 **299 行**（门禁 300，且不在 allowlist 里、棘轮只许降）。
//!    这次要给清单加「目标相对名」与「运行期派生」，装不进去。
//! 2. 更要紧的是**语义**：清单的第六项（活动数据）的**源路径**不是编译期常量。
//!    T05 迁移失败会 fail-open 回旧布局，此时活动数据在 `<根>/patina/data`；把它写成
//!    编译期 `"activity/data"` ⇒ 搬盘时去搬一个不存在的目录 ⇒ 用户活动历史不被搬、
//!    零报错，而且确认对话框还会显示「活动数据：0 字节 / 不存在」。
//!
//! ## 源的相对名 vs 目标的相对名
//!
//! 这两个**必须分开**：源按当前布局定（可能是旧名），目标**恒为**新名
//! （`ACTIVITY_DATA_REL`）——搬过去的新根永远是新布局，不需要在那里兼容旧名。

use std::fs;
use std::path::Path;

use crate::infra::activity::activity_layout;
use crate::infra::activity::storage_paths::ACTIVITY_DATA_REL;
use crate::infra::appdata_migrate::marker::MARKER_FILE;
use crate::models::data_root::DataRootEntry;

/// 清单里的一项。
///
/// `path` 是**源**相对名，`dest_path` 是**目标**相对名：五项相同，只有活动数据那一项
/// 可能不同（见模块头）。`label` 与它们分开是因为给用户看的名字不该是目录结构
/// （`activity/data` 印进对话框等于让用户自己翻译）。
#[derive(Clone, Copy, Debug)]
pub(super) struct Entry {
    pub path: &'static str,
    pub dest_path: &'static str,
    pub label: &'static str,
    pub is_dir: bool,
    /// 只有活动数据那一项是 `Some`：这一项**不能按普通目录拷**（库是活的），要走
    /// `activity_copy::copy_activity_dir`，而它的**源**库名可能是 T05 之前的旧名。
    pub activity_source_db: Option<&'static str>,
}

/// 前五项（顺序固定，与 PRD 4.2 / 设计 §3.6 一致）。第六项「活动数据」是运行期派生的，
/// 见 [`layout_entries`]。
const FIXED: [Entry; 5] = [
    Entry {
        path: "timing.db",
        dest_path: "timing.db",
        label: "timing.db",
        is_dir: false,
        activity_source_db: None,
    },
    Entry {
        path: "backups",
        dest_path: "backups",
        label: "backups",
        is_dir: true,
        activity_source_db: None,
    },
    Entry {
        path: "logs",
        dest_path: "logs",
        label: "logs",
        is_dir: true,
        activity_source_db: None,
    },
    Entry {
        path: "md",
        dest_path: "md",
        label: "md",
        is_dir: true,
        activity_source_db: None,
    },
    Entry {
        path: MARKER_FILE,
        dest_path: MARKER_FILE,
        label: MARKER_FILE,
        is_dir: false,
        activity_source_db: None,
    },
];

/// 活动数据在确认对话框里的名字。
const ACTIVITY_LABEL: &str = "activity";

/// 六项清单，**按 `root` 的实际布局**派生活动数据那一项的源路径。
///
/// `root` 必须是「活动数据现在住在里面」的那个根（搬盘时是 `source`，报现状时是
/// 用户当前的数据根）。
pub(super) fn layout_entries(root: &Path) -> [Entry; 6] {
    let (source_rel, source_db) = activity_layout::source_spec_in(root);
    let activity = Entry {
        path: source_rel,
        /* 目标恒为新名：新根永远是新布局。 */
        dest_path: ACTIVITY_DATA_REL,
        label: ACTIVITY_LABEL,
        is_dir: true,
        activity_source_db: Some(source_db),
    };
    /* 顺序是契约（PRD 4.2）：活动数据排在 `md` 之后、标记文件之前。 */
    [FIXED[0], FIXED[1], FIXED[2], FIXED[3], activity, FIXED[4]]
}

/// 六项清单的当前状态（给确认对话框用）。
///
/// `present` 判的是**源**路径：Legacy 布局下就该看到 `patina/data` 里的那份数据，
/// 而不是「按新名找不到 ⇒ 你没有活动数据」。
pub fn entries(root: &Path) -> Vec<DataRootEntry> {
    layout_entries(root)
        .iter()
        .map(|entry| {
            let path = root.join(entry.path);
            let present = if entry.is_dir {
                path.is_dir()
            } else {
                path.is_file()
            };
            DataRootEntry {
                name: entry.label.to_string(),
                is_dir: entry.is_dir,
                present,
                bytes: if present { measure(&path) } else { 0 },
            }
        })
        .collect()
}

/// 六项体积之和（递归求和，不设上限——这是应用自己的数据根）。
pub fn total_bytes(root: &Path) -> u64 {
    entries(root).iter().map(|entry| entry.bytes).sum()
}

/// 递归体积（文件取 `len`，目录递归求和）。
fn measure(path: &Path) -> u64 {
    let Ok(meta) = fs::metadata(path) else {
        return 0;
    };
    if meta.is_file() {
        return meta.len();
    }
    let Ok(items) = fs::read_dir(path) else {
        return 0;
    };
    items.flatten().map(|item| measure(&item.path())).sum()
}
