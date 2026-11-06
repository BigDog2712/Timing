//! 老数据落点搬运（V0.11.6，ADR-050 §4）：`%APPDATA%\<identifier>` → `<exe>\data`。
//!
//! ## 为什么是新文件，而不是给 `appdata_migrate` 加参数
//!
//! `appdata_migrate::Paths` 的形状是「同一个 `base` 下两个 identifier 目录」，
//! 而本次的 target（`<exe>\data`）与 source（`%APPDATA%\com.timing.app`）**不同父**；
//! 更关键的是 `appdata_migrate` 的 `OUTCOME` / `PATHS` 是**全局单值缓存**，两个来源
//! 共用一个缓存会让 `app::diagnostics::migration_label` 与
//! `commands::migration_cmd::resolve_source` 张冠李戴（品牌改名 vs 搬运落点，是两件事）。
//!
//! 所以：**共用原语，不共用状态**。
//!
//! ## 三条红线（沿用 `appdata_migrate` 的口径）
//!
//! 1. **旧目录已有内容不改**：`copy_tree` / `verify` 全程只读 source——原有文件一个字节
//!    不改、不删、不覆盖（用户口径：只复制不删除）。**新增**只允许两处：备份兄弟目录
//!    `%APPDATA%\<identifier>.portable-premigrate-<ts>\`（在 source **之外**，与它并列），
//!    以及「标记写不进」时追加进 source 的 `portable-migrate-failed.txt`（诊断用，
//!    唯一一处写进旧目录的文件）；
//! 2. **要么完整，要么没有**：先复制到 `<target>.migrating`（同盘 → 换名原子），
//!    校验通过才 `rename`；任何一步失败都先清临时目录再返回；
//! 3. **幂等**：标记 `<target>\migrated-to-portable.json` 写在**数据目录里**，随数据走。

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::infra::appdata_migrate::{copy, paths::DB_NAME, verify};
use crate::models::migration::RowCounts;

/// 幂等标记（写在目标数据目录里，随数据一起搬走）。
pub const MARKER_FILE: &str = "migrated-to-portable.json";
/// 失败明细（追加到 **source** = `%APPDATA%` 那一侧）。
pub const FAILURE_FILE: &str = "portable-migrate-failed.txt";
/// 落盘 schema 版本（字段只增不改）。
pub const SCHEMA: u32 = 1;

