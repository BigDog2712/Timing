//! 「绑定的应用进程退出 → 结束这一段自动接管开出来的计时」（[0.13] 主人口径）。
//!
//! ## 口径（改之前先读）
//!
//! 用户原话裁定：「**在后台继续计时，应用退出进程才结束**」。所以：
//!   · 最小化 / 被别的窗口盖住 / 切到别处 —— **一律不停**（今天也没有这种逻辑，别加）；
//!   · 那个 exe 的**进程真的退出了** —— 结束当前这一段。
//!
//! 这条裁定排除了「失去前台焦点就停」，因此必须做进程存活检测：前台窗口
//! (`infra::insight::windows::foreground`) 只能告诉我们「现在哪个应用在最前面」，
//! 而「被盖住」与「已退出」在它眼里是同一件事（都变成别的 exe，或者桌面壳的空 exe）。
//!
//! ## 为什么是段级校验，不是事项级
//!
//! 自动接管与用户手动开始，在库里**完全同形**：`time_records` 没有 `source` / `reason` /
//! `auto` 列（见 `migrations/0001_init.sql` 与 `infra/migrate.rs` 的历次加列），
//! `timer_ops.kind` 是闭集 `('start','pause','resume','stop','adjust','drop')`，
//! `payload` 只装 `mode` / `target_sec`。所以「这次是不是我自动开的」只能**在运行时记住**，
//! 不能靠读库分辨。
//!
//! 反过来，只比 `item_id` 会出事：用户手动开始事项 X（X 上有上一次注册的残留）→
//! 那个应用退出 → 用户手动那一段被停掉。用户没有任何操作却丢了一段计时，且零报错。
//!
//! 所以注册表记的是**段**（`time_records.started_at`），比对时必须比到段。
//! 段对不上就**只清注册表、不动计时**。
//!
//! ## 为什么用 `started_at` 做段的身份
//!
//! 三条性质合起来够用，且它是 `TimerState.session` 里前端唯一拿得到的「段」字段
//! （`TimeRecord` 没有 `uid`）：
//!   1. `uq_records_open`（`0001_init.sql:67-68`）保证全局最多一条 `status='active'`，
//!      所以「当前段」有唯一答案；
//!   2. `started_at` 只在 `insert_active` / `insert_active_countdown` 写入，之后
//!      `pause` / `resume` / `set_item_id` / `set_accum_and_running` 都不碰它 ——
//!      暂停后继续仍是同一段，符合「一段」的语义；
//!   3. `switch` 的 `end_and_start` 会开一条新记录，新记录的 `started_at` 就是那一刻。
//!
//! 已知残余风险（写在这里，不藏着）：同一事项「停掉 → 同一毫秒内重新开始」时两段的
//! `started_at` 会相等，一个陈旧注册可能误判成同一段。要彻底消除得把 `time_records.id`
//! 也带进载荷；本轮按契约只传 `segmentStartedAt`，不在契约里扩字段。
//!
//! ## 桌面独占
//!
//! 安卓端没有任何前台应用 / 进程枚举能力（`services::insight` 整棵是 `#[cfg(desktop)]`，
//! `commands/window_cmd_mobile.rs` 的 `get_foreground_window` 是 `Ok(None)` 桩），
//! 所以安卓端**看不到任何变化** —— 不是「已适配」，是「本来就没有这个能力」。
//!
//! ## 注册表为什么不落库
//!
//! 它是一个**进程生命周期内的临时事实**（「我刚自动开了这一段，盯一下那个 pid」）。
//! 落库会引出「上次异常退出留下的陈旧注册要不要恢复」这种没有正确答案的问题；不落库时，
//! 进程重启后注册表自然为空 —— 与「重启后不再自动结束任何东西」这个可预期行为一致。

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use sqlx::SqlitePool;

use crate::repositories::record_session as session;

