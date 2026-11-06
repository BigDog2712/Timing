//! 桌面数据目录迁移：把旧 identifier 目录里的全部数据搬到当前 identifier 目录。
//!
//! 依据 `docs/rename-v0.5.0/PRD.md` §4 与 `ARCHITECTURE.md` §1.3。三条设计约束：
//!
//! 1. **headless**：本模块只依赖 `std` / `sqlx` / `chrono` / `dirs`（仅桌面），
//!    **不依赖 services 层、也不依赖 tauri**（L4 的门禁词不在此复述，避免自我命中），
//!    因此可以用两个临时目录直接跑测试；
//! 2. **路径注入**：`run_at(&Paths, skip)` 不读 identifier、不读环境变量、不读
//!    `app_data_dir()`——identifier 还没换（阶段一）也能把 M-01..M-13 全测通；
//! 3. **无日志**：跑在 `platform::log::init` 之前（那时还没有日志文件）。结果缓存在
//!    本模块，`app::bootstrap` 在 `log::init` 之后按 `outcome()` 补记（§6.3 六条文案）。
//!
//! 编排顺序固定：`cleanup_temp → decide → copy → verify → swap → write_marker`。

pub mod copy;
pub mod decide;
pub mod marker;
pub mod paths;
pub mod verify;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use crate::models::migration::RowCounts;

pub use decide::Decision;
pub use marker::{MigrationMarker, PendingMigrate};
pub use paths::Paths;

/// 迁移的六种结局。
#[derive(Debug, Clone)]
pub enum MigrationOutcome {
    /// 全新用户：旧目录不存在，或存在但没有旧数据
    NoLegacy,
    /// 本次跳过（`TIMING_SKIP_MIGRATE=1`，或 debug 构建未设 `TIMING_FORCE_MIGRATE=1`）
    Skipped,
    /// 迁移成功
    Migrated(Migrated),
    /// 目标已有库且本版本已迁移过（M-02）；参数是目标目录
    AlreadyPresent(PathBuf),
    /// 目标已有库、旧目录还有数据但没被采用（M-05）；参数是旧目录
    TargetOccupied(PathBuf),
    /// 迁移失败；`preboot` 负责弹窗三选一
    Failed(Failure),
}

/// 成功迁移的事实（写标记文件 + 补记日志都用它）。
#[derive(Debug, Clone)]
pub struct Migrated {
    /// 完成时间（本地时区，`2026-11-04T15:20:31+08:00`）
    pub at: String,
    /// 源目录
    pub source: PathBuf,
    /// 库文件字节数
    pub db_bytes: u64,
    /// 五表行数
    pub row_counts: RowCounts,
    /// 是否连 `-wal` 一起搬了（M-08）
    pub wal_copied: bool,
}

/// 失败事实。
#[derive(Debug, Clone)]
pub struct Failure {
    /// 失败发生的阶段
    pub stage: Stage,
    /// 一句话原因（直接进用户看到的对话框与 `migration-failed.txt`）
    pub reason: String,
}

/// 失败阶段（决定用户读到的那句话提示的是「拷贝不动」还是「校验不过」）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stage {
    /// 清理上次残留的临时目录
    CleanTemp,
    /// 整树复制
    Copy,
    /// 四重校验
    Verify,
    /// 换名（临时目录 → 目标目录 / 目标目录 → 备份）
    Swap,
    /// 写标记文件（**不致命**：数据已就位，只降级为告警 + 失败明细）
    Marker,
}

impl Stage {
    /// 落盘与日志用的字符串值。
    pub const fn as_str(self) -> &'static str {
        match self {
            Stage::CleanTemp => "CleanTemp",
            Stage::Copy => "Copy",
            Stage::Verify => "Verify",
            Stage::Swap => "Swap",
            Stage::Marker => "Marker",
        }
    }
}

