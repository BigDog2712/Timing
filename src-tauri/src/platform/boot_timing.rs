//! 冷启动时序埋点（T17）：只做「打点 + 一次汇总」，不做采样服务。
//!
//! ## 为什么需要
//!
//! 「启动慢」是最容易凭感觉优化的题目：改完 `block_on` 到底快了多少，没有数字就只能猜。
//! 这里给一条最小成本的度量：进程内几处 `mark()`，启动流程结束时汇总成一行日志，
//! 并把每次的总耗时追加到一个 TSV 历史文件，用最近 30 次的 P50/P95 判断退化。
//!
//! ## 口径（写死，避免各版本互相比较时口径漂移）
//!
//! - `setup_ms`：`run()` 入口 → `setup()` 返回。覆盖建库/迁移/托盘/钳制/调度器装配。
//! - `show_ms`：`run()` 入口 → 前端第一次调 `show_window`（真实首帧可见）。
//!   窗口以 `visible:false` 启动防白闪（K-1），所以这条才代表「用户看见」。
//! - 历史文件：`<app_data_dir>/logs/boot-timing.tsv`，每行 `setup_ms\tshow_ms\tdate`，
//!   只在 `logs/` 里、随日志一起被 7 天清理带走，不进数据库（启动路径不碰 SQL）。
//!
//! ## 只观测、不优化
//!
//! ADR 里定的阈值是 **P95 > 300ms 才允许动 `block_on`**。在此之前这条日志的用途
//! 只有两个：确认没退化、出问题时能定位卡在哪一步。

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

/// 参与 P50/P95 的历史样本数（最近 N 次冷启动）。
const HISTORY_WINDOW: usize = 30;
/// 历史文件名。
const HISTORY_FILE: &str = "boot-timing.tsv";

static START: OnceLock<Instant> = OnceLock::new();
static MARKS: Mutex<Vec<(&'static str, u64)>> = Mutex::new(Vec::new());
static DIR: OnceLock<PathBuf> = OnceLock::new();
/// 每个阶段只汇总一次（`show_window` 会被托盘 / 快捷键多次调用，不能每次都记一条）。
static SETUP_REPORTED: AtomicBool = AtomicBool::new(false);
static FRAME_REPORTED: AtomicBool = AtomicBool::new(false);

/// 开始计时。幂等：重复调用不会重置起点（否则会被后续步进拉平）。
pub fn start() {
    START.get_or_init(Instant::now);
}

/// 自 `start()` 起的毫秒数；未 start 时为 0。
pub fn elapsed_ms() -> u64 {
    START
        .get()
        .map(|s| s.elapsed().as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

/// 打一个点。同名标签只保留第一次（先到先得，符合「什么时候到达这一态」的语义）。
pub fn mark(label: &'static str) {
    let at = elapsed_ms();
    let Ok(mut marks) = MARKS.lock() else {
        return;
    };
    if marks.iter().any(|(name, _)| *name == label) {
        return;
    }
    marks.push((label, at));
}

/// 已打的点（按调用顺序）。诊断页 / 测试用。
pub fn marks() -> Vec<(&'static str, u64)> {
    MARKS.lock().map(|m| m.clone()).unwrap_or_default()
}

/// 记录历史文件目录（`<app_data_dir>/logs`）。
pub fn set_dir(dir: &Path) {
    let _ = DIR.set(dir.to_path_buf());
}

/// 最近秩百分位（不插值）。空集合返回 0。
///
/// 用最近秩而不是线性插值：样本只有 30 个，插值出来的「P95」会落在两个真实观测之间，
/// 读起来像是测出来的，其实不是。
pub fn percentile(sorted_asc: &[u64], p: u8) -> u64 {
    if sorted_asc.is_empty() {
        return 0;
    }
    let p = p.clamp(1, 100) as usize;
    // 最近秩：ceil(p/100 * n) - 1，至少取第 1 个
    let rank = (p * sorted_asc.len()).div_ceil(100);
    let idx = rank.saturating_sub(1).min(sorted_asc.len() - 1);
    sorted_asc[idx]
}

/// 一次启动的采样。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Sample {
    pub setup_ms: u64,
    pub show_ms: u64,
}

/// 解析历史 TSV（容忍坏行、空行、注释行）。`show_ms = 0` 表示该次未观测到首帧。
pub fn parse_history(text: &str) -> Vec<Sample> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut it = line.split('\t');
        let (Some(setup), Some(show)) = (it.next(), it.next()) else {
            continue;
        };
        let (Ok(setup), Ok(show)) = (setup.parse::<u64>(), show.parse::<u64>()) else {
            continue;
        };
        out.push(Sample {
            setup_ms: setup,
            show_ms: show,
        });
    }
    out
}

/// 从样本里取「最后 window 条」的 P50/P95。返回 `(setup_p50, setup_p95, show_p50, show_p95, n)`。
///
/// `show_ms = 0` 的样本不参与首帧统计（那一次没观测到，不是 0ms）。
pub fn summarize(samples: &[Sample], window: usize) -> (u64, u64, u64, u64, usize) {
    let recent = if samples.len() > window {
        &samples[samples.len() - window..]
    } else {
        samples
    };
    let mut setup: Vec<u64> = recent.iter().map(|s| s.setup_ms).collect();
    setup.sort_unstable();
    let mut show: Vec<u64> = recent
        .iter()
        .map(|s| s.show_ms)
        .filter(|v| *v > 0)
        .collect();
    show.sort_unstable();
    (
        percentile(&setup, 50),
        percentile(&setup, 95),
        percentile(&show, 50),
        percentile(&show, 95),
        recent.len(),
    )
}