/// 一段的身份：事项 + 段起点。
///
/// 只用它做**判等**，不带任何别的语义。`started_at` 的口径见模块头「为什么用
/// `started_at` 做段的身份」。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SegmentRef {
    pub item_id: i64,
    pub started_at: i64,
}

/// 一条「盯住这个进程，它退出就结束这一段」的注册。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Registration {
    pub segment: SegmentRef,
    pub process_id: u32,
    /// 注册时的代数。等待线程只在自己仍是当代时才有资格收尾。
    pub generation: u64,
}

/// 一次注册的结果 / 一次收尾的结果 —— 命令层据此决定要不要发同步信号与广播。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SettleOutcome {
    /// 段对得上，已经结束这一段。
    Stopped {
        record_id: i64,
        /// 低于「最短记录时长」被软删（口径同 `StopResult.discarded`）。
        discarded: bool,
    },
    /// 注册已被替换或被清除：这个线程没有资格动计时。
    Superseded,
    /// 段已经变了（用户手动切走 / 手动结束 / 换了一段）：只清注册表。
    SegmentMismatch,
    /// 读库或停表失败。调用方只记日志，不重试（下一次注册会自然覆盖）。
    Failed(String),
}

/// 注册表。**不是全局单例本身**：单例见 `global()`。
///
/// 做成结构体而不是一堆 `static`，是为了让用例能各建一份：
/// `cargo test` 在同一个进程里并行跑用例，共享一个 `static` 必然互相踩。
pub struct WatchRegistry {
    /// 每次注册 / 清除 +1。等待线程用它判断「我还是不是当代」。
    generation: AtomicU64,
    registration: Mutex<Option<Registration>>,
}

impl WatchRegistry {
    pub fn new() -> Self {
        Self {
            generation: AtomicU64::new(0),
            registration: Mutex::new(None),
        }
    }

    /// 注册（或替换）一条，返回这次注册的代数。
    ///
    /// 替换会**顶掉**旧注册：旧等待线程下一轮看到代数不符就自行退出（≤500ms）。
    pub fn register(&self, segment: SegmentRef, process_id: u32) -> u64 {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let mut slot = self.lock();
        *slot = Some(Registration {
            segment,
            process_id,
            generation,
        });
        generation
    }

    /// 清除注册（`None` 那条契约）。同样推进代数，让在等的线程退出。
    pub fn clear(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        *self.lock() = None;
    }

    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    /// 当前的注册（只读快照；用例断言与日志用）。
    /* 生产路径不读这张快照（收尾走 `take_if_current` 的消费语义），只给用例断言与
       日志留读数口；`not(test)` 豁免是为了不让「用例专用」变成 lib 编译告警。 */
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn snapshot(&self) -> Option<Registration> {
        self.lock().clone()
    }

    /// 只有**当代**的线程能取走注册：取走即消费，保证同一段不会被收尾两次。
    ///
    /// 代数不符时返回 `None` 且**不清**注册表 —— 那时注册表属于新主人，清掉就是
    /// 「新注册被旧线程顺手删了」，症状是这次接管再也不会结束。
    pub fn take_if_current(&self, generation: u64) -> Option<Registration> {
        if self.generation() != generation {
            return None;
        }
        let mut slot = self.lock();
        match slot.as_ref() {
            Some(registration) if registration.generation == generation => slot.take(),
            _ => None,
        }
    }

    /// 锁中毒不 panic：注册表只是一条提示，读到脏值最多多停一次或少停一次，
    /// 而 `panic = "abort"`（`Cargo.toml` 的 release profile）下 panic 直接杀进程。
    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Registration>> {
        self.registration
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Default for WatchRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// 进程级单例（命令层用它；用例一律自己 `new()`，不碰这里）。
fn global_registry() -> &'static Arc<WatchRegistry> {
    static REGISTRY: OnceLock<Arc<WatchRegistry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Arc::new(WatchRegistry::new()))
}