/// 唯一可测入口：不读环境变量、不读 identifier、不碰 Tauri。
pub fn run_at(paths: &Paths, skip: bool) -> MigrationOutcome {
    if skip {
        return MigrationOutcome::Skipped;
    }
    cleanup_temp(paths);
    let facts = decide::inspect(paths);
    match decide::decide(&facts) {
        /* 目标 == 源（阶段一的正常状态）：什么都不做，尤其**不能**把自己的目录改名备份。 */
        Decision::SameDir => MigrationOutcome::NoLegacy,
        Decision::NoLegacy => {
            /* 旧目录已经被用户删了：待迁移标记失去意义，顺手清掉，避免设置页
            永远显示「旧数据待迁移」。 */
            if facts.has_pending {
                marker::clear_pending(&paths.target);
            }
            MigrationOutcome::NoLegacy
        }
        Decision::AlreadyPresent => MigrationOutcome::AlreadyPresent(paths.target.clone()),
        Decision::Occupied => MigrationOutcome::TargetOccupied(paths.source.clone()),
        Decision::Go | Decision::Overwrite => migrate(paths),
    }
}

/// 生产入口：`run_at` + 结果缓存（`preboot` 重试时会覆盖缓存）。
pub fn run_once(paths: &Paths, skip: bool) -> MigrationOutcome {
    let outcome = run_at(paths, skip);
    let _ = PATHS.set(paths.clone());
    if let Ok(mut guard) = OUTCOME.lock() {
        *guard = Some(outcome.clone());
    }
    outcome
}

/// 最近一次迁移结果（供 `app::bootstrap` 与命令层读取）。
pub fn outcome() -> Option<MigrationOutcome> {
    OUTCOME.lock().ok().and_then(|guard| guard.clone())
}

/// 迁移用过的路径（供 `bootstrap` 与权威 `app_data_dir` 做一致性自检）。
pub fn paths_used() -> Option<Paths> {
    PATHS.get().cloned()
}

/// 本次进程是否清理过上次残留的临时目录（M-07，日志用）。
pub fn cleaned_leftover_temp() -> bool {
    CLEANED.load(Ordering::Relaxed)
}

/// 清理残留的临时目录（上次迁移被强杀留下的半成品）。返回是否真的清理了。
pub fn cleanup_temp(paths: &Paths) -> bool {
    let temp = &paths.temp;
    let removed = if temp.is_dir() {
        std::fs::remove_dir_all(temp).is_ok()
    } else if temp.exists() {
        /* 极端情况：同名文件占位（磁盘异常 / 用户手建）。删掉才能建目录。 */
        std::fs::remove_file(temp).is_ok()
    } else {
        false
    };
    if removed {
        CLEANED.store(true, Ordering::Relaxed);
    }
    removed
}

/// 读迁移成功标记（命令层与诊断用）。
pub fn read_marker(app_data_dir: &Path) -> Option<MigrationMarker> {
    marker::read_marker(app_data_dir)
}

/// 读待迁移标记（命令层用）。
pub fn read_pending(app_data_dir: &Path) -> Option<PendingMigrate> {
    marker::read_pending(app_data_dir)
}

/// 旧品牌数据目录（**与当前数据根无关**，恒为 `%APPDATA%\com.tickbar.app`）。
///
/// [V0.11.6] 展示 / 命令层用这个；`paths::legacy_dir_of()` 留给迁移执行期（那时数据根
/// 还没决定，只能从权威 `app_data_dir` 反推）。两者共存的理由见 `paths.rs` 的注释。
///
/// 注意：模块级**不再转发** `legacy_dir_of`。ADR-050 §2 把三处调用点
/// （`bootstrap` / `diagnostics` / `migration_cmd`）全部换成了本函数，转发层于是没有
/// 任何调用方——留着它就是 `-D warnings` 下的死码（`appdata_migrate` 不是 pub 模块，
/// 未使用的 pub fn 一样会被 dead_code 抓到）。`paths::legacy_dir_of` 仍在（本函数的
/// 实现依赖它，且迁移执行期的口径必须留着），只是不再对外转发。
pub fn legacy_dir() -> Option<PathBuf> {
    paths::legacy_dir()
}

/// 旧目录里是否有旧数据（命令层判定 `unattached` 用）。
pub fn has_legacy_data(dir: &Path) -> bool {
    decide::has_legacy_data(dir)
}

