//! 备份归属标识（设计 §2.4 / §3.4）。
//!
//! 全局状态（`ROOT` / `ROOTS` 都是 `OnceLock`）在这里是个坑：一个进程只认第一份。
//! 所以除了「注册表真的记得住、真按最长前缀取」那一条，其余全部走吃目录参数的
//! `save_to` / `list_in` / `read_in`，各测各的临时目录，互不污染。

use std::fs;
use std::path::{Path, PathBuf};

use crate::infra::md_backup::{self, BackupFile, KEEP};
use crate::infra::md_backup_store::{list_in, read_in};

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|gap| gap.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!(
        "timing-md-backup-target-{tag}-{}-{nanos}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("建临时目录");
    dir
}

fn names_in(dir: &Path) -> Vec<String> {
    fs::read_dir(dir)
        .expect("读备份目录")
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect()
}

#[test]
fn new_backup_names_carry_the_tag() {
    let backups = temp_dir("tag");
    let source = backups.join("md").join("2026-11-06.md");
    md_backup::save_to(&backups, &source, "# 日记\n\n手写内容");

    let names = names_in(&backups);
    assert_eq!(names.len(), 1);
    assert!(
        names[0].starts_with("obsidian__2026-11-06-"),
        "未注册的落点要回 obsidian，且文件名里能看出归属: {names:?}"
    );
    let _ = fs::remove_dir_all(&backups);
}

#[test]
fn longest_registered_prefix_decides_the_tag() {
    let base = temp_dir("prefix");
    let md = base.join("md");
    /* 故意让两条注册互相嵌套：`md` 在 `base` 里面，只有按「更深的赢」才能分对。
    这两条路径每次运行都唯一，不会干扰别的用例。 */
    md_backup::register_root(base.clone(), "obsidian");
    md_backup::register_root(md.clone(), "webdav");

    assert_eq!(
        md_backup::tag_of(&md.join("2026-11-06.md")),
        "webdav",
        "最长前缀赢"
    );
    assert_eq!(
        md_backup::tag_of(&base.join("other").join("2026-11-06.md")),
        "obsidian",
        "只落在较短那条前缀下"
    );
    assert_eq!(
        md_backup::tag_of(Path::new("C:\\vault\\2026-11-06.md")),
        "obsidian",
        "未注册路径一律回 obsidian（现存写入路径除云端两轮以外都是 Obsidian）"
    );
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn old_backups_stay_labelled_unknown() {
    assert_eq!(
        md_backup::parse_name("2026-11-06-20261106-093000.md"),
        Some((None, "2026-11-06.md".to_string())),
        "老备份按设计 §2.4「整体按老格式处理」→ target = None"
    );
    assert_eq!(
        md_backup::parse_name("webdav__2026-11-06-20261106-093000.md"),
        Some((Some("webdav"), "2026-11-06.md".to_string()))
    );
    assert_eq!(
        md_backup::parse_name("readme.md"),
        None,
        "不是备份的名字（没有时间戳后缀）必须能被跳过"
    );

    let dir = temp_dir("old");
    fs::write(dir.join("2026-11-06-20261106-093000.md"), "# 老").expect("写样本");
    let listed: Vec<BackupFile> = list_in(&dir);
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].target, None, "列表里标「归属未知」");
    assert_eq!(listed[0].source, "2026-11-06.md");
    let _ = fs::remove_dir_all(&dir);
}

/// QA 的复现路径（任务书 §4.4-1）：升级前的**老备份（无 `__` 前缀）不删、不改名**。
///
/// 关键在数量：必须真的跨过 `KEEP` 才会进删除分支。上一版这条用例铺了 29 老 + 1 新 =
/// 恰好 30，`files.len() <= KEEP` 直接 return，删除分支从没执行过——它看起来像证据，
/// 实际上什么都没验。
#[test]
fn prune_never_deletes_old_style_backups() {
    let backups = temp_dir("prune");
    /* ① 用户升级前留下的 30 份老格式备份。 */
    let mut old: Vec<String> = Vec::new();
    for day in 1..=30 {
        let name = format!("2026-01-{day:02}-20260101-000000.md");
        fs::write(backups.join(&name), "老").expect("写老格式样本");
        old.push(name);
    }
    /* ② 升级后本版写的 35 份（带 `obsidian__` 前缀）。每份之间隔 3ms：淘汰顺序按 mtime，
    同一毫秒内谁先谁后没有意义，用例不能靠运气。 */
    let mut tagged: Vec<String> = Vec::new();
    for index in 0..35 {
        let name = format!("obsidian__sample-{index:02}-20260201-000000.md");
        fs::write(backups.join(&name), "新").expect("写新格式样本");
        tagged.push(name);
        std::thread::sleep(std::time::Duration::from_millis(3));
    }
    /* ③ 再真实 save 一次 → 触发 prune（36 份带前缀 > KEEP）。 */
    md_backup::save_to(&backups, Path::new("2026-11-06.md"), "新内容");

    let names = names_in(&backups);
    /* ① 无前缀老文件一个都没少。 */
    for name in &old {
        assert!(names.contains(name), "升级前的老备份不许被 prune 删掉：{name}");
    }
    let untagged = names.iter().filter(|name| !name.contains("__")).count();
    assert_eq!(untagged, old.len(), "老格式备份既不计数也不淘汰，实际剩 {untagged}");

    /* ② 带前缀的淘汰到 KEEP 份（含刚写的那一份）。 */
    let tagged_total = names.iter().filter(|name| name.contains("__")).count();
    assert_eq!(
        tagged_total, KEEP,
        "带前缀的备份必须淘汰到上限 {KEEP} 份，实际 {tagged_total}"
    );
    let kept: Vec<&String> = tagged.iter().filter(|name| names.contains(name)).collect();
    assert_eq!(
        kept.len(),
        KEEP - 1,
        "35 份旧的里留下 {} 份（另一份是刚 save 的）",
        KEEP - 1
    );

    /* ③ 删掉的正是带前缀里最旧的那几份（不是老格式，也不是刚写的那份）。 */
    let deleted: Vec<&String> = tagged.iter().filter(|name| !names.contains(name)).collect();
    assert_eq!(
        deleted.len(),
        tagged.len() + 1 - KEEP,
        "35 份旧 + 1 份刚写的 = 36，超出的部分才该被删"
    );
    assert_eq!(
        deleted.first().copied(),
        tagged.first(),
        "按修改时间淘汰：最旧的那份必须先走"
    );
    let _ = fs::remove_dir_all(&backups);
}

#[test]
fn read_refuses_names_that_escape_the_backup_dir() {
    let dir = temp_dir("read");
    let name = "obsidian__2026-11-06-20261106-093000.md";
    fs::write(dir.join(name), "# 备份").expect("写样本");

    assert_eq!(
        read_in(&dir, name).expect("正常名字应可读"),
        "# 备份".as_bytes()
    );
    assert!(read_in(&dir, "../timing.db").is_err(), "不许跳出备份目录");
    assert!(read_in(&dir, "sub/x.md").is_err(), "不许带分隔符");
    assert!(read_in(&dir, "..").is_err());
    assert!(read_in(&dir, "").is_err());
    let _ = fs::remove_dir_all(&dir);
}