/// 汇总：写一行历史 + 打一条含 P50/P95 的日志。
///
/// `phase` 说明这次汇总是由哪个事件触发的：
/// - `setup`：`setup()` 返回时。此时首帧多半还没到，先把 `setup_ms` 记下来，
///   历史行里的 `show_ms` 先写 0，等首帧到了再原地补上（见下）。
/// - `first_frame`：前端第一次 `show_window`。补 `show_ms` 并输出 P50/P95。
///
/// 这样即便窗口是「隐藏启动」（托盘唤起），也不会丢掉 `setup_ms` 这个样本。
pub fn report(phase: &str) {
    // 一进程一阶段一条：`show_window` 会被托盘 / 快捷键反复调用，不能每次都写一行。
    let first_time = if phase == "first_frame" {
        !FRAME_REPORTED.swap(true, Ordering::SeqCst)
    } else {
        !SETUP_REPORTED.swap(true, Ordering::SeqCst)
    };
    if !first_time {
        return;
    }

    let snap = marks();
    let setup_ms = snap
        .iter()
        .find(|(name, _)| *name == "setup_done")
        .map(|(_, ms)| *ms)
        .unwrap_or_else(elapsed_ms);
    let first_frame = snap
        .iter()
        .find(|(name, _)| *name == "first_frame")
        .map(|(_, ms)| *ms);
    let trail = snap
        .iter()
        .map(|(name, ms)| format!("{name}={ms}ms"))
        .collect::<Vec<_>>()
        .join(" ");

    let mut history: Vec<Sample> = Vec::new();
    if let Some(dir) = DIR.get() {
        let path = dir.join(HISTORY_FILE);
        if let Ok(text) = std::fs::read_to_string(&path) {
            history = parse_history(&text);
        }
        match (phase, first_frame) {
            // 首帧到了：如果上一行是 setup 留下的「待补」记录（show=0），就地补上
            ("first_frame", Some(show)) => {
                if patch_pending_show(dir, show) {
                    if let Some(last) = history.last_mut() {
                        last.show_ms = show;
                    }
                } else {
                    history.push(Sample {
                        setup_ms,
                        show_ms: show,
                    });
                    append_line(dir, setup_ms, show);
                }
                trim_history(dir, HISTORY_WINDOW * 3);
            }
            // setup 已结束但首帧没影（隐藏启动）：先把 setup_ms 记下来占位
            _ => {
                if !append_line(dir, setup_ms, 0) {
                    return;
                }
                history.push(Sample {
                    setup_ms,
                    show_ms: 0,
                });
                trim_history(dir, HISTORY_WINDOW * 3);
            }
        }
    }

    let (s50, s95, f50, f95, n) = summarize(&history, HISTORY_WINDOW);
    crate::log_info!(
        "boot[{phase}] setup={setup_ms}ms first_frame={}ms | trail: {trail} | \
         hist n={n} setup p50={s50}ms p95={s95}ms first_frame p50={f50}ms p95={f95}ms",
        first_frame
            .map(|v| v.to_string())
            .unwrap_or_else(|| "-".into())
    );
}

/// 追加一行历史。成功返回 true。失败静默——埋点不能影响启动。
fn append_line(dir: &Path, setup_ms: u64, show_ms: u64) -> bool {
    let line = format!(
        "{setup_ms}\t{show_ms}\t{}\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M")
    );
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(HISTORY_FILE))
        .and_then(|mut f| f.write_all(line.as_bytes()))
        .is_ok()
}

/// 把历史最后一行的 `show_ms`（当前为 0）补成实测值。成功返回 true。
///
/// 只在「本进程刚写过一行 show=0」时用；找不到可补的行就返回 false，由调用方走追加。
fn patch_pending_show(dir: &Path, show_ms: u64) -> bool {
    let path = dir.join(HISTORY_FILE);
    let Ok(text) = std::fs::read_to_string(&path) else {
        return false;
    };
    let mut lines: Vec<String> = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(String::from)
        .collect();
    let Some(last) = lines.last_mut() else {
        return false;
    };
    let mut cols = last.split('\t');
    let (Some(setup), Some(show)) = (cols.next(), cols.next()) else {
        return false;
    };
    if show != "0" {
        return false; // 已经被补过 / 本来就是完整样本
    }
    let rest: Vec<&str> = cols.collect();
    let setup = setup.to_string();
    *last = if rest.is_empty() {
        format!("{setup}\t{show_ms}")
    } else {
        format!("{setup}\t{show_ms}\t{}", rest.join("\t"))
    };
    std::fs::write(&path, format!("{}\n", lines.join("\n"))).is_ok()
}

/// 历史文件超过 `keep` 行就只保留最后 `keep` 行。失败静默（埋点不能影响启动）。
fn trim_history(dir: &Path, keep: usize) {
    let path = dir.join(HISTORY_FILE);
    let Ok(text) = std::fs::read_to_string(&path) else {
        return;
    };
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.len() <= keep {
        return;
    }
    let tail = &lines[lines.len() - keep..];
    let body = format!("{}\n", tail.join("\n"));
    let _ = std::fs::write(&path, body);
}
