//! 备份目录的**读侧**：名字解析、列表、读回字节。
//!
//! 从 `md_backup` 拆出来是为了行数：写侧（`save` / `register_root` / `tag_of` / `prune`）
//! 已经用掉那里的预算，而读侧与写侧几乎不共享状态。对外路径不变——`md_backup` 里
//! `pub use` 转发 `list` / `read` / `parse_name` / `BackupFile`，调用方不必知道拆过。
//!
//! ## 名字格式
//!
//! 新备份：`<标识>__<sanitize(原文件名)>-<yyyyMMdd-HHmmss>.md`，例如
//! `webdav__2026-11-06-20261106-093000.md`。老备份（无 `__`）**不删、不改名**，
//! 解析出来 `target = None`，列表里标「归属未知」。
//!
//! ## 死码说明
//!
//! 调用点在 T03（`services/md_backup` 的列表与恢复）。接线之前只有单测在用。

#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::infra::md_backup::backup_root;

/// 落点标识的三个合法值（设计 §6-1）。**全库唯一口径**：备份文件名前缀、
/// `BackupFile.target`、前端那张表都只认这三个词，不许出现 `local` 之类的另一个写法。
pub(crate) const TAGS: [&str; 3] = ["obsidian", "webdav", "folder"];

/// `-yyyyMMdd-HHmmss` 的长度：1 + 8 + 1 + 6。**前导 `-` 算在时间里**：文件名是
/// `<stem>-<时间戳>`，切点若落在 `-` 之后，还原出来的来源名会多一个尾巴。
const TIMESTAMP_LEN: usize = 16;

/// 备份列表的一行。`name` 是恢复时要原样回传的文件名。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupFile {
    pub name: String,
    /// `None` = 老备份，归属未知（恢复时让用户自己选落点）。
    pub target: Option<&'static str>,
    /// 来源文件名，如 `2026-11-06.md`。
    pub source: String,
    /// 备份文件的修改时间（毫秒墙钟），列表按它降序。
    pub at_ms: i64,
    pub bytes: u64,
}

/// 标识白名单查表。返回 `&'static str`，于是后面整条链路都不用再分配字符串。
pub(crate) fn known_tag(raw: &str) -> Option<&'static str> {
    TAGS.iter().copied().find(|tag| *tag == raw)
}

/// 纯函数解析（单测入口）。
///
/// `Some((Some(tag), "2026-11-06.md"))` = 新格式；
/// `Some((None, "2026-11-06.md"))` = 老格式，按设计 §2.4 整体按老格式处理；
/// `None` = 这个名字根本不是备份（`readme.md`、时间戳不合形），列表直接跳过。
pub fn parse_name(name: &str) -> Option<(Option<&'static str>, String)> {
    let file = name.trim();
    if file.is_empty() || file.contains('/') || file.contains('\\') {
        return None;
    }
    let stem = file.strip_suffix(".md")?;
    let (tag, body) = match stem.split_once("__") {
        Some((left, right)) => match known_tag(left) {
            Some(tag) => (Some(tag), right),
            /* 左段不是标识 → 整个 stem 按老格式解析。`__` 可能只是用户自己文件名的一部分，
            不能因为出现过 `__` 就认定它是新格式。 */
            None => (None, stem),
        },
        None => (None, stem),
    };
    let source = source_of(body)?;
    Some((tag, source))
}

/// 当前生效的备份目录列表（按 `at_ms` 降序）。目录不存在时返回空表而不是报错：
/// 用户还没触发过任何写盘，界面上就是「暂无备份」。
pub fn list() -> Vec<BackupFile> {
    backup_root().map_or_else(Vec::new, list_in)
}

/// 读回一份备份的原始字节。名字来自前端，按不可信输入处理。
pub fn read(name: &str) -> Result<Vec<u8>, String> {
    let root = backup_root().ok_or_else(|| "备份目录还没准备好".to_string())?;
    read_in(root, name)
}

pub(crate) fn list_in(root: &Path) -> Vec<BackupFile> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut out: Vec<BackupFile> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            // 先过名字：不是备份的文件（手工塞进去的说明、编辑器临时文件）不进列表。
            let (target, source) = parse_name(&name)?;
            let meta = entry.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let at_ms = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|gap| gap.as_millis() as i64)
                .unwrap_or(0);
            Some(BackupFile {
                name,
                target,
                source,
                at_ms,
                bytes: meta.len(),
            })
        })
        .collect();
    /* 时间相同就按文件名兜底排序：Windows 的 mtime 精度足够粗，
    同一秒写入的多份备份否则每次列出来的顺序都不一样。 */
    out.sort_by(|a, b| b.at_ms.cmp(&a.at_ms).then_with(|| a.name.cmp(&b.name)));
    out
}

/// 备份文件的**完整路径**（`md_backup_open` 用）。
///
/// 名字来自前端，按不可信输入处理：拒绝 `..`、`/`、`\` 与空串。这条路径最终交给
/// 系统默认程序去**打开**，`join` 一旦被 `..` 带出备份目录，后果就不是「读错文件」
/// 而是「打开任意文件」——所以这里比 `read_in` 更严（连 `..` 出现在中间也拒）。
pub fn path_of(name: &str) -> Result<PathBuf, String> {
    if name.trim().is_empty()
        || name.contains("..")
        || name.contains('/')
        || name.contains('\\')
    {
        return Err("备份文件名不合法".into());
    }
    let root = backup_root().ok_or_else(|| "备份目录还没准备好".to_string())?;
    Ok(root.join(name))
}

pub(crate) fn read_in(root: &Path, name: &str) -> Result<Vec<u8>, String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("备份文件名不合法".into());
    }
    fs::read(root.join(name)).map_err(|err| format!("读不到这份备份：{err}"))
}

/// 去掉末尾 `-yyyyMMdd-HHmmss`，还原来源文件名。
fn source_of(body: &str) -> Option<String> {
    let cut = body.len().checked_sub(TIMESTAMP_LEN)?;
    /* 不能直接 `split_at`：文件名里有中文（`sanitize` 保留 `is_alphanumeric`），
    切点落在多字节字符中间会 panic。 */
    if !body.is_char_boundary(cut) {
        return None;
    }
    let (head, tail) = body.split_at(cut);
    if head.is_empty() || !is_timestamp(tail) {
        return None;
    }
    Some(format!("{head}.md"))
}

fn is_timestamp(raw: &str) -> bool {
    let bytes = raw.as_bytes();
    bytes.len() == TIMESTAMP_LEN
        && bytes[0] == b'-'
        && bytes[9] == b'-'
        && bytes.iter().enumerate().all(|(index, byte)| {
            index == 0 || index == 9 || byte.is_ascii_digit()
        })
}
