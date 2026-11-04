//! 时间口径测试（v0.3 / T23）：单调时钟优先、墙钟只做持久化。
//!
//! 背景：v0.2 的实时时长完全由墙钟差值算出。系统改时 / NTP 校时 / 时区切换会让
//! 读数前跳或回拨（回拨时 `delta <= 0` 还会静默吞掉一段）。这里锁死两条不变量：
//! 1. 有锚点时，**墙钟怎么跳都不影响** live 时长；
//! 2. 没锚点时（进程重启 / 直接构造的记录），退回墙钟差值——行为与旧版一致。

use crate::models::enums::timer_mode;
use crate::models::record::TimeRecord;
use crate::platform::clock;
use crate::services::timer;

/// 锚点是进程级单例：本文件的用例必须串行，否则一个用例的 `clear_anchor`
/// 会把另一个用例的锚点抹掉（表现为随机失败）。`cargo test` 默认多线程跑。
static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn serial() -> std::sync::MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(|poison| poison.into_inner())
}

fn record(running_since: Option<i64>, accumulated_sec: i64, item_id: i64) -> TimeRecord {
    let start = running_since.unwrap_or(1_700_000_000_000);
    TimeRecord {
        id: 1,
        item_id,
        status: "active".to_string(),
        started_at: start,
        ended_at: None,
        accumulated_sec,
        running_since,
        note: None,
        mode: timer_mode::COUNTUP.to_string(),
        target_sec: None,
    }
}

/// 墙钟前跳 1 小时：有锚点时不计入。
#[test]
fn wall_clock_jump_forward_is_ignored_while_anchored() {
    let _guard = serial();
    let wall = clock::now_ms();
    clock::anchor(wall);
    let rec = record(Some(wall), 10, 1);

    let jumped = wall + 3_600_000;
    assert_eq!(
        timer::live_duration(&rec, jumped),
        10,
        "锚点存在时，墙钟前跳不得被算成时长"
    );
    clock::clear_all_anchors();
}

/// 墙钟回拨 1 小时：不回退、也不丢已累计的秒数。
#[test]
fn wall_clock_jump_backward_keeps_accumulated() {
    let _guard = serial();
    let wall = clock::now_ms();
    clock::anchor(wall);
    let rec = record(Some(wall), 10, 1);

    let rolled_back = wall - 3_600_000;
    assert_eq!(
        timer::live_duration(&rec, rolled_back),
        10,
        "锚点存在时，回拨不得让时长变负或倒退"
    );
    clock::clear_all_anchors();
}

/// 无锚点（进程重启 / 测试构造）：退回墙钟差值，与 v0.2 行为一致。
#[test]
fn falls_back_to_wall_clock_without_anchor() {
    let _guard = serial();
    clock::clear_all_anchors();
    let wall = clock::now_ms();
    let rec = record(Some(wall), 10, 1);
    assert_eq!(timer::live_duration(&rec, wall + 5_000), 15);
}

/// 锚点属于另一个会话（墙钟值不匹配）：不得误用，退回墙钟。
#[test]
fn mismatched_anchor_is_not_reused() {
    let _guard = serial();
    let anchor_wall = clock::now_ms();
    clock::anchor(anchor_wall);
    let other = anchor_wall - 60_000; // 另一个会话的 running_since
    let rec = record(Some(other), 0, 1);
    assert_eq!(
        timer::live_duration(&rec, other + 7_000),
        7,
        "锚点墙钟与会话起点不一致时必须回落到墙钟，否则两个会话会互相串账"
    );
    clock::clear_all_anchors();
}

/// 暂停态（running_since=None）：live 恒等于 accumulated，与时钟无关。
#[test]
fn paused_record_ignores_clocks() {
    let _guard = serial();
    let rec = record(None, 42, 1);
    assert_eq!(timer::live_duration(&rec, 0), 42);
    assert_eq!(timer::live_duration(&rec, i64::MAX / 2), 42);
}

/// 单调锚点本身：刚锚定时流逝接近 0；sleep 后单调增长。
#[test]
fn anchored_elapsed_is_monotonic() {
    let _guard = serial();
    let wall = clock::now_ms();
    clock::anchor(wall);
    let first = clock::anchored_elapsed_ms(wall).expect("锚点应命中");
    assert!(
        (0..100).contains(&first),
        "刚锚定的流逝应接近 0，实际 {first}ms"
    );
    std::thread::sleep(std::time::Duration::from_millis(30));
    let second = clock::anchored_elapsed_ms(wall).expect("锚点应命中");
    assert!(second >= first, "单调时钟不得回退");
    clock::clear_all_anchors();
    assert!(clock::anchored_elapsed_ms(wall).is_none(), "清空后不应命中");
}
