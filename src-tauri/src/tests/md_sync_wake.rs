//! 批 1 · md 链三个触发器的纯判据（PRD C5 / C6 / C7 / C8，设计 §4.2）。
//!
//! 这里**不启动 job**：`jobs::md_sync::decide` 是纯函数，把「200ms 观察圈看到的东西」
//! 喂进去，断言「这一圈跑不跑、下一圈状态是什么」。两条变异自检的靶子都在这个文件：
//! - 把 60s 兜底注释掉 → `c7_bypassed_events_are_corrected_by_the_fallback` 红；
//! - 把 800ms 去抖改成 0 → `c6_five_writes_merge_into_one_round` 红。
//!
//! 文件探测那段单独验「mtime 变了但内容没变不算改动」：这是 K-1 验收清单里
//! 「写前去抖 + 内容/mtime 复核」的机器判据，不靠读代码看一眼。

use std::fs;

use chrono::NaiveDate;

use crate::infra::md_file;
use crate::jobs::md_sync::{decide, FileWatch, WakeReason, WakeState};
use crate::models::constants::{
    MD_SYNC_DEBOUNCE_MS, MD_SYNC_FALLBACK_SECS, MD_SYNC_FILE_TICK_MS, MD_SYNC_WAKE_TICK_MS,
};
use crate::models::md_sync::{MdSyncBinding, MdSyncKind};
use crate::tests::support::unique_dir;

fn state(last_run_ms: i64) -> WakeState {
    WakeState {
        seen_seq: 0,
        last_run_ms,
        file_dirty_since_ms: None,
    }
}

fn today_binding(root: &str) -> MdSyncBinding {
    MdSyncBinding {
        kind: MdSyncKind::Timers,
        enabled: true,
        root: root.to_string(),
        file: "{date}.md".to_string(),
        heading: "#### 事项计时".to_string(),
    }
}

/// §8.1 的十四个常量是唯一出处；本文件用得到的四个先在这里钉住值，
/// 免得有人「顺手调大一点」把 C6/C7 的判据一起改掉还看不出来。
#[test]
fn wake_constants_keep_their_contract_values() {
    assert_eq!(MD_SYNC_WAKE_TICK_MS, 200);
    assert_eq!(MD_SYNC_DEBOUNCE_MS, 800);
    assert_eq!(MD_SYNC_FILE_TICK_MS, 1_500);
    assert_eq!(MD_SYNC_FALLBACK_SECS, 60);
}

/// C6：1 秒内的 5 次写只跑 1 轮，且必须等最后一次写满 800ms。
#[test]
fn c6_five_writes_merge_into_one_round_only_after_the_debounce() {
    let mut current = state(0);
    let mut runs: Vec<i64> = Vec::new();
    /* 200ms 观察圈；最后一次写发生在 t=1000（5 次写都落在这一秒内）。 */
    for now in (1_000..=3_000).step_by(200) {
        let (reason, next) = decide(&current, 5, 1_000, "timer", false, now, true);
        current = next;
        if reason.is_some() {
            runs.push(now);
            current.commit(5, now);
        }
    }
    assert_eq!(
        runs,
        vec![1_800],
        "去抖窗口内不许抢跑，窗口到了只跑 1 轮（把 800ms 改成 0 会变成 1000）"
    );
    assert_eq!(current.seen_seq, 5);
}

/// C6 的另一半：抢不到闸时不许推进 SEQ，用状态表达「还欠一轮」。
#[test]
fn a_missed_gate_keeps_the_signal_pending_until_a_round_really_runs() {
    let pending = state(1_000);
    for now in [2_000, 2_200, 2_400] {
        let (reason, _) = decide(&pending, 3, 1_000, "todo", false, now, true);
        assert_eq!(
            reason,
            Some(WakeReason::Sql("todo")),
            "没跑成 → 每一圈都该继续看到这笔欠账，不许丢信号"
        );
    }
    let mut committed = pending.clone();
    committed.commit(3, 2_400);
    let (after, _) = decide(&committed, 3, 1_000, "todo", false, 2_600, true);
    assert_eq!(after, None, "真的跑完一轮才收账");
}

/// C7：直接改库、绕过命令层 → 没有新 SEQ、没有文件改动，60s 兜底仍要纠正。
#[test]
fn c7_bypassed_events_are_corrected_by_the_fallback() {
    let mut current = state(1_000);
    current.seen_seq = 7; /* 已经处理过的序号；绕过事件时 SEQ 不会再变 */
    let (too_early, _) = decide(&current, 7, 0, "timer", false, 1_000 + 59_000, true);
    assert_eq!(too_early, None, "60 秒之前不许提前跑");
    let (fallback, _) = decide(&current, 7, 0, "timer", false, 1_000 + 61_000, true);
    assert_eq!(
        fallback,
        Some(WakeReason::Fallback),
        "把 60s 兜底注释掉，这条会立刻红"
    );
}