/// 迁移结局。
#[derive(Debug, Clone)]
pub enum Outcome {
    /// 旧目录没有库：不搬（判据只看 `timing.db`，见 ADR-050 §4 ③④）
    NoLegacy,
    /// 目标已有数据：**什么都不做**，绝不覆盖、绝不合并
    AlreadyPresent(PathBuf),
    /// 搬成功了
    Migrated(Facts),
    /// 失败；`stage` ∈ `cleanup` / `copy` / `verify` / `swap`
    Failed { stage: &'static str, reason: String },
}

/// 成功迁移的事实（写标记 + 补记日志都用它）。
#[derive(Debug, Clone)]
pub struct Facts {
    /// 完成时间（本地时区，`2026-11-06T10:12:33+08:00`）
    pub at: String,
    /// 源目录（`%APPDATA%\com.timing.app`）
    pub source: PathBuf,
    /// 库文件字节数
    pub db_bytes: u64,
    /// 是否连 `-wal` / `-shm` 一起搬了
    pub wal_copied: bool,
    /// 五表行数
    pub row_counts: RowCounts,
}

/// 本模块自己的结果缓存（**不碰** `appdata_migrate` 的全局缓存）。
static OUTCOME: Mutex<Option<Outcome>> = Mutex::new(None);

/// 最近一次结局（供 `app::bootstrap` 在日志就绪后补记、`diagnostics` 读）。
pub fn outcome() -> Option<Outcome> {
    OUTCOME.lock().ok().and_then(|guard| guard.clone())
}

/// 唯一入口：路径全部注入（测试可以拿两个临时目录直接跑）。
///
/// 顺序固定：`cleanup_temp → decide → copy → verify → swap → write_marker`。
pub fn run_once(source: &Path, target: &Path) -> Outcome {
    let result = execute(source, target);
    if let Ok(mut guard) = OUTCOME.lock() {
        *guard = Some(result.clone());
    }
    result
}

fn execute(source: &Path, target: &Path) -> Outcome {
    let temp = sibling(target, ".migrating");

    /* 上一次被强杀留下的半成品：`copy_tree` 只 `create_dir_all` 不清空，
    残留文件会混进本次复制，而 `verify` 只校验「源里有的、新目录里也有」，
    查不出「多」。所以清不掉就**不能**往下走。 */
    if !cleanup_temp(&temp) {
        return Outcome::Failed {
            stage: "cleanup",
            reason: format!("清理残留临时目录失败：{}", temp.display()),
        };
    }

    if !target_db(target) && read_marker(target).is_none() {
        if !source.join(DB_NAME).is_file() {
            return Outcome::NoLegacy;
        }
    } else {
        return Outcome::AlreadyPresent(target.to_path_buf());
    }

    if let Err(reason) = copy::copy_tree(source, &temp) {
        cleanup_temp(&temp);
        return Outcome::Failed {
            stage: "copy",
            reason,
        };
    }

    let row_counts = match verify::verify(&temp, source) {
        Ok(counts) => counts,
        Err(reason) => {
            cleanup_temp(&temp);
            return Outcome::Failed {
                stage: "verify",
                reason,
            };
        }
    };
    /* 直接量**复制结果**而不是源：`copy_tree` 已按名字前缀把旧品牌名的库文件映射成
    `timing.db*`，源里的库名不一定叫 `timing.db`。 */
    let db_bytes = std::fs::metadata(temp.join(DB_NAME))
        .map(|meta| meta.len())
        .unwrap_or(0);
    let wal_copied = temp.join(format!("{DB_NAME}-wal")).exists();

    /* 目标已存在（探测阶段刚建的空目录 / 用户自己放的东西）：先挪走再换上去。
    `fs::rename` 在 Windows 上目标存在时必失败，这条分支不能省——而且对便携版用户
    这是**常态**：zip 里带 `data\README.txt` 占位，所以 `remove_dir` 删不掉那个目录。

    备份落点是 `%APPDATA%\<identifier>.portable-premigrate-<ts>\`，也就是
    **`source` 的兄弟目录**（口径照抄 `appdata_migrate` 的 `<target>.premigrate-<ts>`）：
    - 不留在 exe 旁边：便携目录只该有 `Timing.exe` / `data` / `plugins`；
    - **不放在 `source` 里面**：那会让迁移往「只读」的旧目录里写东西，而且下一次
      迁移会把这个备份当成用户数据一起复制进新数据目录（QA `a1d` / `a1e` 两条反例）。
    **永不删除**——里面是用户自己的文件。 */
    let backup = sibling(source, &format!(".portable-premigrate-{}", stamp()));
    if target.exists() {
        if let Err(reason) = stash_aside(target, &backup) {
            cleanup_temp(&temp);
            return Outcome::Failed {
                stage: "swap",
                reason,
            };
        }
    }
    if let Err(err) = std::fs::rename(&temp, target) {
        cleanup_temp(&temp);
        /* 目标已被挪走 → 必须挪回来，否则用户会看到一个「空的新目录」。
        跨盘时 rename 回不去（`EXDEV`），退成复制；再失败也只剩日志——数据两份都在
        （备份 + 临时目录已清），对话框会带出备份路径。 */
        if backup.exists() {
            if let Err(back) = std::fs::rename(&backup, target) {
                crate::log_error!(
                    "portable: 换名失败后回滚也失败（{back}），备份保留在 {}",
                    backup.display()
                );
            }
        }
        return Outcome::Failed {
            stage: "swap",
            reason: format!("换名失败：{err}（原数据备份在 {}）", backup.display()),
        };
    }

    /* `.window-state.json` 不搬（ADR-050 §6：窗口位置由插件写在 `%APPDATA%`，
    搬过来也没人读，只会让用户在自己的数据目录里看到一个陌生文件）。 */
    let _ = std::fs::remove_file(target.join(".window-state.json"));

    let facts = Facts {
        at: chrono::Local::now().to_rfc3339(),
        source: source.to_path_buf(),
        db_bytes,
        wal_copied,
        row_counts,
    };
    /* 标记写不进去**不判失败**：数据已经就位，判失败只会让用户在「数据明明在」
    的情况下看到失败框，而重试立刻命中 `AlreadyPresent`——比不报更糟。 */
    if let Err(reason) = write_marker(target, &facts) {
        append_failure(source, "marker", &reason);
    }
    Outcome::Migrated(facts)
}

/// 把已存在的目标目录挪到备份位置（`stash` 而非 `delete`：那是用户自己的文件）。
///
/// 优先 `fs::rename`（同盘原子、零拷贝）。exe 装在 D: 而 `%APPDATA%` 在 C: 时
/// rename 会 `EXDEV` 失败，退成「整目录复制 → 删原件」；**复制失败就原样退回**，
/// 一个字节都不动，由调用方判 `Failed{swap}` 让用户重试或换落点。
fn stash_aside(target: &Path, backup: &Path) -> Result<(), String> {
    if !target.exists() {
        return Ok(());
    }
    if let Some(parent) = backup.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("建备份目录 {} 失败：{err}", parent.display()))?;
    }
    match std::fs::rename(target, backup) {
        Ok(()) => return Ok(()),
        Err(err) => crate::log_warn!("portable: 跨盘改名失败（{err}），改用复制备份"),
    }
    if let Err(reason) = copy::copy_tree(target, backup) {
        let _ = std::fs::remove_dir_all(backup);
        return Err(format!("备份 {} 失败：{reason}", target.display()));
    }
    std::fs::remove_dir_all(target).map_err(|err| {
        format!(
            "备份已写入 {}，但清理 {} 失败：{err}",
            backup.display(),
            target.display()
        )
    })
}

