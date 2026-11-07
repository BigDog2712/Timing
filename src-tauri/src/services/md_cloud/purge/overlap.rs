//! 闸③：清理目录与任何 `md_sync` 落点「相同或互为父子」→ 拒绝（设计 §3.4.1）。
//!
//! 只有 LocalFolder 这一路需要它（WebDAV 清的是远端，没有「删到主人日记目录」这回事），
//! 所以它是 `folder` 的邻居而不是 `gate` 的邻居：`gate.rs` 只放**两路共用**的纯判定。
//!
//! 单独一个文件是为了让「判不出来就拒绝」这条保守默认有个短小的落地处 —— 它和留底、
//! 删除、枚举都不该混在同一个文件里被顺手改掉。

use std::fs;
use std::path::Path;

use crate::models::md_cloud_purge::OVERLAP_TEXT;
use crate::models::md_sync::MdSyncBinding;
use crate::models::md_sync_cloud::normalize_path;

/// 闸③：`root` 与任何 `md_sync` 落点重合 → `Err(逐字红字)`。
///
/// 三步判定，**任何一步判不出来也拒绝**：
///
/// 1. 规范化字符串比较（`normalize_path`：展开占位符 → `/`→`\` → 去尾 `\` → 小写）。
///    不碰文件系统，覆盖「就是同一个目录」这种最常见的错配；
/// 2. 两侧都 `canonicalize`（Windows 上走 GetFinalPathNameByHandle，会解析符号链接 /
///    junction / 8.3 短名 / 相对段，返回 `\\?\C:\…`），去掉统一前缀再按第 1 步规则比；
/// 3. 只有一侧成功（另一侧目录还不存在）→ 视为不重合（不存在的目录里没有文件）。
///    但**落点根自己必须 canonicalize 成功**：`round_folder` 刚 `create_dir_all` 过它，
///    拿不到真实路径只能是权限 / 盘符问题 → 判不出来就拒绝。
///
/// 四条边界写死在这里，别处不再判一遍：大小写（比较前统一小写）、`..` 与相对路径
/// （第 1 步不下结论）、8.3 短名与 junction（只有 canonicalize 能识别，所以第 2 步不是
/// 加固而是必需品）、保守默认（判不出来就拒绝）。
pub(crate) fn overlaps_binding(root: &Path, bindings: &[MdSyncBinding]) -> Result<(), String> {
    let mine = normalize_path(&root.to_string_lossy());
    let mine_real = fs::canonicalize(root)
        .map(|path| strip_verbatim(&path.to_string_lossy()))
        .map_err(|_| OVERLAP_TEXT.to_string())?;
    for binding in bindings {
        if binding.root.trim().is_empty() {
            continue;
        }
        if conflicts(&mine, &normalize_path(&binding.root)) {
            return Err(OVERLAP_TEXT.to_string());
        }
        let Ok(theirs) = fs::canonicalize(&binding.root) else {
            continue;
        };
        if conflicts(&mine_real, &strip_verbatim(&theirs.to_string_lossy())) {
            return Err(OVERLAP_TEXT.to_string());
        }
    }
    Ok(())
}

/// 两个**已规范化**的路径是否相同或互为父子。含 `..` 时不下结论（交给真实路径那一步）。
fn conflicts(mine: &str, theirs: &str) -> bool {
    if mine.is_empty()
        || theirs.is_empty()
        || has_parent_segment(mine)
        || has_parent_segment(theirs)
    {
        return false;
    }
    mine == theirs
        || mine.starts_with(&format!("{theirs}\\"))
        || theirs.starts_with(&format!("{mine}\\"))
}

fn has_parent_segment(path: &str) -> bool {
    path.split('\\').any(|segment| segment == "..")
}

/// `canonicalize` 在 Windows 上返回 `\\?\C:\…`：两侧同样处理才能逐字比。
fn strip_verbatim(path: &str) -> String {
    path.trim_start_matches(r"\\?\").to_lowercase()
}
