//! 「绑定的应用进程退出 → 结束这一段自动接管开出来的计时」（[0.13]）。
//!
//! ## 这条命令做三件事，别的什么都不做
//!
//!   1. 开一个 `PROCESS_SYNCHRONIZE` 句柄并**注册**（打不开就当作已退出、不注册）；
//!   2. 起一个等待线程（`WaitForSingleObject` 500ms 一片，活着的永远 ≤1 个：新注册会
//!      推进代数，旧线程下一片就自行退出）；
//!   3. 进程真退出时，走**段级校验** + 停表 + 补上 `timer_cmd.rs::stop_timer` 那三件事
//!      的另外两件（`dirty::mark` / `emit_timer_state`）。
//!
//! ## 为什么 `dirty::mark` 与 `emit_timer_state` 在这里而不是 service
//!
//! L8（`scripts/check-layers.mjs`）：业务写入信号 `dirty::mark(` 只允许出现在
//! `src-tauri/src/commands/`。少打这一针的后果是「这次停止不会触发 md 同步」，
//! 用户看不到任何异常 —— 所以它与 `stop_timer` 走同一条收尾，一处都不许漏。
//!
//! ## 为什么打不开句柄不报错
//!
//! 用户没点任何东西（这条链路是引擎广播驱动的），弹一句「无法监视进程」只会让人困惑，
//! 而且原因通常是「那个应用在我注册之前就已经关了」—— 那正是「本来就不该再停什么」。
//! 记一行 warn 足够排查。

use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::error::AppResult;
use crate::models::bound_process_watch::BoundProcessWatchInput;
use crate::services;
use crate::services::bound_process_watch::{
    self, ExitOutcome, ProcessHandle, SegmentRef, SettleOutcome,
};
use crate::state::AppState;

#[tauri::command]
pub async fn set_bound_process_watch(
    app: AppHandle,
    watch: Option<BoundProcessWatchInput>,
) -> AppResult<()> {
    let registry = bound_process_watch::global_arc();

    /* `None` = 清除。前端**不主动**调它（段级校验会自己兜住「用户手动切走」），
       保留它是为了让这条契约在两种语义上都可表达、也可被用例驱动。 */
    let Some(watch) = watch else {
        registry.clear();
        return Ok(());
    };

    let Some(handle) = ProcessHandle::open(watch.process_id) else {
        /* 打不开 = 已经退出 / 权限不足。**不注册**：绝不拿失败句柄去等。
           顺手清掉上一条注册 —— 同一个应用的下一次接管会重新注册。 */
        registry.clear();
        crate::log_warn!(
            "bound process watch not registered: pid={} open failed (item={})",
            watch.process_id,
            watch.item_id
        );
        return Ok(());
    };

    let generation = registry.register(
        SegmentRef {
            item_id: watch.item_id,
            started_at: watch.segment_started_at,
        },
        watch.process_id,
    );
    crate::log_info!(
        "bound process watch registered: pid={} item={} segment={} gen={}",
        watch.process_id,
        watch.item_id,
        watch.segment_started_at,
        generation
    );

    let wait_registry = Arc::clone(&registry);
    let settle_registry = Arc::clone(&registry);
    let app_handle = app.clone();
    /* 一线程一次注册。它是**内核阻塞**（没退出时睡在内核里），不占 CPU；
       返回即析构句柄，所以线程退出与句柄回收是同一件事。 */
    std::thread::spawn(move || {
        let outcome = bound_process_watch::wait_for_exit(handle, generation, wait_registry);
        if outcome != ExitOutcome::Exited {
            /* `Superseded` = 注册被替换（正常）；`Failed` = 句柄失效（记一行就够，
               下一次接管会重新注册，不重试也不上报用户）。 */
            if outcome == ExitOutcome::Failed {
                crate::log_warn!("bound process watch wait failed: pid={}", watch.process_id);
            }
            return;
        }
        /* 线程里不能 await：把真正的写库交给 tokio 运行时，池从 AppState 现取
           （`State<'_, _>` 搬不进 `'static` 线程，`jobs/flusher.rs` 同一手法）。 */
        tauri::async_runtime::spawn(async move {
            let pool = app_handle.state::<AppState>().pool.clone();
            match bound_process_watch::settle_after_exit(&pool, &settle_registry, generation).await
            {
                SettleOutcome::Stopped {
                    record_id,
                    discarded,
                } => {
                    /* 与 `stop_timer` 逐字同一条收尾（`commands/timer_cmd.rs:57-63`）：
                       落盘信号 + 状态广播。少一样就是「停了但界面/同步不知道」。 */
                    services::md_sync::dirty::mark("timer");
                    crate::app::events::emit_timer_state(&app_handle, &pool).await;
                    crate::log_info!(
                        "bound process exited: stopped record {record_id} (discarded={discarded})"
                    );
                }
                SettleOutcome::SegmentMismatch => {
                    /* 用户在这期间手动切走 / 手动结束了：只清注册表，绝不碰计时。 */
                    crate::log_info!(
                        "bound process exited but the segment changed since registration; timer untouched"
                    );
                }
                SettleOutcome::Superseded => {}
                SettleOutcome::Failed(error) => {
                    crate::log_warn!("bound process exit settle failed: {error}");
                }
            }
        });
    });

    Ok(())
}
