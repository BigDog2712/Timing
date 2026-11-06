//! 托盘「Markdown 同步」（V0.11.7）：一次点击跑一轮**双向**同步 + 可见反馈。
//!
//! 从 `app/tray.rs` 拆出来（单文件 ≤300 行，ADR-017）：那边是「菜单装配 + 菜单项派发」，
//! 这里是「点完之后做的事」，两者改动的理由不同，混在一起已经越过门禁。
//!
//! 反馈口径与命令层 `commands/md_sync_cmd.rs::announce` 一致：只在真的导入了数据时广播
//! `mdSyncChanged`（空转发会让所有窗口白刷一遍）。

use std::sync::atomic::{AtomicBool, Ordering};

use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use crate::app::events;
use crate::infra::notify;
use crate::models::md_sync::MdSyncReport;
use crate::services;
use crate::state::AppState;

/// 进程内防重入闸。
///
/// 原生菜单没有「忙碌」态可表达（重建菜单只能改 `enabled`，而那会连带把整个菜单闪一下），
/// 所以连点靠这里挡：一轮同步正在跑时，后续点击**不再起新的一轮**（不是排队，也不并发写文件），
/// 但会收到一条「还在进行中」的通知——`log_warn` 对点菜单的人是不可见的，
/// 只写日志等于又一次「点了没反应」。
static RUNNING: AtomicBool = AtomicBool::new(false);

/// 「还在进行中」这句提示本轮是否已经弹过。
///
/// 连点 5 次只该看到 **1 条**「进行中」，不是 4 条：一轮同步开始时复位，
/// 命中闸的第一个后续点击弹一次，其后的全部静默（只留日志）。
/// 用「本轮弹过没」而不是时间戳节流：不依赖时钟，也不会因为机器卡顿而多弹。
static BUSY_NOTICE_SHOWN: AtomicBool = AtomicBool::new(false);

/// 闸的 RAII 持有者：**作用域结束就复位**，不靠「记得在最后一行写 `store(false)`」。
///
/// 原先复位写在 async 块的最后一行，有两个真实漏洞：
/// 1. `run_once` panic → 那一行不执行 → 此后每次点击都命中闸，永久静默失效；
/// 2. 更常见的是**挂起**：同步落点通常配在 OneDrive / 网络盘上，IO 卡住时这一轮永不返回，
///    `store(false)` 永不执行 —— 用户看到的就是「托盘菜单点了完全没反应」，且没有任何线索。
///
/// `Drop` 在正常返回、`?` 早退、unwind 三种路径上都会跑到，这才是复位该在的位置。
struct Gate;

impl Drop for Gate {
    fn drop(&mut self) {
        RUNNING.store(false, Ordering::SeqCst);
    }
}

/// 托盘「Markdown 同步」入口：抢闸 → 异步跑一轮。
pub(crate) fn spawn(app: &AppHandle) {
    /* `swap` 是原子的「读 + 置位」，比 `load` 再 `store` 少一个竞态窗口。 */
    if RUNNING.swap(true, Ordering::SeqCst) {
        crate::log_warn!("tray md sync ignored: previous run still in flight");
        notify_busy_once(app);
        return;
    }
    /* 本轮开始：允许下一条「进行中」提示再弹一次。 */
    BUSY_NOTICE_SHOWN.store(false, Ordering::SeqCst);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        /* 抢到闸之后立刻持有：后面 `?` 早退 / panic / 正常结束都由 `Drop` 复位。 */
        let _gate = Gate;
        let pool = app.state::<AppState>().pool.clone();
        run_once(&app, &pool).await;
    });
}

/// 命中闸时的可见反馈（本轮只弹一次）。
fn notify_busy_once(app: &AppHandle) {
    if BUSY_NOTICE_SHOWN.swap(true, Ordering::SeqCst) {
        return;
    }
    notify_or_log(app, "Markdown 同步", "上一次同步还在进行中，请稍候");
}

