//! [V0.11.27] 悬浮条快照的组装口径。
//!
//! ## 这一轮修的是什么（别删这几条）
//!
//! 悬浮条显示的东西在 v0.11.22 是 `TimerReader.kt` 直读 `timing.db` 得来的。那条路失败
//! 过一次：库没读到时原生层只能落待机态，主界面照常计时，用户看到「无联系」，而现场只有
//! 一行被吞掉的异常。现在显示源是这里组装的快照，**口径也就必须由这里钉住**。
//!
//! 三条易错的口径，各有用例：
//! 1. **暂停也是 `session` 非空**：靠 `status` 判显示，不能靠 `session.is_none()` 判待机，
//!    否则暂停会显示成「正在计时」。
//! 2. **待机不留 `mode`**：上一次是倒计时的用户切到待机，悬浮条不该写「倒计时 0」。
//! 3. **`runningSince` 原样透传**：悬浮条的弧靠它逐帧现算，换成「已经多少秒」会跳格。
//!
//! ## 变异自证
//!
//! 把 `of()` 里的 `status: state.status.clone()` 改成 `timer_status::RUNNING.to_string()`
//! → `paused_is_not_shown_as_running` 红；把 `let Some(record) = ... else { return Self::idle() }`
//! 的 `idle()` 换成保留 `state.mode` 的写法 → `idle_does_not_keep_the_last_countdown` 红。

use crate::models::enums::{timer_mode, timer_status};
use crate::models::overlay::OverlaySnapshot;
use crate::models::record::TimeRecord;
use crate::models::timer::TimerState;

/// 一条 active 会话（正计时，跑了 90 秒，正在跑）。
fn running_record() -> TimeRecord {
    TimeRecord {
        id: 7,
        item_id: 3,
        status: "active".to_string(),
        started_at: 1_700_000_000_000,
        ended_at: None,
        accumulated_sec: 90,
        running_since: Some(1_700_000_090_000),
        note: None,
        mode: timer_mode::COUNTUP.to_string(),
        target_sec: None,
    }
}

fn state_of(status: &str, session: Option<TimeRecord>) -> TimerState {
    let mode = session
        .as_ref()
        .map(|r| r.mode.clone())
        .unwrap_or_else(|| timer_mode::COUNTUP.to_string());
    TimerState {
        status: status.to_string(),
        session,
        last_item_id: Some(3),
        live_duration_sec: 90,
        mode,
        remaining_sec: None,
    }
}

#[test]
fn idle_snapshot_is_all_zero() {
    let snap = OverlaySnapshot::of(&state_of(timer_status::IDLE, None), "");
    assert_eq!(snap.status, timer_status::IDLE);
    assert!(snap.item.is_empty(), "待机不该挂事项名");
    assert_eq!(snap.accumulated_sec, 0);
    assert_eq!(snap.running_since, None);
    assert_eq!(snap.target_sec, 0);
}

#[test]
fn running_keeps_raw_fields_for_the_native_clock() {
    let snap = OverlaySnapshot::of(&state_of(timer_status::RUNNING, Some(running_record())), "写周报");
    assert_eq!(snap.status, timer_status::RUNNING);
    assert_eq!(snap.item, "写周报");
    assert_eq!(snap.accumulated_sec, 90);
    /* 原样透传：原生层要用它现算带小数的秒，算好的整秒会让圆点的弧一格一格跳 */
    assert_eq!(snap.running_since, Some(1_700_000_090_000));
    assert_eq!(snap.mode, timer_mode::COUNTUP);
    assert_eq!(snap.target_sec, 0, "正计时的 targetSec 必须是 0，不是 null 之外的任意值");
}

#[test]
fn paused_is_not_shown_as_running() {
    let mut record = running_record();
    record.running_since = None; // 暂停：累计冻结，锚点清空
    let snap = OverlaySnapshot::of(&state_of(timer_status::PAUSED, Some(record)), "写周报");
    assert_eq!(snap.status, timer_status::PAUSED, "暂停的会话仍在库里，状态必须来自 status 而不是 session 的有无");
    assert_eq!(snap.running_since, None);
    assert_eq!(snap.accumulated_sec, 90, "暂停不该清零累计");
}

#[test]
fn countdown_carries_the_target() {
    let mut record = running_record();
    record.mode = timer_mode::COUNTDOWN.to_string();
    record.target_sec = Some(1500);
    let snap = OverlaySnapshot::of(&state_of(timer_status::RUNNING, Some(record)), "番茄");
    assert_eq!(snap.mode, timer_mode::COUNTDOWN);
    assert_eq!(snap.target_sec, 1500);
}

#[test]
fn idle_does_not_keep_the_last_countdown() {
    /* 上一场是倒计时、现在待机：悬浮条上不该出现「倒计时 · 0」 */
    let mut idle = state_of(timer_status::IDLE, None);
    idle.mode = timer_mode::COUNTDOWN.to_string();
    let snap = OverlaySnapshot::of(&idle, "");
    assert_eq!(snap.mode, timer_mode::COUNTUP);
    assert_eq!(snap.target_sec, 0);
}

#[test]
fn missing_item_name_degrades_to_empty() {
    /* 事项被删：`services::overlay_push` 传空串进来，快照不能编一个「未命名」 */
    let snap = OverlaySnapshot::of(&state_of(timer_status::RUNNING, Some(running_record())), "");
    assert!(snap.item.is_empty());
    assert_eq!(snap.status, timer_status::RUNNING, "没名字不等于没在计时");
}

#[test]
fn summary_names_the_state() {
    let snap = OverlaySnapshot::of(&state_of(timer_status::RUNNING, Some(running_record())), "写周报");
    let line = snap.summary();
    assert!(line.contains("running"), "摘要要能看出状态：{line}");
    assert!(line.contains("写周报"), "摘要要带事项名：{line}");
}