/// 借一份全局注册表（`wait_for_exit` 要 `Arc`，因为它要被搬进线程）。
pub fn global_arc() -> Arc<WatchRegistry> {
    Arc::clone(global_registry())
}

/// 判据：**纯函数**，不碰线程、不碰 Win32、不碰库。
///
/// 四条主线（见 `bound_process_watch_tests.rs` 的矩阵）：有注册 + 段全对 → `true`；
/// 事项错 → `false`；事项对但段错 → `false`；无注册 → `false`。
///
/// `current` 为 `None` = 当前没有 active 会话（用户已经手动结束了）：那时不该再动它，
/// 所以也是 `false` —— 但注册表要不要清由调用方决定（`settle_after_exit` 清）。
pub fn should_stop(registration: Option<&Registration>, current: Option<SegmentRef>) -> bool {
    let (Some(registration), Some(current)) = (registration, current) else {
        return false;
    };
    registration.segment == current
}

/// 进程退出之后的收尾。**先校验段，再停表**。
///
/// 只做「判据 + 停表」两件事；`dirty::mark` 与 `emit_timer_state` 由命令层补
/// （L8：业务写入信号只允许出现在 `src-tauri/src/commands/`）。
pub async fn settle_after_exit(
    pool: &SqlitePool,
    registry: &WatchRegistry,
    generation: u64,
) -> SettleOutcome {
    let Some(registration) = registry.take_if_current(generation) else {
        return SettleOutcome::Superseded;
    };
    let active = match session::find_active(pool).await {
        Ok(active) => active,
        Err(error) => return SettleOutcome::Failed(error.to_string()),
    };
    let current = active.as_ref().map(|record| SegmentRef {
        item_id: record.item_id,
        started_at: record.started_at,
    });
    if !should_stop(Some(&registration), current) {
        return SettleOutcome::SegmentMismatch;
    }
    match crate::services::timer::stop(pool).await {
        Ok(result) => SettleOutcome::Stopped {
            record_id: result.record.id,
            discarded: result.discarded,
        },
        Err(error) => SettleOutcome::Failed(error.to_string()),
    }
}

/* ---- Win32 侧：打开句柄 + 阻塞等待 ----------------------------------------
   桌面非 Windows 走空实现：`open` 恒 `None`（于是永远不注册、永远不停表）。
   这一支在本仓其实到不了 —— `infra::insight` 整个子树（含 `foreground`）已经
   无条件 `use windows::`，桌面非 Windows 根本编不过。留着只是为了「模块自己不漏
   平台假设」，不是可达路径。 */
#[cfg(windows)]
#[path = "bound_process_watch_win.rs"]
mod win;
#[cfg(not(windows))]
mod win {
    use std::sync::Arc;

    use super::WatchRegistry;

    /// 打开失败 = 不注册。非 Windows 恒失败。
    #[derive(Debug)]
    pub struct ProcessHandle;

    impl ProcessHandle {
        pub fn open(_process_id: u32) -> Option<Self> {
            None
        }
    }

    /// 进程创建时刻（防 PID 复用）。非 Windows 没有这个概念。
    pub fn creation_token(_process_id: u32) -> Option<u64> {
        None
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum ExitOutcome {
        Exited,
        Superseded,
        Failed,
    }

    /// 非 Windows：立刻判「等待失败」，调用方因此不会收尾。
    pub fn wait_for_exit(
        _handle: ProcessHandle,
        _generation: u64,
        _registry: Arc<WatchRegistry>,
    ) -> ExitOutcome {
        ExitOutcome::Failed
    }
}

pub use win::{wait_for_exit, ExitOutcome, ProcessHandle};
/* 第二道闸的读数口：产品路径不调它（句柄本身已防 pid 复用），用例要断言
   「拿得到身份」。分开 re-export 才能只豁免这一个名字的未使用告警。 */
#[cfg_attr(not(test), allow(unused_imports))]
pub use win::creation_token;
