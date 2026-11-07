//! 事件驱动的 Markdown 双向同步（V0.11.19 批 1，设计 §4.1 / §4.2）。
//!
//! ## 为什么还是轮询，不是 `notify`
//!
//! - 不新增平台依赖，Windows / macOS / Linux 行为一致；
//! - Obsidian / VS Code 保存常用「写临时文件再 rename」，文件监听会收到多次事件，
//!   还要自己做去抖；引入 notify 只是把去抖从一处搬到两处；
//! - 判据本来就是「内容 + mtime 复核」，轮询晚 200ms 不会丢改动，只会晚一点看到。
//!
//! 变的是**观察什么**：从「每 `pollSecs` 秒无条件跑一整轮渲染」改成「每 200ms 看一眼
//! 三个触发器的状态」。一年下来省掉的是几千次全量渲染，换来的是「改完 1 秒内落盘」。
//!
//! ## 三个触发器（缺一不可）
//!
//! 1. SQL 业务写入：命令层打标记 → `SEQ` 变 → 最后一次写之后满 800ms 才跑（C6 合并 5 次写）；
//! 2. 外部 md 改动：每 1.5s 读今日落点的 `(mtime, len)`，形状变了再读内容算 FNV 指纹，
//!    指纹确实不同才算「变了」，再等到「距最后一次变化满 1.5s」；
//! 3. 60s 兜底：同步盘回写、rename、时钟跳变、跨零点这四类都不产生可捕获的事件（C7）。
//!
//! **`touch` / 同步盘回写 / 编辑器「无改动保存」只推 mtime 不改内容**，所以第二步的
//! 指纹不是优化而是判据：只看 mtime 会让「只是碰了文件」也跑一轮全量渲染。
//!
//! ## 与云链、托盘共用一把闸
//!
//! 两个 job 与托盘点击都调 `app::tray_sync::try_acquire()`。抢不到就**早退**，不排队、
//! 不 `sleep` 重试（重试路径会在退出时和 `Gate::drop` 打架，见 06-边界）。
//! md 链抢不到时刻意不推进自己见过的 `SEQ` —— 「还欠一轮」由状态表达，200ms 后
//! 下一圈自然会再看到它；消息会丢，状态不会。
//!
//! ## K-1 的既有语义残留
//!
//! 围栏外一行裸 `# 备注` 仍会截断区块、软删 1 条记录（v0.11.18 语义，QA 已用
//! `assert_eq!(soft, 1)` 钉成回归断言）。本轮**不改**这个语义，也不删那条断言。
//! 本 job 能做的是把伤害面压到最小：**写前去抖 + 每轮重新读内容与 mtime 复核**，
//! 绝不拿一份旧快照去写盘 —— 三个触发都只在「确认要跑」之后才进 `md_sync::run`，
//! 而 `run` 内部自己重新读文件、重新取数、重新比基线。

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, UNIX_EPOCH};

use chrono::Local;
use tauri::{AppHandle, Manager};

use crate::app::events;
use crate::infra::md_file;
use crate::models::constants::{
    MD_SYNC_DEBOUNCE_MS, MD_SYNC_FALLBACK_SECS, MD_SYNC_FILE_TICK_MS, MD_SYNC_WAKE_TICK_MS,
};
use crate::models::md_sync::MdSyncBinding;
use crate::platform::clock::{elapsed_since_ms, now_ms};
use crate::services::md_sync;
use crate::state::AppState;

/// 一次文件观测留下的证据。**指纹是内容，不是 mtime**：同一份内容被 `touch` 过不算改动。
#[derive(Debug, Clone, PartialEq, Eq)]
struct FileStamp {
    mtime_ms: i64,
    len: u64,
    fingerprint: String,
}

/// 今日各落点文件的上一份证据。跨零点时 `date` 会变，路径随之变，旧证据自然失效。
/// `pub(crate)` 只为让 `tests/md_sync_wake.rs` 能直接验「mtime 变了但内容没变不算改动」。
#[derive(Debug, Default)]
pub(crate) struct FileWatch {
    seen: HashMap<PathBuf, FileStamp>,
}

impl FileWatch {
    /// 探测一次，返回「内容是否真的变了」。
    ///
    /// 第一次见到某个文件只记基线、不算改动：启动瞬间三个落点都是「新文件」，
    /// 全报成改动会让开机白跑一轮；启动前改过的内容由 60s 兜底吸收。
    /// 文件暂时读不到（正在被编辑器 rename）时**保留**上一份证据，等它回来再比，
    /// 否则「消失又出现」会被当成新文件、把真实改动吞掉。
    pub(crate) fn probe(&mut self, bindings: &[MdSyncBinding], date: chrono::NaiveDate) -> bool {
        let mut changed = false;
        for binding in bindings.iter().filter(|item| item.enabled && item.is_configured()) {
            let path = md_file::resolve_path(&binding.root, &binding.file, date);
            let Ok(meta) = fs::metadata(&path) else {
                continue;
            };
            let shape = (mtime_of(&meta), meta.len());
            let old = self.seen.get(&path);
            if old.is_some_and(|prev| (prev.mtime_ms, prev.len) == shape) {
                continue;
            }
            let Ok(bytes) = fs::read(&path) else {
                continue;
            };
            let fingerprint = crate::services::md_cloud::pending::fingerprint(&bytes);
            let differs = old.is_none_or(|prev| prev.fingerprint != fingerprint);
            let is_baseline = old.is_none();
            self.seen.insert(
                path,
                FileStamp {
                    mtime_ms: shape.0,
                    len: shape.1,
                    fingerprint,
                },
            );
            if differs && !is_baseline {
                changed = true;
            }
        }
        changed
    }
}

