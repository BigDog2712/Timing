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
/// [V0.11.18] `pub(super)`：`app/tray_quit.rs`（退出前同步）要复用同一把闸，
/// 但 `Gate` 的 `Drop` 语义只该有一处定义。
pub(super) struct Gate;

impl Drop for Gate {
    fn drop(&mut self) {
        RUNNING.store(false, Ordering::SeqCst);
    }
}

/// 抢闸：抢到 → `Some(Gate)`（作用域结束复位）；抢不到 → `None`，**且不构造 `Gate`**。
///
/// [V0.11.18] 抽成函数是为了让「先试抢、抢不到立刻早退」变成**类型上唯一可能的形状**：
/// 调用方拿到的是 `Option<Gate>`，写不出「先 `let _gate = Gate;` 再判 `RUNNING`」这种
/// 会在**别人正在跑的那一轮**身上复位闸的错法（`spawn` 与 `quit_after_sync` 共用）。
pub(super) fn try_acquire() -> Option<Gate> {
    /* `swap` 是原子的「读 + 置位」，比 `load` 再 `store` 少一个竞态窗口。 */
    if RUNNING.swap(true, Ordering::SeqCst) {
        return None;
    }
    Some(Gate)
}

/// 托盘「Markdown 同步」这一项的**标签**：读**生效通道**，不读草稿里的选择。
///
/// 判据 = `config.enabled` **且** `md_cloud::usable`（`cloud.enabled && is_usable()`）。
/// 两条缺一不可，各挡一句假话：
/// - 只看 `cloud.enabled`：字段没填全时那一轮仍走 `md_sync::run`，「云端同步」是骗人；
/// - 只看 `usable()`：它**不含顶层总开关**（还服务 `round` / 轮询 / 手机端 / 备份，不动它），
///   总开关关着而云端填全时写着「云端同步」，点下去弹的却是「先在设置里打开 Markdown 同步」。
///
/// `infra` 不参与判断（分层门禁）：`tray_menu` 只负责把文字放进菜单项。读配置失败按
/// 「只用本地」处理——标签只是提示，为它崩掉托盘不划算，真失败由通知 / 块④ 状态行说。
pub(crate) async fn sync_label(pool: &SqlitePool) -> &'static str {
    match services::md_sync::config::load(pool).await {
        Ok(config) => {
            /* 总开关关着 → 这一轮连 `md_sync::run` 都不会进，说「云端同步」是假话。 */
            if !config.enabled {
                return LOCAL_LABEL;
            }
            if services::md_cloud::usable(&config).is_some() {
                CLOUD_LABEL
            } else {
                LOCAL_LABEL
            }
        }
        Err(err) => {
            crate::log_warn!("tray sync label: load config failed: {err}");
            LOCAL_LABEL
        }
    }
}

/// 「只用本地」时的菜单项文字（与 `tray.rs` 首次装配用的常量一致）。
pub(crate) const LOCAL_LABEL: &str = "Markdown 同步";
/// 「本地 + 云端」生效时的菜单项文字。
pub(crate) const CLOUD_LABEL: &str = "云端同步";

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
    notify_or_log(app, "Markdown 同步", "上一次同步还在进行中，请稍候");
}

/// 点同步时「压根不会跑到云端那一半」的判据（**纯函数**，便于单测）：
/// `Some((通知标题, 通知正文))`；`None` = 这一下会真的跑。
///
/// **标题规范：必须与用户刚刚点的那一项标签逐字相同**——通知是对「你刚做的动作」的回应，
/// 不是对「你可能想要的动作」的回应。这两档下 `sync_label` 都返回 `LOCAL_LABEL`
/// （总开关关着 / 未填全），所以标题都是它。写成「云端同步」就成了自相矛盾的画面：
/// 点的是写着「Markdown 同步」的那一项，弹出来的却自称「云端同步」。
/// 两档靠**正文**区分（去开总开关 / 去填全字段），都指向设置页同一个地方。
///
/// 两档并存不是冗余：标签管「点之前知道会同步到哪」，这条管「点了之后知道为什么只写了一半」。
/// 判据直接用后端的 `is_usable()`，**不在这里重算字段**：填全的定义只允许有一份。
pub(crate) fn blocked_notice(config: &crate::models::md_sync::MdSyncConfig) -> Option<(&'static str, &'static str)> {
    if !config.enabled {
        return Some((LOCAL_LABEL, "先在设置里打开 Markdown 同步"));
    }
    match config.cloud.as_ref() {
        Some(cloud) if cloud.enabled && !cloud.is_usable() => {
            Some((LOCAL_LABEL, "先在设置里填好云端"))
        }
        _ => None,
    }
}

/// 真正的一轮同步 + 三种可见反馈（未启用 / 失败 / 完成）。
async fn run_once(app: &AppHandle, pool: &SqlitePool) {
    /* 判据直接用服务层读配置的那套（`md_sync::config::load`，与设置页 / 轮询任务同源），
    不在这里另造一份「是否启用」的状态或缓存。 */
    let config = match services::md_sync::config::load(pool).await {
        Ok(config) => config,
        Err(err) => {
            crate::log_warn!("tray md sync load config failed: {err}");
            notify_or_log(app, "Markdown 同步失败", &err.to_string());
            return;
        }
    };
    /* 「不会跑」的两档都在 `blocked_notice` 里（纯函数，可单测）：命中就只弹那一条，
    **不继续**跑——跑了就会紧跟一条「完成 / 没有变更」，两条通知互相拆台。 */
    if let Some((title, body)) = blocked_notice(&config) {
        notify_or_log(app, title, body);
        return;
    }

    /* [V0.11.13] 从 `md_sync::run` 换成云端编排 `md_cloud::round`：云端没配时它逐字
    转交 `md_sync::run`，所以这里只多取一层 `.report`，下面的通知与事件一字不动。 */
    match services::md_cloud::round(pool).await {
        Ok(outcome) => {
            let report = outcome.report;
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

    /// **QA 独立验收 · V0.11.18 的闸判据**：抢不到闸时**绝不构造 `Gate`**。
    ///
    /// ## 这条为什么必须存在（设计 §11 坑 6）
    ///
    /// `Gate` 是**无条件 `Drop` 复位**（把 `RUNNING` 写回 `false`）。所以「先 `let _gate = Gate;`
    /// 再判 `RUNNING`」这种顺序会把**别人正在跑的那一轮**的闸复位掉 —— 防重入静默失效，
    /// 两轮并发写同一个 `.md`，`write_atomic` 的 temp + rename 互相覆盖，用户的日记被截断。
    ///
    /// `try_acquire()` 返回 `Option<Gate>` 让「抢不到」在类型上就**拿不到闸**，但类型只能防
    /// 住「拿到了却不用」，防不住有人把 `Gate` 改成可空变体或者事后补一个 `Gate::new()`。
    /// 所以这里用**可观测的原子量**钉住：抢失败之后 `RUNNING` 必须仍是 `true`。
    ///
    /// 两个场景写在**同一个测试**里（不是两条）：`RUNNING` 是进程级静态，两个测试并行跑会
    /// 互相把对方的闸拨掉，红的会是随机一条 —— 那种红没人能复现，比没有测试更糟。
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

        /* 场景 2：闸是空的。抢得到，而且**只有** `Gate` 被 drop 之后才复位
           （正常返回 / `?` 早退 / panic 三条路径都由 `Drop` 覆盖）。 */
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
