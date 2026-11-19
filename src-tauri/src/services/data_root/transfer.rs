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

use super::activity_copy;
use super::entries::layout_entries;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::infra::activity::storage_paths::{ACTIVITY_DATA_REL, SQLITE_DB_FILE_NAME};
use crate::models::data_root::USER_TABLES;

/* 六项清单与体积住在 `entries` 里（拆出去的理由见那个模块头）：活动数据那一项的
**源**路径是运行期派生的——T05 迁移 fail-open 回旧布局时它在 `patina/data`，
写成编译期常量就会让「搬盘」静默漏掉整个活动历史。这里重导出，调用点不变。 */
pub use super::entries::{entries, total_bytes};

/// 核对失败时留在目标目录里的说明文件名（用户可自己删）。
pub const INCOMPLETE_FILE: &str = "MIGRATION-INCOMPLETE.txt";

/// 预检 / 复制 / 核对的失败一律 `IO_ERROR` + **原文**（设计 §9-5）。
///
/// 不用 `AppError::io`：「系统调用失败: 」这个前缀会把真正的信息挤到后面，而预检失败的
/// 原因（「这个文件夹里已有文件」）是用户唯一的行动依据，前端要原文透出。
pub(crate) fn io_fail(message: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::IoError, message.into())
}

/// 复制六项到目标。目标目录由调用方保证「空或不存在」。
pub async fn copy_all(pool: &SqlitePool, source: &Path, dest: &Path) -> AppResult<()> {
    fs::create_dir_all(dest)
        .map_err(|err| io_fail(format!("建不了目标目录 {}：{err}", dest.display())))?;
    /* 库先走 VACUUM INTO（不碰 -wal / -shm，见模块头）。 */
    copy_db(pool, &dest.join("timing.db")).await?;
    /* 清单按**源根的实际布局**派生：Legacy 时活动数据在 `patina/data`，目标仍写
    `activity/data`（新根永远是新布局）。 */
    for entry in layout_entries(source) {
        let from = source.join(entry.path);
        if entry.path == "timing.db" || !from.exists() {
            continue;
        }
        let to = dest.join(entry.dest_path);
        let copied = match entry.activity_source_db {
            /* 活动库是**活的**（分析窗开着、池开着）：只能 `VACUUM INTO`，见 `activity_copy`。
            源库名与目标库名可能不同（T05 迁移时 `patina.db` → `activity.db`）。

            这里搬的是 `activity_layout::source_spec_in` 按**纯文件系统**口径选出的那一份，
            **不是** `data_layout()` 判据认可的那一份（`fs_only_layout_in` 的文档写了为什么：
            `quick_check` 要 `block_on`，在异步命令里会 panic）。所以「搬一个判据不认可的库」
            是**故意**的——搬盘的职责是「用户的数据在哪个文件里，就把那个文件搬到新根去」，
            判据不认可只影响「应用读谁」，不影响「哪个文件里有数据」。真要连判据一起搬，
            得先把完整性检测挪进 `spawn_blocking`，那是另一件事。 */
            Some(source_db) => activity_copy::copy_activity_dir(&from, &to, source_db).await,
            None if entry.is_dir => copy_tree(&from, &to),
            None => fs::copy(&from, &to).map_err(|err| format!("{err}")),
        };
        copied.map_err(|err| io_fail(format!("复制 {} 失败：{err}", entry.label)))?;
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
    /* 活动库那份副本同样得核，但只查**副本自身**（不与源库比行数：用户此刻可能正在记
    一条新的，比出不一致就是假报警）。损坏的副本一样落进 `write_incomplete` 那条路。
    目标侧恒为新布局（`ACTIVITY_DATA_REL` + 新库名），与源是哪种布局无关。 */
    activity_copy::verify_copy(&dest.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME))
        .await
        .map_err(io_fail)?;
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

/// 逐文件递归复制（目录不存在就建）。返回复制的字节数。
///
/// `pub(super)`：`activity_copy` 要用它搬活动库目录里除库文件之外的条目（`diagnostics/`）。
pub(super) fn copy_tree(source: &Path, dest: &Path) -> Result<u64, String> {
    fs::create_dir_all(dest).map_err(|err| format!("建不了 {}：{err}", dest.display()))?;
    let items =
        fs::read_dir(source).map_err(|err| format!("读不了 {}：{err}", source.display()))?;
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
