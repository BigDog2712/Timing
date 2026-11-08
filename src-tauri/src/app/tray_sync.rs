//! 托盘「Markdown 同步」（V0.11.7）：一次点击跑一轮**双向**同步 + 可见反馈。
//!
//! 从 `app/tray.rs` 拆出来（单文件 ≤300 行，ADR-017）：那边是「菜单装配 + 菜单项派发」，
//! 这里是「点完之后做的事」，两者改动的理由不同，混在一起已经越过门禁。
//!
//! [V0.11.26] 标签三态与 `blocked_notice` 迁去 `app/tray_label.rs`（那边 294 行贴门禁）；
//! 完成 / 失败通知标题改为**跟随标签**（O20：通知标题 ≡ 菜单项文字）。
//!
//! 反馈口径与命令层 `commands/md_sync_cmd.rs::announce` 一致：只在真的导入了数据时广播
//! `mdSyncChanged`（空转发会让所有窗口白刷一遍）。

use std::sync::atomic::{AtomicBool, Ordering};

use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use super::tray_label;
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
pub(super) static RUNNING: AtomicBool = AtomicBool::new(false);

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
///
/// [V0.11.19] `pub(crate)`：批 1 的两条后台链（`jobs::md_sync` / `jobs::md_cloud`）
/// 与托盘 / 退出流程共用**同一把闸**，不许另造第二把（设计 §14 第 7 条）。
/// `Gate` 的 `Drop` 语义仍然只在这里定义一次。
pub(crate) struct Gate;

impl Drop for Gate {
    fn drop(&mut self) {
        RUNNING.store(false, Ordering::SeqCst);
    }
}

/// 抢闸：抢到 → `Some(Gate)`（作用域结束复位）；抢不到 → `None`，**且不构造 `Gate`**。
pub(crate) fn try_acquire() -> Option<Gate> {
    /* `swap` 是原子的「读 + 置位」，比 `load` 再 `store` 少一个竞态窗口。 */
    if RUNNING.swap(true, Ordering::SeqCst) {
        return None;
    }
    Some(Gate)
}

/// 托盘「Markdown 同步」入口：抢闸 → 异步跑一轮。
pub(crate) fn spawn(app: &AppHandle) {
    /* 抢不到就早退：`try_acquire` 只在这一种情况下返回 `None`，而且**没有**构造 `Gate`，
    所以不会把别人那一轮的闸复位掉。 */
    let Some(gate) = try_acquire() else {
        crate::log_warn!("tray md sync ignored: previous run still in flight");
        notify_busy_once(app);
        return;
    };
    /* 本轮开始：允许下一条「进行中」提示再弹一次。 */
    BUSY_NOTICE_SHOWN.store(false, Ordering::SeqCst);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        /* 抢到闸之后立刻持有：后面 `?` 早退 / panic / 正常结束都由 `Drop` 复位。 */
        let _gate = gate;
        let pool = app.state::<AppState>().pool.clone();
        run_once(&app, &pool).await;
    });
}

/// 命中闸时的可见反馈（本轮只弹一次）。
fn notify_busy_once(app: &AppHandle) {
    if BUSY_NOTICE_SHOWN.swap(true, Ordering::SeqCst) {
        return;
    }
    notify_or_log(app, tray_label::LOCAL_LABEL, "上一次同步还在进行中，请稍候");
}

