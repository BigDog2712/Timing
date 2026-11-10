//! [V0.11.23] 备份导出的四道闸（PRD P1）。
//!
//! 判据本身在 `services::md_backup_export::resolve_in`，放 `services` 的理由与
//! `mobile_rounds`（v0.11.22）、`plan_of`（v0.11.21）完全一样：`commands::mobile_cmd`
//! 是 `#[cfg(mobile)]`，桌面目标的用例够不着它，那条规则就只能靠人看。
//!
//! ## 为什么另起一个吃目录参数的行
//!
//! `md_backup` 的备份根是 `OnceLock`（一个进程只认第一份），用例没法把它指到临时目录。
//! 所以 `resolve_in(root, name)` 是纯函数，各测各的临时目录。
//!
//! ## 变异自证
//!
//! - 把 `resolve_in` 里的 `!real.is_file()` 那一段删掉（只留 `canonicalize`），
//!   `directory_is_refused` 必红——那正是「把目录当文件递给用户」的那条路；
//! - 把 `export_name` 的 `(Some(_), Some(...))` 分支删掉、一律 `name.to_string()`，
//!   `valid_backup_is_resolved_inside_root` 与 `obsidian_backup_is_exportable` 必红；
//! - `!real.starts_with(&real_root)` 这条闸的变异只在**能建符号链接**的环境里可证
//!   （见 `symlink_out_of_root_is_refused`，Windows 没开开发者模式时会跳过）。
//!   它是纵深防御：`..` 已在第一道闸拦死，这条拦的是链接与大小写归一化。

use std::fs;
use std::path::PathBuf;

use crate::services::md_backup_export::{export_name, resolve_in};

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|gap| gap.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!(
        "timing-md-export-{tag}-{}-{nanos}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("建临时目录");
    dir
}

/// 造一份真的备份文件，返回它的名字。
fn put(dir: &PathBuf, name: &str) {
    fs::write(dir.join(name), "# 2026-11-06\n\n#### 事项计时\n").expect("写备份");
}

#[test]
fn valid_backup_is_resolved_inside_root() {
    let dir = temp_dir("ok");
    put(&dir, "webdav__2026-11-06-20261108-120000.md");

    let (path, export) = resolve_in(&dir, "webdav__2026-11-06-20261108-120000.md")
        .expect("合法备份必须能导出");
    assert!(path.is_file(), "返回的必须是那个真文件");
    assert_eq!(export, "2026-11-06-20261108-120000.md", "导出名去掉落点前缀");
}

/// `obsidian__` 的老底也能导：导出是副本，不需要落点（与「恢复」相反）。
#[test]
fn obsidian_backup_is_exportable() {
    let dir = temp_dir("obsidian");
    put(&dir, "obsidian__2026-11-05-20261108-120000.md");
    let (_, export) = resolve_in(&dir, "obsidian__2026-11-05-20261108-120000.md")
        .expect("导出不看归属");
    assert_eq!(export, "2026-11-05-20261108-120000.md");
}

/// 无前缀的老备份：名字原样带出去，不做推断（那是它的真名）。
#[test]
fn legacy_name_is_kept_as_is() {
    let dir = temp_dir("legacy");
    put(&dir, "2026-11-04-20261101-093000.md");
    let (_, export) = resolve_in(&dir, "2026-11-04-20261101-093000.md").expect("老备份能导出");
    assert_eq!(export, "2026-11-04-20261101-093000.md");
}

/// 路径穿越：`..` / `/` / `\` 三种写法一律拒绝。
#[test]
fn traversal_names_are_refused() {
    let dir = temp_dir("traversal");
    for bad in [
        "../2026-11-06-20261108-120000.md",
        "sub/2026-11-06-20261108-120000.md",
        "sub\\2026-11-06-20261108-120000.md",
        "",
        "   ",
    ] {
        assert!(
            resolve_in(&dir, bad).is_err(),
            "这种名字绝不能被当成备份：{bad:?}"
        );
    }
}

/// 名字形态不对（不是备份）：拒绝，且把名字回显出来。
#[test]
fn non_backup_name_is_refused() {
    let dir = temp_dir("shape");
    put(&dir, "readme.md");
    let err = resolve_in(&dir, "readme.md").expect_err("readme.md 不是备份");
    assert!(err.contains("readme.md"), "拒绝理由要回显名字：{err}");
}

/// 备份刚被 30 份上限挤掉：拒绝，并说清「已经不在了」。
#[test]
fn missing_backup_says_it_is_gone() {
    let dir = temp_dir("gone");
    let err = resolve_in(&dir, "webdav__2026-11-06-20261108-120000.md")
        .expect_err("文件不在时不能返回一个路径");
    assert!(err.contains("不在"), "要让人知道是文件没了：{err}");
    assert!(err.contains("30"), "顺带说清为什么没了：{err}");
}

/// 备份根读不到（还没建 / 被删）→ 拒绝，不许返回一个拼出来的路径。
#[test]
fn broken_root_is_refused() {
    let missing = temp_dir("gone-root").join("no-such-dir");
    assert!(
        resolve_in(&missing, "webdav__2026-11-06-20261108-120000.md").is_err(),
        "根都读不到时不能放行"
    );
}

/// 名字合法、但落在那里的是个**目录**：拒绝。少了这道闸就会把目录当文件递出去。
#[test]
fn directory_is_refused() {
    let dir = temp_dir("dir");
    fs::create_dir_all(dir.join("webdav__2026-11-06-20261108-120000.md")).expect("建同名目录");
    let err = resolve_in(&dir, "webdav__2026-11-06-20261108-120000.md")
        .expect_err("目录不是备份");
    assert!(err.contains("不是一个文件"), "实得：{err}");
}

/// 备份根里的一个**符号链接**指向根外：`canonicalize` 之后必须被拦下。
///
/// Windows 没开开发者模式时建不了符号链接（本项目那台机器就是），此时这条跳过——
/// 跳过要说话，不能假装过了。
#[test]
fn symlink_out_of_root_is_refused() {
    let root = temp_dir("link-root");
    let outside = temp_dir("link-outside");
    let target = outside.join("secret.md");
    fs::write(&target, "不该被导出").expect("写根外文件");
    let link = root.join("webdav__2026-11-06-20261108-120000.md");

    #[cfg(unix)]
    let made = std::os::unix::fs::symlink(&target, &link).is_ok();
    #[cfg(windows)]
    let made = std::os::windows::fs::symlink_file(&target, &link).is_ok();
    if !made {
        println!("跳过：这个环境建不了符号链接（Windows 需要开发者模式）");
        return;
    }
    let err = resolve_in(&root, "webdav__2026-11-06-20261108-120000.md")
        .expect_err("指向根外的链接不能放行");
    assert!(err.contains("外面"), "实得：{err}");
}

/// 导出名只剪「认得出的落点前缀」：用户自己的 `a__b.md` 不许被误剪。
#[test]
fn export_name_respects_unknown_prefix() {
    assert_eq!(export_name("a__b.md", None), "a__b.md");
    assert_eq!(
        export_name("webdav__a__b.md", Some("webdav")),
        "a__b.md",
        "只剪第一个前缀"
    );
}
