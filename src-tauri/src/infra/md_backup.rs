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
//! - 文件名 `<落点标识>__<原文件名>-<yyyyMMdd-HHmmss>.md`，同秒重复写会同名覆盖（可接受：
//!   同一秒内两次写盘的内容差异极小）；
//! - 最多保留 `KEEP` 份，按修改时间淘汰——**只淘汰带落点前缀的自家备份**，升级前的
//!   老文件不计数、不淘汰（V0.11.13 修正，见 `prune`）；
//! - **任何失败都静默**：留底是附加保险，不能因为它写不出来而挡住同步本身。
//!
//! ## 落点标识（V0.11.13 新增）
//!
//! 云端通道上线后会有两个（以后三个）落点写同一批日期的文件，`2026-11-06.md` 在备份
//! 目录里会混成一堆分不清谁是谁。所以文件名前面加一段短标识：`obsidian` / `webdav` /
//! `folder`。用**注册表 + 最长前缀匹配**而不是「写之前设一个当前落点标记」：注册是幂等的，
//! 不存在「某次 panic 没复位 → 之后全标错」的窗口，也不需要 RAII 守卫。
//!
//! `save(source, text)` 的签名与 `md_file::write_section` **都不动**：`write_section` 的
//! 唯一调用方是 `sync_binding`，改签名等于改 `sync_all` 的调用链（本轮红线）。
//! 未注册的落点一律回 `obsidian`——现存写入路径里除云端两轮以外都是 Obsidian 落点。
//!
//! 读侧（`list` / `read` / `parse_name`）在 `infra/md_backup_store.rs`，这里转发。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

/* 转发读侧：对外仍是 `md_backup::{list, read, parse_name}`，调用方不必知道拆过文件。
`allow(unused_imports)` 是必须的——调用点在 T03（`services/md_backup`），在那之前
本 crate 内没有人 import 这四个名字。 */
#[allow(unused_imports)]
pub use crate::infra::md_backup_store::{list, parse_name, read, BackupFile};

/// 备份总数上限。**只数带落点前缀的文件**（见 `prune`）。`pub(crate)` 是为了让
/// 淘汰规则的断言引用同一个数，而不是在测试里抄一个 30。
pub(crate) const KEEP: usize = 30;

static ROOT: OnceLock<PathBuf> = OnceLock::new();

/// 「落点根 → 标识」注册表。两个注册点：`app::bootstrap`（Obsidian 出厂根）与
/// 云端那轮（`services/md_cloud`，跑之前注册）。所以必须能跨线程追加。
static ROOTS: OnceLock<Mutex<Vec<(PathBuf, &'static str)>>> = OnceLock::new();

/// 登记一个落点根。可重复调用（同目录同标识不会产生第二条），后登记覆盖旧标识。
pub fn register_root(dir: PathBuf, tag: &'static str) {
    let tag = match crate::infra::md_backup_store::known_tag(tag) {
        Some(known) => known,
        /* 标识不在口径内就回退：写进文件名的词如果 `parse_name` 不认，
        那份备份在列表里会永远显示「归属未知」，比标错更难发现。 */
        None => {
            crate::log_warn!("md backup 落点标识不在口径内：{tag}（按 obsidian 记）");
            "obsidian"
        }
    };
    let mut roots = match roots().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    roots.retain(|(seen, _)| *seen != dir);
    roots.push((dir, tag));
}

/// `source` 属于哪个落点。最长前缀匹配：`<数据根>\md-webdav` 优先于 `<数据根>\md`。
pub fn tag_of(source: &Path) -> &'static str {
    match roots().lock() {
        Ok(list) => tag_in(&list, source),
        Err(poisoned) => tag_in(&poisoned.into_inner(), source),
    }
}

/// 生效的备份目录（`app::bootstrap` 注入）；未注入时 `save` / `list` 都是 no-op。
pub(crate) fn backup_root() -> Option<&'static Path> {
    ROOT.get().map(PathBuf::as_path)
}

fn roots() -> &'static Mutex<Vec<(PathBuf, &'static str)>> {
    ROOTS.get_or_init(|| Mutex::new(Vec::new()))
}

/// 纯匹配逻辑，单测入口：注册表作为参数传进来，不碰全局状态。
fn tag_in(registered: &[(PathBuf, &'static str)], source: &Path) -> &'static str {
    let mut best: Option<(usize, &'static str)> = None;
    for (dir, tag) in registered {
        /* `Path::starts_with` 按路径分量比较：`...\md-webdav` 不会被当成 `...\md` 的子目录。
        深度用分量数而不是字节长度，嵌套注册时才是「最长前缀」的本意。 */
        if !source.starts_with(dir) {
            continue;
        }
        let depth = dir.components().count();
        if best.is_none_or(|(seen, _)| depth > seen) {
            best = Some((depth, tag));
        }
    }
    best.map_or("obsidian", |(_, tag)| tag)
}

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

/// `pub(crate)`：单测要能在自己造的临时目录上验文件名与淘汰规则，不能碰全局 `ROOT`
/// （`OnceLock` 一个进程只认第一份）。
pub(crate) fn save_to(root: &Path, source: &Path, text: &str) {
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
        "{}__{}-{}.md",
        tag_of(source),
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

/// 超过 `KEEP` 份就按修改时间删最旧的——**淘汰池只算带已知落点前缀的文件**。
///
/// [V0.11.13] 为什么不认名字就删不行：升级到本版之前写下的备份名形如
/// `2026-11-02-20261102-192610.md`，没有 `<tag>__` 前缀。按 mtime 一视同仁地数份数，
/// 用户升级后连写几十次就把**升级前的全部历史现场**删光了——而任务书 §4.4-1 的口径是
/// 「老备份不删、不改名，列表里标归属未知」。
///
/// 新口径的后果是可见的：老文件不计数也不淘汰，所以总数是「最多 KEEP 份新备份 +
/// 历史老备份数」。后者不会增长——新代码只写带前缀的名字，老名字再也不会产生。
fn prune(root: &Path) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    let mut files: Vec<(SystemTime, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            /* `parse_name` 认出前缀（且时间戳成形）才算「本版写的备份」：它同时排除了
            `readme.md`、编辑器临时文件和用户自己带 `__` 的命名。 */
            let name = entry.file_name().to_string_lossy().to_string();
            if !is_managed(&name) {
                return None;
            }
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

/// 「这份备份是本版写的」：名字解析得出落点标识。老格式（无前缀）返回 `false`，
/// 于是**不计数、不淘汰**。
fn is_managed(name: &str) -> bool {
    matches!(
        crate::infra::md_backup_store::parse_name(name),
        Some((Some(_), _))
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("timing-md-backup-{tag}"));
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
            name.starts_with("obsidian__2026-10-20-"),
            "文件名要同时看出落点与源文件: {name}"
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
    fn keeps_only_the_newest_managed_files() {
        let root = temp_dir("prune");
        fs::create_dir_all(&root).expect("建临时目录");
        for index in 0..(KEEP + 5) {
            /* 名字必须是本版写的形状（`<tag>__<stem>-<时间戳>.md`）：老格式按 V0.11.13
            的口径不计数、不淘汰，铺老名字会让这条用例永远空转。 */
            let name = format!("obsidian__old-{index:03}-20260101-000000.md");
            fs::write(root.join(name), "x").expect("写样本");
        }
        save_to(&root, Path::new("y.md"), "新内容");

        let count = fs::read_dir(&root).expect("读目录").flatten().count();
        assert_eq!(count, KEEP, "带前缀的备份超过 {KEEP} 份时要淘汰到上限，实际 {count}");
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
