//! 数据根搬迁的「碰磁盘」那一半（V0.11.15，设计 §3.4 / §3.5 / §3.6）。
//!
//! 只做四件事：算清单与体积、复制、核对、核对失败时在目标目录留一份说明。
//! 「该不该搬、搬之前问什么」在 `mod.rs`（那边是判据与顺序）。
//!
//! ## 为什么库用 `VACUUM INTO` 而不是拷 `timing.db` + `-wal` + `-shm`
//!
//! 库在 WAL 模式下，主文件与 `-wal` 是两个时刻的快照，直接拷得到一份**可能撕裂**的
//! 库；而只拷主文件会丢掉 `-wal` 里尚未 checkpoint 的数据。`VACUUM INTO` 由 SQLite
//! 自己在一个读事务里生成一致副本，且产物是单文件、无 WAL。
//!
//! 参数形式（`VACUUM INTO ?1`）由 `tests/data_root_transfer.rs` 第一条用例钉死——
//! 它是唯一能证明「这行代码真的产出文件」的证据。若哪天 sqlx 不肯为它绑定参数，
//! 退路是字面量 + 单引号转义（见 `copy_db` 的注释）。

use std::fs;
use std::path::{Component, Path, PathBuf};

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

use crate::error::{AppError, AppResult, ErrorCode};
use crate::infra::appdata_migrate::marker::MARKER_FILE;
use crate::models::data_root::{DataRootEntry, USER_TABLES};

/// 五项清单（顺序固定，与 PRD 4.2 / 设计 §3.6 一致）。
///
/// `is_dir = true` 的项在目标里 `create_dir_all` 后逐文件复制；源不存在 → 跳过且
/// `present: false`（**不造空目录**）。
const ENTRIES: [(&str, bool); 5] = [
    ("timing.db", false),
    ("backups", true),
    ("logs", true),
    ("md", true),
    (MARKER_FILE, false),
];

/// 核对失败时留在目标目录里的说明文件名（用户可自己删）。
pub const INCOMPLETE_FILE: &str = "MIGRATION-INCOMPLETE.txt";

/// 预检 / 复制 / 核对的失败一律 `IO_ERROR` + **原文**（设计 §9-5）。
///
/// 不用 `AppError::io`：「系统调用失败: 」这个前缀会把真正的信息挤到后面，而预检失败的
/// 原因（「这个文件夹里已有文件」）是用户唯一的行动依据，前端要原文透出。
pub(crate) fn io_fail(message: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::IoError, message.into())
}

/// 五项清单的当前状态（给确认对话框用）。
pub fn entries(root: &Path) -> Vec<DataRootEntry> {
    ENTRIES
        .iter()
        .map(|(name, is_dir)| {
            let path = root.join(name);
            let present = if *is_dir { path.is_dir() } else { path.is_file() };
            DataRootEntry {
                name: (*name).to_string(),
                is_dir: *is_dir,
                present,
                bytes: if present { measure(&path) } else { 0 },
            }
        })
        .collect()
}

/// 五项体积之和（递归求和，不设上限——这是应用自己的数据根）。
pub fn total_bytes(root: &Path) -> u64 {
    entries(root).iter().map(|entry| entry.bytes).sum()
}

/// 复制五项到目标。目标目录由调用方保证「空或不存在」。
pub async fn copy_all(pool: &SqlitePool, source: &Path, dest: &Path) -> AppResult<()> {
    fs::create_dir_all(dest)
        .map_err(|err| io_fail(format!("建不了目标目录 {}：{err}", dest.display())))?;
    /* 库先走 VACUUM INTO（不碰 -wal / -shm，见模块头）。 */
    copy_db(pool, &dest.join("timing.db")).await?;
    for (name, is_dir) in ENTRIES {
        let from = source.join(name);
        if name == "timing.db" || !from.exists() {
            continue;
        }
        let to = dest.join(name);
        let copied = if is_dir {
            copy_tree(&from, &to)
        } else {
            fs::copy(&from, &to).map_err(|err| format!("{err}"))
        };
        copied.map_err(|err| io_fail(format!("复制 {name} 失败：{err}")))?;
    }
    Ok(())
}

/// 核对：打开副本，五张表行数与源库逐表一致。任何一表不一致 → `Err`，点名哪张表差多少。
pub async fn verify(pool: &SqlitePool, dest: &Path) -> AppResult<()> {
    let copy_path = dest.join("timing.db");
    /* 只读单连接：核对不该有机会改副本，也不该在目标目录里留下 `-wal`。 */
    let options = SqliteConnectOptions::new()
        .filename(&copy_path)
        .read_only(true);
    let copy = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|err| io_fail(format!("打开副本库失败：{err}")))?;
    let source_counts = counts_of(pool).await?;
    let copy_counts = counts_of(&copy).await?;
    copy.close().await;
    for ((table, source_rows), (_, copy_rows)) in source_counts.iter().zip(copy_counts.iter()) {
        if source_rows != copy_rows {
            return Err(io_fail(format!(
                "核对没通过：{table}：源 {source_rows} / 副本 {copy_rows}。\
                 这份数据没搬完，目标目录里留了 {INCOMPLETE_FILE}，可以直接删掉重试。"
            )));
        }
    }
    Ok(())
}