/// C5：总开关关着 → 三个触发全部不跑，连文件改动的账都不记（调用方据此零文件 IO）。
#[test]
fn c5_disabled_switch_blocks_all_three_triggers() {
    let current = state(0);
    let (reason, next) = decide(&current, 99, 5_000, "timer", true, 999_999, false);
    assert_eq!(reason, None);
    assert_eq!(next.file_dirty_since_ms, None);
    assert_eq!(next.seen_seq, 0);
    assert_eq!(next.last_run_ms, 0);
}

/// 外部文件去抖：内容变了之后要再等满 1.5s，期间的新变化把窗口往后推。
#[test]
fn file_changes_are_debounced_for_another_one_and_a_half_seconds() {
    let mut current = state(10_000);
    current.seen_seq = 2;
    let (first, first_next) = decide(&current, 2, 0, "timer", true, 20_000, true);
    assert_eq!(first, None);
    assert_eq!(first_next.file_dirty_since_ms, Some(20_000));
    let (early, _) = decide(&first_next, 2, 0, "timer", false, 21_000, true);
    assert_eq!(early, None, "距最后一次变化还没满 1.5s");
    let (due, _) = decide(&first_next, 2, 0, "timer", false, 21_500, true);
    assert_eq!(due, Some(WakeReason::File));
}

/// 日志词表：五种业务来源 + job 自己的两种，不许渗进用户文案。
#[test]
fn wake_reason_labels_follow_the_log_vocabulary() {
    assert_eq!(WakeReason::Sql("item").label(), "item");
    assert_eq!(WakeReason::File.label(), "file");
    assert_eq!(WakeReason::Fallback.label(), "fallback");
}

/// 写一个文件并把 mtime 钉到指定的整数秒。
///
/// `probe` 的 `(mtime, len)` 快速路径是设计硬要求（形状没变就不读内容），所以三次写
/// 必须落在**不同的毫秒**上，否则「同长度、不同内容」会在读内容之前被跳过，测试退化成
/// 依赖机器计时器粒度的偶发红。`File::set_times` 稳定于 1.75，比 `thread::sleep` 确定；
/// 万一文件系统不让改时间戳，退回等一拍让 OS 自己把 mtime 推过 1ms。
fn write_stamped(path: &std::path::Path, bytes: &[u8], secs: u64) {
    use std::time::{Duration, UNIX_EPOCH};

    fs::write(path, bytes).expect("写文件");
    let at = UNIX_EPOCH + Duration::from_secs(secs);
    let times = fs::FileTimes::new().set_modified(at);
    let applied = fs::OpenOptions::new()
        .write(true)
        .open(path)
        .and_then(|file| file.set_times(times))
        .is_ok();
    if !applied {
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// 内容/mtime 复核：同内容的「无改动保存」不算改动；同长度但内容不同才算。
#[test]
fn file_probe_checks_the_fingerprint_not_just_mtime() {
    let dir = unique_dir("md-wake-fingerprint");
    fs::create_dir_all(&dir).expect("建临时目录");
    let date = NaiveDate::from_ymd_opt(2026, 11, 7).expect("合法日期");
    let binding = today_binding(&dir.to_string_lossy());
    let path = md_file::resolve_path(&binding.root, &binding.file, date);

    let mut watch = FileWatch::default();
    write_stamped(&path, b"first", 1_700_000_000);
    assert!(!watch.probe(std::slice::from_ref(&binding), date), "第一次观测只记基线");

    /* mtime 前移 1 秒而内容逐字未变：必须真的走到指纹比较，判「没变」。 */
    write_stamped(&path, b"first", 1_700_000_001);
    assert!(
        !watch.probe(std::slice::from_ref(&binding), date),
        "mtime 被推了但内容没变，不该跑一轮全量渲染"
    );

    /* mtime 再前移 1 秒、同长度但内容不同：快速路径放行后靠指纹抓到。 */
    write_stamped(&path, b"other", 1_700_000_002);
    assert!(
        watch.probe(std::slice::from_ref(&binding), date),
        "内容真的变了必须被看到"
    );

    fs::remove_dir_all(&dir).ok();
}

/// C8：跨零点后路径换到新的一天，旧文件不再被追加，新文件从自己的基线开始。
#[test]
fn cross_midnight_uses_the_next_days_path() {
    let dir = unique_dir("md-wake-midnight");
    fs::create_dir_all(&dir).expect("建临时目录");
    let day_one = NaiveDate::from_ymd_opt(2026, 11, 7).expect("合法日期");
    let day_two = NaiveDate::from_ymd_opt(2026, 11, 8).expect("合法日期");
    let binding = today_binding(&dir.to_string_lossy());
    let first = md_file::resolve_path(&binding.root, &binding.file, day_one);
    let second = md_file::resolve_path(&binding.root, &binding.file, day_two);
    assert_ne!(first, second, "每轮重算 Local::now().date_naive()，路径必须跟着换");

    let mut watch = FileWatch::default();
    fs::write(&first, b"old").expect("写昨天");
    assert!(!watch.probe(std::slice::from_ref(&binding), day_one));
    fs::write(&second, b"new").expect("写今天");
    assert!(
        !watch.probe(std::slice::from_ref(&binding), day_two),
        "新一天的文件是新路径，第一次观测同样只记基线，不把旧文件当改动"
    );
    fs::remove_dir_all(&dir).ok();
}
