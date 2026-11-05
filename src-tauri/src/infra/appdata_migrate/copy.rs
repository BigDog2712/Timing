//! 整树复制 + 库文件改名映射 + 「备份改名」。
//!
//! 三条红线（PRD §4.6）在代码里的落点：
//! 1. **只读源**：全程只用 `read_dir` / `metadata` / `fs::copy`，没有任何写源目录的调用；
//! 2. **要么完整，要么没有**：先复制到 `<target>.migrating`，全部成功后才 `rename`；
//! 3. **WAL 一并搬**：`db.rs` 用的是 WAL 模式，只拷主库会丢未 checkpoint 的事务，
//!    因此库里按「名字前缀映射」整树拷，`-wal` / `-shm` 自然跟着走（不靠白名单）。

use std::path::Path;

use super::paths::{DB_NAME, LEGACY_DB_NAME};

/// 复制结果（`verify` 与日志都用它）。
#[derive(Debug, Clone, Copy, Default)]
pub struct CopyStats {
    /// 复制的文件数
    pub files: usize,
    /// 复制的总字节数
    pub bytes: u64,
    /// 拷贝后的主库字节数（没有库时为 0，M-13）
    pub db_bytes: u64,
    /// 是否把 `-wal` 一起搬了过来（M-08）
    pub wal_copied: bool,
}

/// 把 `source` 整棵树复制到 `dest`（`dest` 会被创建；不要求它事先不存在）。
pub fn copy_tree(source: &Path, dest: &Path) -> Result<CopyStats, String> {
    std::fs::create_dir_all(dest).map_err(|err| format!("创建临时目录失败：{err}"))?;
    let mut stats = CopyStats::default();
    copy_dir(source, dest, &mut stats)?;
    stats.wal_copied = dest.join(format!("{DB_NAME}-wal")).exists();
    stats.db_bytes = std::fs::metadata(dest.join(DB_NAME))
        .map(|m| m.len())
        .unwrap_or(0);
    Ok(stats)
}

/// 递归复制一个目录层级（按 `read_dir` 顺序，不做排序：结果与顺序无关）。
fn copy_dir(from: &Path, to: &Path, stats: &mut CopyStats) -> Result<(), String> {
    let entries = std::fs::read_dir(from)
        .map_err(|err| format!("读源目录 {} 失败：{err}", from.display()))?;
    for entry in entries {
        let entry = entry.map_err(|err| format!("读源目录项失败：{err}"))?;
        let src = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let dst = to.join(map_name(&name));
        /* 用 `metadata`（跟随符号链接）而不是 `symlink_metadata`：
        appdata 里偶见指向别处的目录链接，按链接目标判断才不会把目录当文件拷。 */
        let Ok(meta) = std::fs::metadata(&src) else {
            /* 悬空链接 / 刚被删的临时文件：跳过而不是整体失败。
            用户目录里这类残留不值得让「迁移失败」。 */
            continue;
        };
        if meta.is_dir() {
            std::fs::create_dir_all(&dst)
                .map_err(|err| format!("创建 {} 失败：{err}", dst.display()))?;
            copy_dir(&src, &dst, stats)?;
        } else {
            let bytes = std::fs::copy(&src, &dst)
                .map_err(|err| format!("复制 {} 失败：{err}", src.display()))?;
            stats.files += 1;
            stats.bytes += bytes;
        }
    }
    Ok(())
}

/// 库文件名映射：`tickbar.db` / `-wal` / `-shm` → 当前库名（阶段一为恒等映射）。
///
/// 只认三种后缀：`""`、`"-wal"`、`"-shm"`。`tickbar.dbx` 这类名字保持原样——
/// 宁可留一个没人读的文件，也不要误改名一个用户的备份。
pub fn map_name(name: &str) -> String {
    if DB_NAME == LEGACY_DB_NAME {
        return name.to_string();
    }
    match name.strip_prefix(LEGACY_DB_NAME) {
        Some("") | Some("-wal") | Some("-shm") => {
            format!("{DB_NAME}{}", &name[LEGACY_DB_NAME.len()..])
        }
        _ => name.to_string(),
    }
}

/// 把已存在的目标目录**改名备份**（`com.timing.app` → `com.timing.app.premigrate-<ts>`）。
///
/// 为什么不是删除（Q3 / D-D）：`fs::rename(temp, target)` 在目标已存在时 Windows 必失败，
/// 而直接删掉空白会话期间产生的数据又违反「不销毁用户数据」。改名两边都满足。
pub fn rename_aside(target: &Path, backup: &Path) -> Result<(), String> {
    if !target.exists() {
        return Ok(());
    }
    std::fs::rename(target, backup).map_err(|err| {
        format!(
            "备份改名失败 {} → {}：{err}",
            target.display(),
            backup.display()
        )
    })
}
