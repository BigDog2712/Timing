//! 时长文本格式化（纯函数）。
//!
//! 从 `infra::tray_menu` 提出来的原因：这个函数不止托盘用——倒计时到点的**系统通知**
//! 正文也要它（`jobs::countdown`）。留在 tray_menu 里会让「桌面独占的托盘模块」被
//! 两平台共用的通知路径依赖，移动端就没法把 tray_menu 整块门控掉。
//! 放在 platform 叶子层：纯 std、无业务、无 Tauri，谁都能用。

/// 时长显示上限（与前端 `formatDuration` 同口径：99:59:59）。
const MAX_DISPLAY_SEC: i64 = 99 * 3600 + 59 * 60 + 59;

/// 时长格式化：`<1h` → `MM:SS`；`>=1h` → `HH:MM:SS`；负值归零、上限 99:59:59。
pub fn format_duration(total_sec: i64) -> String {
    let sec = total_sec.clamp(0, MAX_DISPLAY_SEC);
    let hours = sec / 3600;
    let minutes = (sec % 3600) / 60;
    let seconds = sec % 60;
    if hours > 0 {
        format!("{hours:02}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes:02}:{seconds:02}")
    }
}
