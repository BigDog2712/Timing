//! 数据根（`%APP_DIR%`）的落点信息与切换（V0.11.15，PRD 4.2 / 设计 §3.3）。
//!
//! ## 判据优先级：指针 > optout > `<exe>\data` 探测
//!
//! 用户主动设的自定义根必须优先于「程序自动回退」，否则他设了也永远不生效。启动期的
//! 落点链在 `app::data_root_boot`（本模块只在命令层被调用，不参与启动）。
//!
//! ## 撤销的收敛规则（连点「改回旧位置」最终回到默认根）
//!
//! | 指针状态 | 动作 |
//! |---|---|
//! | 无指针 | 幂等：什么都不做 |
//! | `previous` 为空或 `== <exe>\data` | `clear()` → 下次启动回到默认根 |
//! | `previous` 是另一个自定义根 | 指针改写成 `{dataDir: previous, previous: <exe>\data}` |
//!
//! 第三条的取舍：用户「选错了目录」时想回的是**上一个能用的位置**，直接回默认等于把
//! 他之前那次正常切换也一起撤销了（设计 §9-6）。于是每点一次退一级，最终收敛到默认。
//!
//! ## 五项清单与「旧目录不删」
//!
//! 切换只**复制**、不删除源。确认文案必须写清这一点（PRD 4.2）：用户重启确认没问题
//! 之后自己删，比程序替他删安全一个数量级。

pub mod transfer;

use std::path::{Path, PathBuf};

use sqlx::SqlitePool;

use crate::error::AppResult;
use crate::infra::{disk_space, portable_probe, root_pointer, shell_open};
use crate::models::data_root::DataRootInfo;
use crate::platform::app_dir;
use crate::services::md_sync;

/// 剩余空间的安全系数：目标盘至少要装得下「体积 × 1.2」。
const FREE_SPACE_RATIO: f64 = 1.2;

/// 有无指针时的路由结论（**纯函数**，单测入口）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PointerChoice {
    /// 用指针里的目录（**忽略 optout**：用户主动设的根优先于自动回退）
    UsePointer,
    /// 走原流程（optout → 探测 → 迁移）
    Default,
}

/// 启动期该听谁的。`optout_exists` 只有「没有指针」时才参与判定——这正是「指针优先」
/// 的落点，也是唯一能用纯函数钉住它的地方（`app/portable_boot.rs` 那条链一跑就写
/// `app_dir::set()`，`OnceLock` 不可清除，测试碰不得）。
pub fn decide(pointer: Option<&root_pointer::RootPointer>, optout_exists: bool) -> PointerChoice {
    let _ = optout_exists;
    match pointer {
        Some(_) => PointerChoice::UsePointer,
        None => PointerChoice::Default,
    }
}

/// 数据根的完整快照（`data_root_get` 的返回）。
pub async fn info(pool: &SqlitePool, identifier: &str) -> AppResult<DataRootInfo> {
    let current = app_dir::data_root();
    let default_path = default_data_dir();
    let pointer = match appdata_dir(identifier) {
        Ok(dir) => root_pointer::read(&dir),
        /* 拿不到 `%APPDATA%` 只是「读不到指针」，不该让整个页签打不开：`info` 是只读的
        查询，用户还能看到当前数据根。切换动作才要求 appdata 必须可解析。 */
        Err(_) => None,
    };
    let (writable, writable_error) = match portable_probe::probe(&current) {
        Ok(()) => (true, None),
        Err(reason) => (false, Some(reason)),
    };
    let pending = pointer
        .as_ref()
        .map(|pointer| pointer.data_dir.clone())
        .filter(|dir| transfer::tidy(Path::new(dir)) != transfer::tidy(&current));
    Ok(DataRootInfo {
        is_default: transfer::tidy(&current) == transfer::tidy(&default_path),
        writable,
        writable_error,
        pending,
        previous: pointer.and_then(|pointer| pointer.previous),
        size_bytes: transfer::total_bytes(&current),
        entries: transfer::entries(&current),
        affected: affected_kinds(pool).await?,
        plugins_in_data_root: app_dir::plugins_root().parent().map(Path::to_path_buf)
            == Some(transfer::tidy(&current)),
        default_path: default_path.display().to_string(),
        current: current.display().to_string(),
    })
}

/// 切换（`path = Some`）或撤销（`path = None`）。返回刷新后的 info。
///
/// **`None` = 撤销**，不是「没传参」（设计 §8-4）：前端 `change(undefined)` 与
/// `change(null)` 走同一条路（`ipc.ts` 里 `?? null`）。
pub async fn change(
    pool: &SqlitePool,
    identifier: &str,
    path: Option<&str>,
) -> AppResult<DataRootInfo> {
    let current = app_dir::data_root();
    let appdata = appdata_dir(identifier)?;
    match path {
        None => revert(&appdata)?,
        Some(raw) => switch(pool, &appdata, &current, raw).await?,
    }
    info(pool, identifier).await
}

