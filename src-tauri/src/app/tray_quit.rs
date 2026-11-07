//! 托盘「退出」：先跑一轮同步再退出（V0.11.18，PRD §13.3 / 设计 §4）。
//!
//! 从 `app/tray_sync.rs` 拆出（单文件 ≤300 行，ADR-017）：那边是「点同步之后做什么」，
//! 这里是「点退出之前做什么」。两者唯一的交点就是那把 `RUNNING` 闸，所以闸留在
//! `tray_sync`（`Gate` 的 `Drop` 语义只该有一处定义），本模块通过
//! `tray_sync::try_acquire()` 拿它。

use std::time::Duration;

use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use crate::app::tray_sync::try_acquire;
use crate::services;
use crate::state::AppState;

/// 退出前同步的时间预算（[V0.11.18]，PRD §13.3.1「硬上限 3 秒」）。
///
/// **这 3 秒是 ③「退出前那一轮 md_cloud::round」的预算，不含 ②（批 2 的计时收尾）。**
/// ② 是纯本机写库（`timer::stop` + 保存），毫秒级，套进 `timeout` 反而会在慢盘上
/// 被整体放弃 —— 那一放弃丢的是用户刚计的那一段，代价远大于多等几十毫秒。
///
/// 超了照样退出：用户的「退出」不能被一场网络超时挟持 —— 落点配在 OneDrive / 网络盘上时，
/// `md_sync::run` 卡住是常态而不是异常（`Gate` 那段注释记的就是这个事故）。
/// 不给「进度条 / 百分比 / 对话框」：3 秒预算内都没有意义（PRD §10-N9 / N15）。
pub(crate) const QUIT_SYNC_BUDGET: Duration = Duration::from_secs(3);

/// 退出前那一轮：**静默**，返回「这一轮到底跑没跑」。
///
/// 与 `run_once`（下面）刻意分开、不复用，三条理由：
/// - `run_once` 的三种反馈全是系统通知，退出途中弹通知没有意义（窗口正在消失，通知点不到
///   任何东西），而且通知可能被专注助手拦掉 —— PRD §13.3.1「不发通知」；
/// - `run_once` 在「总开关关着」时会弹「先在设置里打开 Markdown 同步」，退出时弹这句是纯噪声；
/// - 返回值语义不同：调用方要知道「有没有真的要跑」，才好决定**要不要等**。
///
/// `false` = 总开关关着 / 读配置失败 → 没有要写的东西，调用方立刻退出。
/// PRD §13.3.1「同步未启用 → 不跑、不等，直接退出（白等 3 秒是纯损失）」。
///
/// 成败都只落日志：这一次的成败由下一次启动的第一轮自然重试（`md_cloud_pending` 会把
/// 没传上去的那天留在清单里），块③ / ④ 的状态行也会显示 `上次同步失败`。
pub(crate) async fn run_before_quit(pool: &SqlitePool) -> bool {
    match services::md_sync::config::load(pool).await {
        Ok(config) if !config.enabled => return false,
        Ok(_) => {}
        Err(err) => {
            crate::log_warn!("quit md sync load config failed: {err}");
            return false;
        }
    }
    match services::md_cloud::round(pool).await {
        Ok(outcome) => crate::log_info!(
            "quit md sync done: 导入 {} 条 · 导出 {} 处",
            outcome.report.imported,
            outcome.report.exported
        ),
        Err(err) => crate::log_warn!("quit md sync failed: {err}"),
    }
    true
}