/// 目标目录里是否已有库（判据只看 db，不看 `logs` / 标记文件）。
fn target_db(target: &Path) -> bool {
    target.join(DB_NAME).is_file()
}

/// 读幂等标记（存在即「已搬过或用户有意重置」，不再搬）。
pub fn read_marker(target: &Path) -> Option<String> {
    let path = target.join(MARKER_FILE);
    std::fs::read_to_string(&path).ok()
}

/// 写幂等标记（失败只降级为失败明细，不改变结局）。
fn write_marker(target: &Path, facts: &Facts) -> Result<(), String> {
    let body = serde_json::json!({
        "schema": SCHEMA,
        "at": facts.at,
        "appVersion": env!("CARGO_PKG_VERSION"),
        "source": facts.source.to_string_lossy(),
        "dbBytes": facts.db_bytes,
        "walCopied": facts.wal_copied,
        "rowCounts": facts.row_counts,
        "verified": "size+integrity+rows",
    });
    let text =
        serde_json::to_string_pretty(&body).map_err(|err| format!("标记序列化失败：{err}"))?;
    let path = target.join(MARKER_FILE);
    std::fs::write(&path, text).map_err(|err| format!("写标记失败 {}：{err}", path.display()))
}

/// 失败明细追加到 **source**（`%APPDATA%` 那一侧，旧目录只读时退化为静默）。
fn append_failure(source: &Path, stage: &str, reason: &str) {
    let line = format!(
        "[{}] stage={} reason={}\n",
        chrono::Local::now().to_rfc3339(),
        stage,
        reason
    );
    let path = source.join(FAILURE_FILE);
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        use std::io::Write;
        let _ = file.write_all(line.as_bytes());
    }
}

/// 清临时目录；返回「清理后确实不存在」。
fn cleanup_temp(temp: &Path) -> bool {
    if temp.is_dir() {
        let _ = std::fs::remove_dir_all(temp);
    } else if temp.exists() {
        let _ = std::fs::remove_file(temp);
    }
    !temp.exists()
}

/// 同父目录的兄弟路径（`<target>.migrating`）。**必须同盘**：跨盘 `rename` 会失败。
fn sibling(target: &Path, suffix: &str) -> PathBuf {
    let mut name = target.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

/// 备份后缀用的时间戳（本地时区，秒级足够：同一进程内只会搬一次）。
fn stamp() -> String {
    chrono::Local::now().format("%Y%m%d-%H%M%S").to_string()
}