fn mtime_of(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|at| at.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |span| span.as_millis() as i64)
}

/// 一轮观察结束后的状态。**`seen_seq` 只在真的跑完一轮之后推进**。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct WakeState {
    pub seen_seq: u64,
    pub last_run_ms: i64,
    pub file_dirty_since_ms: Option<i64>,
}

impl WakeState {
    /// 一轮真的跑完了：把三个触发器一起收账。
    pub fn commit(&mut self, seq_at_run: u64, finished_ms: i64) {
        self.seen_seq = seq_at_run;
        self.last_run_ms = finished_ms;
        self.file_dirty_since_ms = None;
    }
}

/// 这一轮为什么跑。只进日志（§11.3 `md sync wake: reason=...`），不进用户文案。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WakeReason {
    Sql(&'static str),
    File,
    Fallback,
}

impl WakeReason {
    pub fn label(self) -> &'static str {
        match self {
            Self::Sql(reason) => reason,
            Self::File => "file",
            Self::Fallback => "fallback",
        }
    }
}

/// 纯判定：这一圈 200ms 观察要不要跑一轮。**可单测，不碰 IO、不碰全局静态**。
///
/// 三条判据共用同一份 `WakeState`，避免「SQL 那条说欠一轮、文件那条说没欠」这类漂移。
/// 优先级：SQL（去抖）→ 外部文件（去抖）→ 60s 兜底。
/// SQL 还在 800ms 窗口内时**连文件轮与兜底轮都不许抢跑**：否则 1 秒内的 5 次写会
/// 被拆成「文件轮 + SQL 轮」两次，C6 的「只 1 次」就守不住了。
pub(crate) fn decide(
    state: &WakeState,
    seq: u64,
    last_write_ms: i64,
    sql_reason: &'static str,
    file_changed: bool,
    now: i64,
    enabled: bool,
) -> (Option<WakeReason>, WakeState) {
    let mut next = state.clone();
    /* 总开关关着：三个触发全部不跑。调用方据此连文件探测都不做（C5 零文件 IO）。 */
    if !enabled {
        return (None, next);
    }
    if file_changed {
        next.file_dirty_since_ms = Some(now);
    }

    let sql_pending = seq > 0 && seq != next.seen_seq;
    if sql_pending {
        if elapsed_since_ms(now, last_write_ms) >= MD_SYNC_DEBOUNCE_MS as i64 {
            return (Some(WakeReason::Sql(sql_reason)), next);
        }
        return (None, next);
    }
    if let Some(since) = next.file_dirty_since_ms {
        if elapsed_since_ms(now, since) >= MD_SYNC_FILE_TICK_MS as i64 {
            return (Some(WakeReason::File), next);
        }
    }
    /* 60s 兜底：绕过事件直接改库、只改 mtime、同步盘回写、跨零点全靠它纠正。
       注释掉这一段，C7（≤70s 内被兜底扫描纠正）会立刻红。 */
    if elapsed_since_ms(now, next.last_run_ms) >= (MD_SYNC_FALLBACK_SECS * 1000) as i64 {
        return (Some(WakeReason::Fallback), next);
    }
    (None, next)
}

/// 启动事件驱动同步链。首轮不无条件跑：`last_run_ms` 取启动时刻，兜底在 +60s 才到。
pub fn spawn_md_sync_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut state = WakeState {
            last_run_ms: now_ms(),
            ..WakeState::default()
        };
        let mut watch = FileWatch::default();
        let mut last_probe_ms: i64 = 0;
        loop {
            let pool = app.state::<AppState>().pool.clone();
            let now = now_ms();
            let (enabled, bindings) = match md_sync::config::load(&pool).await {
                Ok(config) => (config.enabled, config.bindings),
                Err(err) => {
                    crate::log_warn!("md sync wake: load config failed: {err}");
                    (false, Vec::new())
                }
            };

            /* 只有总开关开着才碰文件：关掉时连 `fs::metadata` 都不许有（C5）。
               文件探测本身按 1.5s 一档，200ms 的观察圈不该反复 stat。 */
            let mut file_changed = false;
            if enabled && elapsed_since_ms(now, last_probe_ms) >= MD_SYNC_FILE_TICK_MS as i64 {
                last_probe_ms = now;
                file_changed = watch.probe(&bindings, Local::now().date_naive());
            }

            let seq = md_sync::dirty::seq();
            let (reason, next) = decide(
                &state,
                seq,
                md_sync::dirty::last_write_ms(),
                md_sync::dirty::last_reason(),
                file_changed,
                now,
                enabled,
            );
            state = next;

            if let Some(reason) = reason {
                /* 与托盘 / 云链共用同一把闸。抢不到就本圈早退，不 sleep 重试；
                   `SEQ` 没推进 → 200ms 后下一圈自然还会看到「还欠一轮」。 */
                if let Some(_gate) = crate::app::tray_sync::try_acquire() {
                    crate::log_info!("md sync wake: reason={}", reason.label());
                    match md_sync::run(&pool).await {
                        Ok(report) => {
                            if report.touched() {
                                events::emit_md_sync_changed(&app, &report);
                            }
                            /* 自己这一轮可能改了 md 文件。立刻重取一次基线，
                               免得下一圈把「我们自己写的 mtime」当成外部改动又跑一轮。 */
                            let _ = watch.probe(&bindings, Local::now().date_naive());
                        }
                        Err(err) => crate::log_warn!("md sync wake failed: {err}"),
                    }
                    state.commit(seq, now_ms());
                }
            }
            tokio::time::sleep(Duration::from_millis(MD_SYNC_WAKE_TICK_MS)).await;
        }
    });
}
