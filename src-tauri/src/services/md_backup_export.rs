//! 备份导出（[V0.11.23]）：把一份备份**交给用户**，而不是交给系统打开。
//!
//! ## 为什么不放在 `commands/mobile_cmd.rs`
//!
//! 那个文件是 `#[cfg(mobile)]`，桌面目标的用例够不着——判据就只能靠人看。这是
//! v0.11.21（`plan_of`）与 v0.11.22（`mobile_rounds`）连着踩过两次的同一条教训，
//! 这里是第三次复现，所以直接按结论写：**名字校验与路径解析在 services，命令层只转发**。
//!
//! ## 四道闸
//!
//! 1. 名字：空串 / `..` / `/` / `\` 一律不认（`path_of` 同口径，导出比「打开」更不能错）；
//! 2. 形态：`parse_name` 不认的名字（`readme.md`、时间戳不合形）不是备份，不导；
//! 3. 落点：`join` 之后 `canonicalize`，**必须仍在备份根之内**——符号链接与大小写差异
//!    都可能把路径带出去，而这条路径的用途是「把那个文件的字节写给用户」；
//! 4. 存在：备份只保 30 份，用户点的那条可能刚被挤掉，给一句能照做的原话。

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult, ErrorCode};
use crate::infra::md_backup::backup_root;
use crate::infra::md_backup_store as store;

/// 生效的命令入口：拿到「要读的那个文件」与「建议的导出文件名」。
///
/// 失败一律 `IO_ERROR` + 原文：名字不合法 / 备份已不在 / 目录读不到是三种完全不同的
/// 行动指令，不能被润色成同一句「导出失败」。
///
/// 桌面目标里没有调用者：真实现挂在 `commands::mobile_cmd`（`#[cfg(mobile)]`），
/// 桌面上那条命令是 `mobile_only` 桩。`desktop` 下放行死码，是为了不留一条为了
/// 消警告而存在的假调用——`infra::md_backup_store` 的先例同此。
#[cfg_attr(desktop, allow(dead_code))]
pub fn source(name: &str) -> AppResult<(PathBuf, String)> {
    let root = backup_root().ok_or_else(|| {
        AppError::new(ErrorCode::IoError, "备份目录还没准备好，等首次同步写盘之后再试")
    })?;
    resolve_in(root, name).map_err(|err| AppError::new(ErrorCode::IoError, err))
}

/// 纯函数（单测入口）：备份根 + 名字 → `(绝对路径, 建议的导出文件名)`。
///
/// 不碰全局 `ROOT`：`OnceLock` 一个进程只认第一份，用例只能在自造的临时目录上验。
pub(crate) fn resolve_in(root: &Path, name: &str) -> Result<(PathBuf, String), String> {
    let name = name.trim();
    if name.is_empty() || name.contains("..") || name.contains('/') || name.contains('\\') {
        return Err("备份文件名不合法".into());
    }
    let (target, _source) = store::parse_name(name)
        .ok_or_else(|| format!("「{name}」不是 Timing 的备份文件名，无法导出"))?;

    let real_root = fs::canonicalize(root).map_err(|err| format!("备份目录读不到：{err}"))?;
    let real = fs::canonicalize(root.join(name)).map_err(|_| {
        format!("这份备份已经不在了（备份只保留最近 30 份）：{name}")
    })?;
    if !real.starts_with(&real_root) {
        return Err(format!("「{name}」的路径跑到备份目录外面了，已拒绝导出"));
    }
    if !real.is_file() {
        return Err(format!("「{name}」不是一个文件，无法导出"));
    }
    Ok((real, export_name(name, target)))
}

/// 建议的导出文件名：去掉落点前缀。
///
/// `webdav__2026-11-06-20261108-120000.md` → `2026-11-06-20261108-120000.md`。
/// 前缀是程序内部口径（哪条通路留的底），用户要认的是「哪一天、哪一刻」；导出的是**副本**，
/// 备份根里那份一字不动，所以去掉前缀不影响任何恢复路径。
///
/// 只在 `parse_name` 认出了标识时才切：`a__b.md` 这种用户自己的文件名不该被误剪。
pub(crate) fn export_name(name: &str, target: Option<&str>) -> String {
    match (target, name.split_once("__")) {
        (Some(_), Some((_, right))) if !right.is_empty() => right.to_string(),
        _ => name.to_string(),
    }
}