/// 真正的一轮同步 + 三种可见反馈（未启用 / 失败 / 完成）。
async fn run_once(app: &AppHandle, pool: &SqlitePool) {
    /* 判据直接用服务层读配置的那套（`md_sync::config::load`，与设置页 / 调度链同源），
    不在这里另造一份「是否启用」的状态或缓存。 */
    let config = match services::md_sync::config::load(pool).await {
        Ok(config) => config,
        Err(err) => {
            crate::log_warn!("tray md sync load config failed: {err}");
            notify_or_log(app, "Markdown 同步失败", &err.to_string());
            return;
        }
    };
    /* 「不会跑」的两档都在 `tray_label::blocked_notice` 里（纯函数，可单测）：命中就只弹
    那一条，**不继续**跑——跑了就会紧跟一条「完成 / 没有变更」，两条通知互相拆台。 */
    if let Some((title, body)) = tray_label::blocked_notice(&config) {
        notify_or_log(app, title, body);
        return;
    }

    /* [V0.11.13] 从 `md_sync::run` 换成云端编排 `md_cloud::round_manual`：云端没配时它
    逐字转交 `md_sync::run`，所以这里只多取一层 `.report`，下面的通知与事件一字不动。 */
    match services::md_cloud::round_manual(pool).await {
        Ok(outcome) => {
            let report = outcome.report;
            /* [V0.11.26] 通知标题 ≡ 菜单项文字（O20）：标签现读生效通路
            （刚刚那一轮可能改了配置），完成 / 失败都跟随它。 */
            let label = tray_label::sync_label(pool).await;
            /* `run` 只在**整体**不可执行时返回 Err；单个落点失败落在 `report.errors` 里。
            有错误就按失败告知（部分成功也不该说「完成」），其余计数照旧可用。 */
            if report.errors.is_empty() {
                notify_or_log(app, &format!("{label}完成"), &sync_body(&report));
            } else {
                let detail = report.errors.join("；");
                crate::log_warn!("tray md sync finished with errors: {detail}");
                notify_or_log(app, &format!("{label}失败"), &detail);
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
fn notify_or_log(app: &AppHandle, title: &str, body: &str) {
    if !notify::notify(app, title, body) {
        crate::log_warn!("tray md sync notify suppressed: {title}");
    }
}

/// 完成通知正文：只报 `MdSyncReport` 现成的两个计数，不另造口径。
fn sync_body(report: &MdSyncReport) -> String {
    if report.imported == 0 && report.exported == 0 {
        return "没有需要同步的变更".to_string();
    }
    /* 说「导出 N 处」而不是「N 个文件」：`exported` 数的是**写文件的落点数**。 */
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

    /// **QA 独立验收 · V0.11.18 的闸判据**：抢不到闸时**绝不构造 `Gate`**。
    ///
    /// `Gate` 是**无条件 `Drop` 复位**（把 `RUNNING` 写回 `false`）。「先 `let _gate = Gate;`
    /// 再判 `RUNNING`」会把**别人正在跑的那一轮**的闸复位掉 —— 防重入静默失效。
    /// 这里用**可观测的原子量**钉住：抢失败之后 `RUNNING` 必须仍是 `true`。
    /// 两个场景写在**同一个测试**里：`RUNNING` 是进程级静态，两个测试并行跑会
    /// 互相把对方的闸拨掉，红的会是随机一条。
    #[test]
    fn try_acquire_never_steals_or_resets_the_gate_of_a_running_round() {
        use std::sync::atomic::Ordering;
        use super::{try_acquire, RUNNING};

        /* 场景 1：已经有一轮在跑（`spawn` 抢到了闸）。此时点托盘退出 / 再点同步都抢不到，
           而且**不许**把那一轮的闸复位。 */
        RUNNING.store(true, Ordering::SeqCst);
        assert!(try_acquire().is_none(), "闸被占着时必须返回 None（早退）");
        assert!(
            RUNNING.load(Ordering::SeqCst),
            "抢不到闸时**不许**构造 Gate —— 那一轮跑完前闸必须还是关着的"
        );

        /* 场景 2：闸是空的。抢得到，而且**只有** `Gate` 被 drop 之后才复位。 */
        RUNNING.store(false, Ordering::SeqCst);
        let gate = try_acquire().expect("空闸必须抢得到");
        assert!(RUNNING.load(Ordering::SeqCst), "抢到之后闸必须是关着的");
        assert!(try_acquire().is_none(), "持有期间再一次抢必须失败（防重入）");
        drop(gate);
        assert!(!RUNNING.load(Ordering::SeqCst), "Gate 必须由 Drop 复位");
        assert!(try_acquire().is_some(), "复位之后必须能再抢到");

        /* 收尾：把静态量还回初值，避免影响同进程里后续用例。 */
        RUNNING.store(false, Ordering::SeqCst);
    }
}
