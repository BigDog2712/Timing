//! 备份存档的**格式契约**：常量 + 判定。
//!
//! ## 为什么值得单独一个文件
//!
//! 这里每一个字符串都已经写进用户**本地与 WebDAV 上已有的每一份**备份 zip 的
//! `manifest.json` 里。改动任何一个 ⇒ 存量备份报 `"snapshot manifest is not supported"`
//! 或 `"unexpected file set"` —— zip 还在、大小正常、sha256 也对，就是打不开。
//! 代码可以回滚，已经同步到远端的备份不会自己回来，所以这是整个改造里**唯一**
//! 「上线后无法热修复」的一类损失。
//!
//! 收敛成具名常量（而不是散在写入 / 读取两处的字面量）是本批的主要产物。最典型的是
//! `SNAPSHOT_PRODUCT`：原先写入侧写 `product: "Patina".to_string()`、读取侧比
//! `manifest.product != "Patina"`，是**两个各自硬编码**的字面量 —— 一次全局替换会把
//! 两侧同时改掉，编译通过、现有用例全绿（它们只做新格式往返），而存量备份全废。
//! 现在它是同一处真源，「一处改动被撕成两半」在构造上就不可能发生。
//!
//! ## 换格式的正确形状（留给 T05）
//!
//! **读旧写新**：写入侧换成新值，读取侧把旧值加进允许集合。
//! `supported_database_entries()` 之所以返回集合而不是写一个相等判断，就是因为
//! `DATABASE_ENTRY` 是**查表键**（zip 条目名 + `checksums.files` 的 key），不是单纯谓词：
//! 加兼容是「往集合里加一项」，不是「再加一个 `||`」。
//!
//! 注意这里的兼容不能靠常量自身保留旧值 —— 那会让写入侧继续写旧值。三条路径
//! （`DATABASE_ENTRY` / `SNAPSHOT_FORMAT` / `SNAPSHOT_PRODUCT`）都必须走「写入侧用新常量、
//! 读取侧接受新旧集合」。

use super::{read_metadata_entry, SnapshotChecksums, SnapshotManifest};
use std::collections::BTreeSet;
use std::fs::File;
use std::io::{Read, Seek};
use std::path::Path;
use zip::read::ZipArchive;

/// 存档的整体格式标记（`manifest.format`）。
pub(crate) const SNAPSHOT_FORMAT: &str = "PatinaSQLiteSnapshot-1";
/// 存档内 manifest 的条目名。
pub(crate) const MANIFEST_ENTRY: &str = "manifest.json";
/// 存档内 checksums 的条目名。
pub(crate) const CHECKSUMS_ENTRY: &str = "checksums.json";
/// 存档内数据库的条目名。**同时是 checksums 的查表键**，见上面「读旧写新」。
pub(crate) const DATABASE_ENTRY: &str = "database/patina.db";
/// `manifest.product` 字段。
pub(crate) const SNAPSHOT_PRODUCT: &str = "Patina";
/// `checksums.algorithm` 字段。
pub(crate) const CHECKSUM_ALGORITHM: &str = "sha256";
/// `manifest.restore.strategies`，**有序**：manifest 里写的顺序也算契约的一部分。
pub(crate) const SUPPORTED_RESTORE_STRATEGIES: [&str; 2] = ["replace", "merge"];

/// 读取侧允许的库条目名集合（今天是单元素，见文件头「读旧写新」）。
pub(crate) fn supported_database_entries() -> BTreeSet<String> {
    BTreeSet::from([DATABASE_ENTRY.to_string()])
}

/// 备份 manifest 的格式契约。
///
/// 集中在一处，是因为这里每一条都写进了用户已有的备份文件：下次加恢复策略、换摘要
/// 算法、或者动条目名，同一个坑会换个形式再来一遍。散在解析流程里就等于让人去猜
/// 「还有哪几条算契约」。
pub(crate) fn supported_manifest(
    manifest: &SnapshotManifest,
    checksums: &SnapshotChecksums,
) -> bool {
    manifest.format == SNAPSHOT_FORMAT
        && manifest.product == SNAPSHOT_PRODUCT
        && supported_database_entries().contains(&manifest.database.path)
        && checksums.algorithm == CHECKSUM_ALGORITHM
        && manifest
            .restore
            .strategies
            .iter()
            .map(String::as_str)
            .eq(SUPPORTED_RESTORE_STRATEGIES.iter().copied())
}

/// 这个文件是不是「本应用的快照存档」——`prepared_source` 用它筛备份列表。
///
/// 只嗅探 `manifest.format`：返回 `Ok(false)` 而不是报错，调用方就把它当成
/// 「这不是快照」直接跳过。所以 `SNAPSHOT_FORMAT` 一旦与存量存档不符，表现是
/// **备份列表里那批文件凭空消失**，零报错零日志，用户只能靠「数量对不上」发现。
pub(crate) fn is_snapshot_archive(path: &Path) -> Result<bool, String> {
    let mut file = File::open(path)
        .map_err(|error| format!("failed to open backup file `{}`: {error}", path.display()))?;
    let mut magic = [0_u8; 2];
    if file.read_exact(&mut magic).is_err() || magic != *b"PK" {
        return Ok(false);
    }
    file.rewind()
        .map_err(|error| format!("failed to inspect backup file: {error}"))?;
    let mut archive = ZipArchive::new(file).map_err(|error| {
        format!(
            "failed to open backup archive `{}`: {error}",
            path.display()
        )
    })?;
    let manifest_bytes = match read_metadata_entry(&mut archive, MANIFEST_ENTRY) {
        Ok(bytes) => bytes,
        Err(_) => return Ok(false),
    };
    let value: serde_json::Value = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| format!("failed to parse backup manifest: {error}"))?;
    Ok(value.get("format").and_then(|value| value.as_str()) == Some(SNAPSHOT_FORMAT))
}