/// 在资源管理器里打开当前数据根（**不创建**目录：不存在就老实报错）。
pub fn open() -> AppResult<()> {
    let root = app_dir::data_root();
    shell_open::open_dir(&root).map_err(transfer::io_fail)
}

/// 预检 + 复制 + 核对 + 写指针（设计 §3.3 的 ①②③④⑤，②在前端）。
///
/// `pub(crate)`：单测要传**临时** appdata 目录进来。走 `change(..)` 的话 `appdata` 由
/// identifier 算出来 = 真 `%APPDATA%`，一个测试会去改用户的真实配置。
pub(crate) async fn switch(
    pool: &SqlitePool,
    appdata: &Path,
    current: &Path,
    raw: &str,
) -> AppResult<()> {
    let target = transfer::normalize_target(raw)?;
    preflight(&target, current)?;
    transfer::copy_all(pool, current, &target).await?;
    /* 核对失败：**不写指针**，并在目标目录留一份说明（用户可自己删）。 */
    if let Err(err) = transfer::verify(pool, &target).await {
        transfer::write_incomplete(&target, &err.message);
        return Err(err);
    }
    root_pointer::write(
        appdata,
        &target.display().to_string(),
        Some(&current.display().to_string()),
    )
    .map_err(transfer::io_fail)
}

/// 四类拒绝 + 空间。**任何一项不过就返回 `Err`，一个字都不复制。**
pub(crate) fn preflight(target: &Path, current: &Path) -> AppResult<()> {
    if target == current {
        return Err(transfer::io_fail("已经在用这个目录"));
    }
    if target.starts_with(current) || current.starts_with(target) {
        return Err(transfer::io_fail(
            "不能选当前数据目录里面的文件夹（或它的上级）",
        ));
    }
    if target.exists() && !transfer::is_empty_dir(target) {
        return Err(transfer::io_fail(
            "这个文件夹里已有文件，请选一个空文件夹或新建一个",
        ));
    }
    /* 可写性判据 = 建目录 + 写 16B + **回读比对** + 删（不看 readonly 位，ADR-050 §3）。
    它顺带把目标目录建出来——所以必须排在「非空」之后。 */
    if let Err(reason) = portable_probe::probe(target) {
        return Err(transfer::io_fail(format!("不可写：{reason}")));
    }
    if let Some(free) = disk_space::free_bytes(&transfer::existing_ancestor(target)) {
        let need = (transfer::total_bytes(current) as f64 * FREE_SPACE_RATIO) as u64;
        if free < need {
            return Err(transfer::io_fail(format!(
                "目标盘只剩 {} MB，这份数据要 {} MB",
                free / (1024 * 1024),
                need / (1024 * 1024)
            )));
        }
    }
    Ok(())
}

/// 撤销待生效的切换（设计 §3.3 那张表，收敛规则见模块头）。
fn revert(appdata: &Path) -> AppResult<()> {
    let Some(pointer) = root_pointer::read(appdata) else {
        /* 没有指针 = 本来就在默认流程上，幂等返回。 */
        return Ok(());
    };
    let default_path = default_data_dir();
    let previous = pointer
        .previous
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(PathBuf::from);
    match previous {
        /* 上一个位置就是出厂默认：删指针即「下次启动回到默认根」。 */
        Some(previous) if transfer::tidy(&previous) != transfer::tidy(&default_path) => {
            let back = previous.display().to_string();
            let fallback = default_path.display().to_string();
            root_pointer::write(appdata, &back, Some(&fallback)).map_err(transfer::io_fail)
        }
        _ => root_pointer::clear(appdata).map_err(transfer::io_fail),
    }
}

/// 受 `%APP_DIR%` 影响的落点**种类名**（写死绝对路径的落点不受影响，不列出）。
async fn affected_kinds(pool: &SqlitePool) -> AppResult<Vec<String>> {
    let config = md_sync::config::load(pool).await?;
    let mut out: Vec<String> = Vec::new();
    for binding in config.bindings {
        if !binding.root.trim().starts_with(app_dir::TOKEN) {
            continue;
        }
        let label = binding.kind.label().to_string();
        if !out.contains(&label) {
            out.push(label);
        }
    }
    Ok(out)
}

/// 出厂 / 默认数据根 = `<exe>\data`。**只用于展示「默认值是什么」**，不许拿它当
/// 「当前生效值」——当前值是 `app_dir::data_root()`（设计 §8-7）。
fn default_data_dir() -> PathBuf {
    app_dir::exe_dir()
        .map(|dir| dir.join("data"))
        .unwrap_or_else(app_dir::fallback_appdata)
}

/// `%APPDATA%\<identifier>`；拿不到时按「读不到数据根设置」处理。
fn appdata_dir(identifier: &str) -> AppResult<PathBuf> {
    app_dir::appdata_dir(identifier).ok_or_else(|| {
        transfer::io_fail("拿不到 %APPDATA%，读不到数据根设置（指针文件就存在那里）")
    })
}