/// 托盘「退出」：先跑一轮再退（[V0.11.18]，PRD §13.3 / 设计 §4.4）。
///
/// ## 为什么不在 `lib.rs` 挂 `RunEvent::ExitRequested`
///
/// 那条路能覆盖「所有退出路径」，代价是把 `builder.run(ctx)` 换成
/// `builder.build(ctx)?.run(|app, event| …)`，并在一个 **sync** 回调里桥接 **async** 的写库。
/// 批 0 只要求「托盘退出」这一条路，没必要为一个入口改动整个事件循环（批 2 要「记住关闭
/// 时间」时才必须覆盖所有路径）。另外三条路径**维持原样**：窗口关闭到托盘
/// （`infra/window.rs` CloseRequested → hide，根本没退出）、`commands/system_cmd.rs` 的
/// `quit_app`、任务管理器杀进程（PRD §13.3.1：杀进程**什么都不做**）。
///
/// ## `RUNNING` 闸的正确形状（这里最容易写错）
///
/// `Gate` 是**无条件 `Drop` 复位**。所以必须先试抢、抢不到**立刻早退、绝不构造 `Gate`** ——
/// 与 `spawn` 的形状逐个动作对齐。写成「先 `let _gate = Gate;` 再判」会在**别人正在跑的
/// 那一轮**身上把闸复位：防重入静默失效，两轮并发写同一个 `.md`，`write_atomic` 的
/// temp + rename 互相覆盖。
///
/// ## 三条边界
///
/// 1. 抢闸失败 → 只给一个固定等待窗口（3 秒），**不抢它的闸**，然后照样退出；
/// 2. 超时照样退出：`timeout` 的 `Err` 只落一条日志，下一行无条件 `app.exit(0)`；
/// 3. 杀进程不处理：`std::process::exit` / 任务管理器结束进程都绕过这一切。接受 ——
///    `md_file::write_atomic` 是 temp + rename，被杀只会留下一个孤儿 `.tmp`，
///    目标文件不会截断。
///
/// ## `app.exit(0)` 从异步任务里调用是否线程安全 —— **已核实源码，安全**
///
/// `tauri 2.12.4` 的 `AppHandle::exit`（`src/app.rs:581-587`）→ `request_exit` →
/// `tauri-runtime-wry 2.12.2` 的 `WryHandle::request_exit`（`src/lib.rs:2597-2604`）：
///
/// ```text
/// self.context.proxy.send_event(Message::RequestExit(code))
/// ```
///
/// `EventLoopProxy::send_event` 就是「跨线程给事件循环投消息」的那条通道，从任意线程调用
/// 都成立（同函数的注释还专门说明「request_exit 不能用 `send_user_message`，因为它要访问
/// 事件循环回调」——即它是**不**依赖调用线程的）。所以不需要设计里那条退路
/// （`app.cleanup_before_exit(); std::process::exit(0)`）。
/// 另外：投递失败时 Tauri 自己就会走 `cleanup_before_exit()` + `std::process::exit`，
/// 那条退路已经内建在 SDK 里，不必我们再写一份。
pub(crate) fn quit_after_sync(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        /* ① 抢闸：`try_acquire` 抢不到时**没有**构造 `Gate`，所以不会把别人那一轮的闸
           复位掉（见函数头的「正确形状」）。抢不到 → 只给一个固定等待窗口，不抢它的闸。 */
        let Some(_gate) = try_acquire() else {
            crate::log_warn!("quit: md sync already in flight, waiting up to 3s");
            tokio::time::sleep(QUIT_SYNC_BUDGET).await;
            app.exit(0);
            return;
        };
        let pool = app.state::<AppState>().pool.clone();

        /* ② 【批 2 挂点】按 running_since 收尾并保存，必须在同步之前。
           顺序反过来（先同步、后收尾）会永久丢一段：③ 那一轮导出的是**收尾前**的秒数，
           而 `round_webdav` 的 `last_hash` 会把「少了最后那一段」的版本记成已同步 →
           下次启动 `pending_since == 0` 判为已上传 → 那一段永远补不回来。 */

        /* ③ 退出前那一轮（静默，成败只落日志） */
        /* [V0.11.18] B7：先把退出项换成 `正在同步…` + 禁用再开跑。
        位置在 ② 之后、③ 之前：抢到闸（= 这一下真的会跑）才有「正在同步」可言；
        而标签必须在 `run_before_quit` **之前**落地，否则用户点完到菜单变字之间隔着一次
        网络往返，那几十毫秒正好是「点了没反应」的窗口。 */
        crate::app::events::mark_tray_quitting(&app, &pool).await;
        crate::log_info!("quit: sync start");
        match tokio::time::timeout(QUIT_SYNC_BUDGET, run_before_quit(&pool)).await {
            Ok(true) => crate::log_info!("quit: sync done"),
            /* 总开关关着：没有要写的东西，不等满 3 秒 */
            Ok(false) => crate::log_info!("quit: sync skipped (markdown sync disabled)"),
            Err(_) => crate::log_warn!("quit: sync timeout"),
        }
        /* ④ 无条件退出：用户的「退出」不能被一场网络超时挟持 */
        app.exit(0);
    });
}