/// 真正的搬运：复制 → 校验 → 换名 → 标记。
fn migrate(paths: &Paths) -> MigrationOutcome {
    /* 编排第一步（`cleanup_temp`）的兜底。`run_at` 已经尝试删过一次；若残留仍在，
    就**不能**往下走：`copy::copy_tree` 对目标目录只 `create_dir_all`、不清空，
    残留文件会原封不动混进新目录 —— 而 `verify` 的逐文件字节比对查不出这种「多」，
    它只校验「源里有的、新目录里也有且一样大」（见 `verify::compare_dir`），
    于是上一次被强杀的半成品就会被当成「迁移成功」交付给用户。
    宁可判失败让用户重试，也不要交付一个混着两次复制的目录。 */
    if paths.temp.exists() {
        return fail(
            paths,
            Stage::CleanTemp,
            format!("清理残留临时目录失败：{}", paths.temp.display()),
        );
    }

    /* 数据根目录必须已存在（Windows 上即 `%APPDATA%`，正常环境必然有）。
    显式判它而不是让 `copy_tree` 在深一层报「读源目录失败」：缺失说明启动环境本身
    异常，这里报出来的路径才是用户能拿去求助的那一个。 */
    if !paths.base.is_dir() {
        return fail(
            paths,
            Stage::Copy,
            format!("数据根目录不存在：{}", paths.base.display()),
        );
    }

    let stats = match copy::copy_tree(&paths.source, &paths.temp) {
        Ok(stats) => stats,
        Err(reason) => return fail(paths, Stage::Copy, reason),
    };

    let row_counts = match verify::verify(&paths.temp, &paths.source) {
        Ok(counts) => counts,
        Err(reason) => return fail(paths, Stage::Verify, reason),
    };

    /* 覆盖式迁移 / 目标只是个空目录：先把现有目标改名备份（保留，不删），
    再把新结果换上去。改名失败就到此为止，目标仍在原位。 */
    let aside = paths.target.exists();
    if aside {
        if let Err(reason) = copy::rename_aside(&paths.target, &paths.backup) {
            return fail(paths, Stage::Swap, reason);
        }
    }
    if let Err(err) = std::fs::rename(&paths.temp, &paths.target) {
        /* 已经把目标改名挪走了 → 必须挪回来，否则用户会看到一个「空的新目录」。
        这一步做不成才是真正的数据风险，所以两条原因都要报出来。 */
        let restore = if aside {
            match std::fs::rename(&paths.backup, &paths.target) {
                Ok(()) => "已回滚（原目录已还原）".to_string(),
                Err(back) => format!(
                    "回滚也失败（原目录仍在 {}）：{back}",
                    paths.backup.display()
                ),
            }
        } else {
            "无需回滚".to_string()
        };
        return fail(paths, Stage::Swap, format!("换名失败：{err}；{restore}"));
    }

    let migrated = Migrated {
        at: chrono::Local::now().to_rfc3339(),
        source: paths.source.clone(),
        db_bytes: stats.db_bytes,
        row_counts,
        wal_copied: stats.wal_copied,
    };
    /* 标记写不进去**不判失败**：数据已经搬好了。判失败只会让用户在「数据明明在」
    的情况下看到失败框，而重试立刻命中 `AlreadyPresent`——比不报更糟。
    降级为：往旧目录追加一段 `migration-failed.txt` + 由 bootstrap 补记 WARN。 */
    if let Err(reason) = marker::write_marker(&paths.target, &migrated) {
        let failure = Failure {
            stage: Stage::Marker,
            reason,
        };
        let _ = marker::write_failure(&paths.source, &failure, paths);
    }
    marker::clear_pending(&paths.target);
    MigrationOutcome::Migrated(migrated)
}

/// 统一失败收尾：清临时目录（不留半成品）后返回 `Failed`。
fn fail(paths: &Paths, stage: Stage, reason: String) -> MigrationOutcome {
    cleanup_temp(paths);
    MigrationOutcome::Failed(Failure { stage, reason })
}

static OUTCOME: Mutex<Option<MigrationOutcome>> = Mutex::new(None);
static PATHS: OnceLock<Paths> = OnceLock::new();
static CLEANED: AtomicBool = AtomicBool::new(false);