/// 真正的一轮同步 + 三种可见反馈（未启用 / 失败 / 完成）。
async fn run_once(app: &AppHandle, pool: &SqlitePool) {
    /* 判据直接用服务层读配置的那套（`md_sync::config::load`，与设置页 / 轮询任务同源），
    不在这里另造一份「是否启用」的状态或缓存。 */
    match services::md_sync::config::load(pool).await {
        Ok(config) if !config.enabled => {
            /* 出厂默认是关的。关了还静默跑一遍空同步，用户看到的是「点了没反应」，
            分不清是没生效还是没变化——所以明确告诉他去哪儿开。 */
            notify_or_log(app, "Markdown 同步", "先在设置里打开 Markdown 同步");
            return;
        }
        Ok(_) => {}
        Err(err) => {
            crate::log_warn!("tray md sync load config failed: {err}");
            notify_or_log(app, "Markdown 同步失败", &err.to_string());
            return;
        }
    }

    match services::md_sync::run(pool).await {
        Ok(report) => {
            /* `run` 只在**整体**不可执行时返回 Err；单个落点失败落在 `report.errors` 里。
            有错误就按失败告知（部分成功也不该说「完成」），其余计数照旧可用。 */
            if report.errors.is_empty() {
                notify_or_log(app, "Markdown 同步完成", &sync_body(&report));
            } else {
                let detail = report.errors.join("；");
                crate::log_warn!("tray md sync finished with errors: {detail}");
                notify_or_log(app, "Markdown 同步失败", &detail);
            }
            if report.touched() {
                events::emit_md_sync_changed(app, &report);
            }
        }
        Err(err) => {
            crate::log_warn!("tray md sync failed: {err}");
            notify_or_log(app, "Markdown 同步失败", &err.to_string());
        }
    }
}

/// 发一条系统通知；**被拦掉要留证据**。
///
/// `infra::notify::notify` 返回 `bool`（专注助手 / 系统权限拒绝时是 `false`）。托盘同步的
/// 反馈**全部**只有通知这一个出口——尤其「未启用」那条，丢了返回值就等于整条链无声消失，
/// 用户和排查的人都拿不到任何线索。所以每个调用点都走这里，失败至少落一条日志。
fn notify_or_log(app: &AppHandle, title: &str, body: &str) {
    if !notify::notify(app, title, body) {
        crate::log_warn!("tray md sync notify suppressed: {title}");
    }
}

/// 完成通知正文：只报 `MdSyncReport` 现成的两个计数，不另造口径。
///
/// 「无变更也通知」是刻意的：点一下托盘菜单什么都没弹，用户无法区分
/// 「没执行」和「执行了但没有差异」，连点两次就更分不清了。
fn sync_body(report: &MdSyncReport) -> String {
    if report.imported == 0 && report.exported == 0 {
        return "没有需要同步的变更".to_string();
    }
    /* 说「导出 N 处」而不是「N 个文件」：`exported` 数的是**写文件的落点数**，
    两个落点可以指向同一个文件的不同标题（`MdSyncBinding::key()` 含 heading），
    按「文件」报会多报。 */
    format!("导入 {} 条 · 导出 {} 处", report.imported, report.exported)
}

#[cfg(test)]
mod tests {
    use super::sync_body;
    use crate::models::md_sync::{MdSyncKind, MdSyncReport};

    /// 「导出」的单位是**处**（落点数），不是文件数：两个落点可以写同一个文件的两个标题。
    #[test]
    fn sync_body_counts_exported_places_not_files() {
        let mut report = MdSyncReport::new(0);
        report.exported = 2;
        assert_eq!(sync_body(&report), "导入 0 条 · 导出 2 处");
    }

    /// 导入条数与导出处数各自独立，不能把 `exported` 说成导入。
    #[test]
    fn sync_body_reports_both_counters() {
        let mut report = MdSyncReport::new(0);
        report.note_imported(MdSyncKind::Timers, 3);
        report.exported = 1;
        assert_eq!(sync_body(&report), "导入 3 条 · 导出 1 处");
    }

    /// 什么都没变也不能静默：点一下菜单毫无反馈，用户分不清「没执行」和「执行了没差异」。
    #[test]
    fn sync_body_states_no_changes_instead_of_silence() {
        let report = MdSyncReport::new(0);
        assert_eq!(sync_body(&report), "没有需要同步的变更");
    }
}
