//! 远端失败后的退避（V0.11.13，设计 §2.6 / §4.5）。
//!
//! ## 为什么要有这一层
//!
//! 坚果云是 600 次 / 30 分钟的滑动窗口。一轮失败如果被下一轮立刻重试，一次故障会被
//! 放大成几十次请求，最后换来整段窗口的 429——用户看到的是「明明有网却同步不上」。
//! 所以失败按 [`MD_CLOUD_BACKOFF_MS`] 三级递退（5s → 15s → 60s），第三次之后停在
//! 60s 再等下一轮自动同步。
//!
//! ## 为什么是进程内单例、不落库
//!
//! 退避只回答「现在要不要发出这次请求」。进程重启 = 用户重开了应用，重试一次是合理的；
//! 把它落库还要多一张表、多一套清理口径，换不来任何用户可见的差异。
//!
//! 用 `tokio::sync::Mutex` 而不是 `std::sync::Mutex`：`on_failure` / `should_skip` 在
//! async 上下文里被调用，持锁时间极短（三行），但仍不该在 `.await` 之间持有 std 锁。

use std::sync::OnceLock;

use tokio::sync::Mutex;

use crate::models::constants::MD_CLOUD_BACKOFF_MS;

/// 当前退避状态：失败次数（决定阶梯位置）+ 允许下次尝试的时刻。
#[derive(Debug, Clone, Copy, Default)]
struct Backoff {
    fails: usize,
    until: i64,
}

static STATE: OnceLock<Mutex<Backoff>> = OnceLock::new();

fn state() -> &'static Mutex<Backoff> {
    STATE.get_or_init(|| Mutex::new(Backoff::default()))
}

/// 现在是否仍在退避窗口里（`true` = 这一轮不要发请求）。
pub async fn should_skip(now_ms: i64) -> bool {
    state().lock().await.until > now_ms
}

/// 记一次失败：按阶梯把窗口推到 `now + 第 n 级`。
///
/// 阶梯用 `min(len - 1)` 夹住：第 4 次、第 5 次失败都停在最后一级（60s），
/// 不会因为次数继续增长而越推越远——那会让「网恢复了」也要等很久才被察觉。
pub async fn on_failure(now_ms: i64) {
    let mut guard = state().lock().await;
    let step = MD_CLOUD_BACKOFF_MS[guard.fails.min(MD_CLOUD_BACKOFF_MS.len() - 1)];
    guard.fails = (guard.fails + 1).min(MD_CLOUD_BACKOFF_MS.len());
    guard.until = now_ms + step;
}

/// 一次成功就清零：阶梯记的是「连续失败」，中间成功过一次就该从头算。
pub async fn on_success() {
    let mut guard = state().lock().await;
    guard.fails = 0;
    guard.until = 0;
}