/// 核对失败时在目标目录写一份「这份没搬完」的说明（设计 §3.3 ④）。
pub fn write_incomplete(dest: &Path, why: &str) {
    let body = format!(
        "这份数据没有搬完，Timing 没有切换过来（数据根仍是原来的位置）。\n\
         原因：{why}\n\n\
         这个目录里的文件是复制过程中的半成品，可以直接删除。\n\
         原来的数据目录没有被改动。\n"
    );
    if let Err(err) = fs::write(dest.join(INCOMPLETE_FILE), body) {
        crate::log_error!("data root: 写 {INCOMPLETE_FILE} 失败：{err}");
    }
}

/// `VACUUM INTO` 到 `dest`。目标文件必须**不存在**（SQLite 对已存在的输出文件直接报错）。
async fn copy_db(pool: &SqlitePool, dest: &Path) -> AppResult<()> {
    let target = dest.to_string_lossy().into_owned();
    /* 参数形式已由单测钉死（`tests/data_root_transfer.rs::vacuum_into_with_parameter`）。
    池是 `max_connections(1)`，`execute` 会排队等当前操作，不会与写事务并发；
    `VACUUM` 也不能在事务里跑，sqlx 的自动提交正好合适。 */
    sqlx::query("VACUUM INTO ?1")
        .bind(target)
        .execute(pool)
        .await
        .map_err(|err| io_fail(format!("生成副本库失败：{err}")))?;
    if !dest.is_file() {
        return Err(io_fail(format!(
            "生成副本库失败：{} 没有出现",
            dest.display()
        )));
    }
    Ok(())
}

/// 五张表各多少行。表名来自本项目常量，不拼用户输入。
async fn counts_of(pool: &SqlitePool) -> AppResult<Vec<(String, i64)>> {
    let mut out: Vec<(String, i64)> = Vec::with_capacity(USER_TABLES.len());
    for table in USER_TABLES {
        let sql = format!("SELECT COUNT(*) FROM {table}");
        let rows: i64 = sqlx::query_scalar(&sql)
            .fetch_one(pool)
            .await
            .map_err(|err| io_fail(format!("读 {table} 的行数失败：{err}")))?;
        out.push((table.to_string(), rows));
    }
    Ok(out)
}

/// 递归体积（文件取 `len`，目录递归求和）。
fn measure(path: &Path) -> u64 {
    let Ok(meta) = fs::metadata(path) else { return 0 };
    if meta.is_file() {
        return meta.len();
    }
    let Ok(items) = fs::read_dir(path) else {
        return 0;
    };
    items.flatten().map(|item| measure(&item.path())).sum()
}

/// 逐文件递归复制（目录不存在就建）。返回复制的字节数。
fn copy_tree(source: &Path, dest: &Path) -> Result<u64, String> {
    fs::create_dir_all(dest).map_err(|err| format!("建不了 {}：{err}", dest.display()))?;
    let items = fs::read_dir(source).map_err(|err| format!("读不了 {}：{err}", source.display()))?;
    let mut total = 0u64;
    for item in items.flatten() {
        let from = item.path();
        let to = dest.join(item.file_name());
        if from.is_dir() {
            total += copy_tree(&from, &to)?;
        } else {
            total += fs::copy(&from, &to).map_err(|err| format!("{}：{err}", from.display()))?;
        }
    }
    Ok(total)
}

/// 规范化目标路径：能 `canonicalize` 就规范化；不存在则规范化**父级** + 末段
/// （保留用户起的名字——先建目录再改名是用户不可能理解的顺序）。
pub(crate) fn normalize_target(raw: &str) -> AppResult<PathBuf> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err(io_fail("请先选一个目录"));
    }
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err(io_fail(format!("请填绝对路径：{raw}")));
    }
    if let Ok(canonical) = path.canonicalize() {
        return Ok(tidy(&canonical));
    }
    let name = path
        .file_name()
        .ok_or_else(|| io_fail(format!("这个路径指向不了目录：{raw}")))?;
    let parent = path
        .parent()
        .ok_or_else(|| io_fail(format!("这个路径没有上级目录：{raw}")))?;
    let parent = parent
        .canonicalize()
        .map_err(|err| io_fail(format!("上级目录不可用（{}）：{err}", parent.display())))?;
    Ok(tidy(&parent).join(name))
}

/// 去掉 Windows 的 `\\?\` verbatim 前缀与多余的 `.` / `..`。
///
/// 为什么不直接用 `canonicalize` 的结果：它在本平台返回 `\\?\D:\TimingData` 这种
/// extended-length 形式，而这个路径会被写进指针、拼进 `%APP_DIR%\md`、显示在设置页与
/// 日志里。`\\?\` 会让它和 `app_dir::data_root()`（普通盘符形态）**永远不相等**，
/// `is_default` 与「指针是否生效」两处判据都会静默失效。只做前缀还原，不跟随符号链接。
pub(crate) fn tidy(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    let stripped = match text.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
        _ => path.to_path_buf(),
    };
    let mut out = PathBuf::new();
    for component in stripped.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    if out.as_os_str().is_empty() {
        stripped
    } else {
        out
    }
}

/// 已存在的祖先目录（`GetDiskFreeSpaceExW` 要一个真实存在的路径）。
pub(crate) fn existing_ancestor(target: &Path) -> PathBuf {
    let mut probe = target.to_path_buf();
    while !probe.exists() {
        if !probe.pop() {
            break;
        }
    }
    probe
}

/// 空目录判据：不存在 → 允许（会被建）；存在则必须一个条目都没有。
pub(crate) fn is_empty_dir(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }
    std::fs::read_dir(path)
        .map(|mut items| items.next().is_none())
        .unwrap_or(false)
}
