//! 旧产品名遗留数据的接管。
//!
//! 产品从 TickBar 更名为 Timing 后，`identifier` 由 `com.tickbar.app` 变为
//! `com.timing.app`，整个数据目录跟着搬家；数据库文件名也从 `tickbar.db` 变成
//! `timing.db`。老用户升级后不该看见空数据，所以启动时一次性接管旧目录。
//!
//! 口径：
//! - **只复制，不删旧的**。搬错了还能回头，那点空间让用户自己决定何时清。
//! - **新目录已有库就不动**。说明这台机器已经在用新名字，再复制只会拿旧数据
//!   盖掉新数据，比不迁移更糟。
//! - 目标已存在的文件一律跳过，避免覆盖正在写的日志。
//!
//! **本文件里的 `com.tickbar.app` / `tickbar.db` 是历史名，故意保留。**
//! 它们是要被识别、被搬走的旧值，跟着改名就失去意义了。

use std::fs;
use std::path::{Path, PathBuf};

/// 旧 identifier，同时是旧数据目录名。
const LEGACY_DIR: &str = "com.tickbar.app";
/// 新库文件名。
const DB: &str = "timing.db";
/// 旧库文件名。
const LEGACY_DB: &str = "tickbar.db";
/// SQLite WAL 的伴生文件后缀（不同步迁移会让库看起来「回滚到最后一次 checkpoint」）。
const DB_SIDE: [&str; 2] = ["-wal", "-shm"];

/// 把旧目录的数据接管到 `data_dir`，返回是否真的搬了东西。
pub fn adopt(data_dir: &Path) -> std::io::Result<bool> {
    if data_dir.join(DB).exists() {
        return Ok(false);
    }
    let Some(parent) = data_dir.parent() else {
        return Ok(false);
    };
    let legacy = parent.join(LEGACY_DIR);
    if !legacy.is_dir() {
        return Ok(false);
    }
    fs::create_dir_all(data_dir)?;
    copy_tree(&legacy, data_dir)?;
    rename_db(data_dir);
    Ok(true)
}

/// 递归复制，目标已有的文件不覆盖。
fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let src = entry.path();
        let dst = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            fs::create_dir_all(&dst)?;
            copy_tree(&src, &dst)?;
        } else if !dst.exists() {
            fs::copy(&src, &dst)?;
        }
    }
    Ok(())
}

/// 旧库与它的 WAL 伴生文件改名成新名字。
///
/// 失败只当没有旧库：下次启动 `adopt` 还会再试一次，不必在启动路径上硬失败。
fn rename_db(dir: &Path) {
    let old = dir.join(LEGACY_DB);
    if old.exists() && !dir.join(DB).exists() {
        let _ = fs::rename(&old, dir.join(DB));
    }
    for side in DB_SIDE {
        let src: PathBuf = dir.join(format!("{LEGACY_DB}{side}"));
        if src.exists() {
            let _ = fs::rename(&src, dir.join(format!("{DB}{side}")));
        }
    }
}

#[cfg(test)]
#[path = "legacy_test.rs"]
mod tests;
