//! 移动端镜像层：Android 的 SAF 目录不能直接交给 `std::fs`。
//!
//! 手机上用户选中的 Obsidian vault 是一个 `content://.../tree/...` 的持久 URI，Rust 侧
//! 的读写全是 `Path`，两者不同构。这里的做法不是把合并逻辑重写一遍，而是把当天要同步的
//! **几个文件**（`{date}.md` 一般只有一个或三个）由原生侧复制进沙箱镜像目录，Rust 在真实
//! 路径上照常跑 [`super::sync_all`]，跑完原生侧再把有变化的文件写回 SAF。
//!
//! 之所以只搬当天文件而不是整个 vault：每个落点只对应一个文件（`root/file` 的 `file`
//! 模板），搬整个目录既慢，也会让 Obsidian 的同步盘看见一堆无谓的 mtime 变化。
//!
//! 这一层只做两件事：算出「要镜像哪些文件」、在镜像目录上跑一轮。

/* 桌面构建里这一层没有调用方（桌面的落点就是真实路径，不需要镜像）。
在模块内允许 dead_code，比在 `mod` 声明处加属性省一行——`mod.rs` 已贴着 300 行门禁。 */
#![cfg_attr(desktop, allow(dead_code))]

use chrono::Local;
use sqlx::SqlitePool;

use super::{config, sync_all};
use crate::error::AppResult;
use crate::infra::md_file;
use crate::models::md_sync::{MdSyncKind, MdSyncReport};

/// 今天每个「参与同步的落点」对应的相对文件路径（已展开 `{date}` 等 token），去重保序。
///
/// 判据故意不看 `root`：手机上用户从未填过根目录，那一栏是空的。真正的前置条件是
/// 文件模板与标题行——没有它们谈不上落点。三个落点常常指向同一个 `2026-11-06.md`
/// 的不同标题区块，所以要去重：镜像一次就够，多了只是重复 IO。
pub async fn mirror_paths(pool: &SqlitePool) -> AppResult<Vec<String>> {
    let config = config::load(pool).await?;
    let date = Local::now().date_naive();
    let mut out: Vec<String> = Vec::new();
    for binding in &config.bindings {
        if !binding.enabled {
            continue;
        }
        if binding.file.trim().is_empty() || binding.heading.trim().is_empty() {
            continue;
        }
        let rel = md_file::expand_tokens(binding.file.trim(), date);
        if !rel.is_empty() && !out.contains(&rel) {
            out.push(rel);
        }
    }
    Ok(out)
}

/// 某个种类今天对应的相对路径；该种类未启用时返回 `None`。
pub async fn path_of(pool: &SqlitePool, kind: MdSyncKind) -> AppResult<Option<String>> {
    let config = config::load(pool).await?;
    let date = Local::now().date_naive();
    Ok(config
        .bindings
        .iter()
        .find(|binding| binding.kind == kind && binding.enabled && !binding.file.trim().is_empty())
        .map(|binding| md_file::expand_tokens(binding.file.trim(), date)))
}

/// 在镜像目录上跑一轮同步（读文件侧改动 → 导入 → 渲染 → 写回镜像）。
pub async fn run_in(pool: &SqlitePool, root: &str) -> AppResult<MdSyncReport> {
    sync_all(pool, Some(root)).await
}
