use crate::models::insight::events::TRACKING_DATA_CHANGED;
use crate::models::insight::tracking::TrackingDataChangedPayload;
use tauri::{AppHandle, Emitter, Runtime};

pub(super) fn now_ms() -> i64 {
    crate::infra::insight::clock::unix_timestamp_millis_i64()
}

pub fn emit_tracking_data_changed<R: Runtime>(
    app: &AppHandle<R>,
    reason: &str,
    changed_at_ms: u64,
) -> tauri::Result<()> {
    app.emit(
        TRACKING_DATA_CHANGED,
        TrackingDataChangedPayload::new(reason, changed_at_ms),
    )
}

pub(super) fn log_tracker_error(message: impl AsRef<str>) {
    crate::log_error!("{}", message.as_ref());
}

/// 是否应把这次前台窗口变化广播给前端。
///
/// **为什么要过滤自家进程**：本应用有两个窗口（药丸 `main` + 分析窗 `patina`）。用户点进
/// 分析窗看数据时，前台窗口就是自家窗口 —— 广播出去会让前端把「刚记住的游戏」清掉，于是
/// 从分析窗切回游戏时不再触发「启动即接管」（用户视角：我明明回来了却没计时）。自家窗口的
/// 变化到这里就止步；`last_emitted_window` 仍照常推进（否则切回游戏时判不出变化）。
pub(super) fn should_emit_active_window(process_id: u32, self_pid: u32) -> bool {
    process_id != self_pid
}

#[cfg(test)]
mod tests {
    use super::should_emit_active_window;

    #[test]
    fn self_process_never_emits_active_window_change() {
        assert!(should_emit_active_window(4242, 7));
        assert!(!should_emit_active_window(4242, 4242));
    }
}
