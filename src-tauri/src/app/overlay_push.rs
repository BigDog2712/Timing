//! 把计时快照推给安卓悬浮条（Rust → Kotlin，[V0.11.27]）。
//!
//! ## 为什么走「推」而不是让原生「拉」
//!
//! 拉的路（`TimerReader.kt` 直读 `timing.db`）失败过一次，而且失败时不说话：悬浮条
//! 静默停在待机，主界面照常在计时。推的路把「什么时候变」交给唯一知道这件事的地方
//! ——状态机每迁移一次就推一次，原生侧只负责显示，不猜、不查库。
//!
//! ## 为什么只挂在 `emit_timer_state` 上
//!
//! 那是计时状态的**唯一**广播出口（托盘同步也挂在同一处）。多一个挂点就多一条会漏推
//! 的路径；宁可让推送跟着广播走，也不要各自记「什么时候该推」。
//!
//! 桌面是空实现：没有悬浮服务可推，也不需要为了对称去动任何东西。

use sqlx::SqlitePool;
use tauri::AppHandle;

/// 读一次当前状态并推到原生悬浮服务（手机端）。
///
/// 失败一律只记日志、不外抛：这是一条**纯显示**通路，推不出去最坏是悬浮条停在上一帧，
/// 绝不能让「开始计时」因为悬浮条而失败。
#[cfg(mobile)]
pub async fn push(app: &AppHandle, pool: &SqlitePool) {
    use tauri::Manager;

    let state = match crate::services::timer::state(pool).await {
        Ok(state) => state,
        Err(err) => {
            crate::log_warn!("overlay push: 读计时状态失败：{err}");
            return;
        }
    };
    let snapshot = match crate::services::overlay_push::snapshot(pool, &state).await {
        Ok(snapshot) => snapshot,
        Err(err) => {
            crate::log_warn!("overlay push: 组装快照失败：{err}");
            return;
        }
    };

    /* 桥不在 = 原生插件还没注册完（冷启动时 `bootstrap` 可能早于插件 `setup`）。
       不重试、不排队：下一条状态迁移自然会再进来一次，那一次桥一定在。 */
    let Some(bridge) = app.try_state::<crate::infra::native_bridge::NativeBridge<tauri::Wry>>()
    else {
        crate::log_warn!("overlay push skipped: 原生桥未就绪");
        return;
    };

    match bridge
        .call::<serde_json::Value>("overlayPush", &snapshot)
        .await
    {
        Ok(_) => crate::log_info!("overlay push: {}", snapshot.summary()),
        Err(err) => crate::log_warn!("overlay push 失败：{err}"),
    }
}

#[cfg(desktop)]
pub async fn push(_app: &AppHandle, _pool: &SqlitePool) {}

/// 冷启动补推一次（`bootstrap` 里调）。
///
/// **必须 `spawn`、不能同步等**：插件调用要把活交回安卓主线程再拿结果，而 `bootstrap`
/// 正跑在主线程上——同步等是死锁（ANR），不是慢。
///
/// 拆成函数而不是在 `bootstrap` 里写 `#[cfg]` 块：那样 `bootstrap.rs` 会多出十几行，
/// 它本来就贴着 300 行门禁（本轮 +14 行直接超限，被 `check:size` 拦下）。
#[cfg(mobile)]
pub fn push_on_boot(app: &AppHandle, pool: &SqlitePool) {
    let handle = app.clone();
    let pool = pool.clone();
    tauri::async_runtime::spawn(async move { push(&handle, &pool).await });
}

#[cfg(desktop)]
pub fn push_on_boot(_app: &AppHandle, _pool: &SqlitePool) {}
