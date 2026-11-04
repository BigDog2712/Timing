//! Markdown 落点写前留底（V0.4.1）。
//!
//! ## 为什么需要
//!
//! `md-sync` 每 2 秒把「目标标题下的那一段」重写回去，写的是**用户自己的日记文件**。
//! 区块边界靠「下一个同级或更高级标题」判定（`md_file::section_end`），这一层一旦判错
//! （用户手写了 `#` 开头但不打算当标题的行、粘贴了别人的片段、或者标题本身被改过），
//! 被覆盖掉的是人手写的内容。`write_atomic` 只保证「不会留下半个区块」，
//! 保证不了「写进去的内容是对的」。
//!
//! 所以这里补一道与业务无关的保险：**覆盖前把原文件内容原样存一份**。
//!
//! ## 口径
//!
//! - 只在「文件已存在且内容确实要变」时留底（新建文件没有旧内容可丢）；
//! - 落点固定 `<app_data_dir>/backups/md/`，**不写进用户 vault**——不在 Obsidian 里
//!   制造一堆 `.bak`；
//! - 文件名 `<原文件名>-<yyyyMMdd-HHmmss>.md`，同秒重复写会同名覆盖（可接受：
//!   同一秒内两次写盘的内容差异极小）；
//! - 最多保留 `KEEP` 份，按修改时间淘汰（与 `platform::log` 的清理口径一致）；
//! - **任何失败都静默**：留底是附加保险，不能因为它写不出来而挡住同步本身。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::SystemTime;

/// 保留份数。按「每次真实写盘存一份」估算，够回看最近若干天的日记改写现场。
const KEEP: usize = 30;

static ROOT: OnceLock<PathBuf> = OnceLock::new();

/// 由启动装配（`app::bootstrap`）注入落点；未注入时 `save` 为 no-op。
pub fn set_root(dir: PathBuf) {
    let _ = ROOT.set(dir);
}

/// 覆盖 `source` 之前，把它的原内容 `text` 存一份。
pub fn save(source: &Path, text: &str) {
    let Some(root) = ROOT.get() else {
        return;
    };
    save_to(root, source, text);
}

fn save_to(root: &Path, source: &Path, text: &str) {
    if text.trim().is_empty() {
        return;
    }
    if fs::create_dir_all(root).is_err() {
        return;
    }
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("md");
    let name = format!(
        "{}-{}.md",
        sanitize(stem),
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );
    if fs::write(root.join(name), text).is_err() {
        return;
    }
    prune(root);
}

/// 文件名里只留字母数字与 `-` `_`，避免把路径分隔符带进备份目录。
fn sanitize(raw: &str) -> String {
    raw.chars()
        .map(|ch| {
            if ch.is_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

/// 超过 `KEEP` 份就按修改时间删最旧的。
fn prune(root: &Path) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    let mut files: Vec<(SystemTime, PathBuf)> = entries
        .flatten()
        .filter(|entry| entry.path().extension().and_then(|ext| ext.to_str()) == Some("md"))
        .filter_map(|entry| {
            entry
                .metadata()
                .and_then(|meta| meta.modified())
                .ok()
                .map(|time| (time, entry.path()))
        })
        .collect();

    if files.len() <= KEEP {
        return;
    }
    files.sort_by_key(|(time, _)| *time);
    let excess = files.len() - KEEP;
    for (_, path) in files.iter().take(excess) {
        let _ = fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tickbar-md-backup-{tag}"));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn writes_a_copy_named_after_the_source() {
        let root = temp_dir("copy");
        let source = Path::new("C:\\vault\\2026-10-20.md");
        save_to(&root, source, "# 日记\n\n手写内容");

        let files: Vec<_> = fs::read_dir(&root)
            .expect("备份目录应已创建")
            .flatten()
            .collect();
        assert_eq!(files.len(), 1);
        let name = files[0].file_name().to_string_lossy().to_string();
        assert!(
            name.starts_with("2026-10-20-"),
            "文件名要能看出源文件: {name}"
        );
        let body = fs::read_to_string(files[0].path()).expect("备份应可读");
        assert_eq!(body, "# 日记\n\n手写内容", "必须原样保存，不做归一化");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn empty_content_is_not_backed_up() {
        let root = temp_dir("empty");
        save_to(&root, Path::new("x.md"), "   \n\n ");
        assert!(!root.exists(), "空内容不该创建目录");
    }

    #[test]
    fn keeps_only_the_newest_files() {
        let root = temp_dir("prune");
        fs::create_dir_all(&root).expect("建临时目录");
        for index in 0..(KEEP + 5) {
            fs::write(root.join(format!("old-{index:03}.md")), "x").expect("写样本");
        }
        save_to(&root, Path::new("y.md"), "新内容");

        let count = fs::read_dir(&root).expect("读目录").flatten().count();
        assert!(count <= KEEP, "保留份数应不超过 {KEEP}，实际 {count}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn path_separators_never_reach_the_file_name() {
        assert_eq!(sanitize("2026-10-20"), "2026-10-20");
        /* 中文属于 `is_alphanumeric`，保留原样（备份文件名要认得出来）；
        危险的是分隔符与 `..`，它们必须被替换掉。 */
        assert_eq!(sanitize("../日记"), "___日记");
        assert_eq!(sanitize("a\\b/c"), "a_b_c");
        assert!(!sanitize("..\\..\\x").contains('\\'));
    }
}
