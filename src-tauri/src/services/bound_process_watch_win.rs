//! `bound_process_watch` 的 Win32 侧：开句柄 + 阻塞等待进程退出。
//!
//! ## 为什么是 `WaitForSingleObject` 带超时，而不是「每 N 秒枚举一次进程」
//!
//! 带超时的 `WaitForSingleObject` 是**内核阻塞**：没退出时线程睡在内核里，不占 CPU，
//! 每个等待片只有一次 syscall（500ms 一片 = 每秒两次）。而进程一退出，句柄立刻被 signal，
//! 调用当场返回 —— 检测延迟 ≤500ms，开销与「5 秒轮询一次」同级。
//!
//! 对照两个没选的方案：
//!   · **Toolhelp 快照按 exe 名比对**：每次要遍历全表（本机 ~250 进程），比一次
//!     `WaitForSingleObject` 贵一个数量级；而且**不区分同名双开**，PID 复用还会误判
//!     「还活着」。线程/CPU 开销是省不掉的。
//!   · **`sysinfo`**：本仓没有这个依赖（`Cargo.lock` 里 0 命中），引入即多一个编译单元，
//!     而它内部同样是枚举快照 —— 同名与 PID 复用两个毛病一个都不解决。
//!   · **`RegisterWaitForSingleObject` 回调**：延迟 0，但回调跑在系统线程池里、要再桥回
//!     tokio，还要管 `UnregisterWaitEx` 与句柄生命周期。用户已接受「最多几十秒」，
//!     为把 500ms 变成 0ms 付这些复杂度不划算。
//!
//! ## 句柄绑的是「进程对象」，所以同名双开与 PID 复用天然正确
//!
//! 打开时用的是**前台窗口那个 pid**（`ForegroundWindow.process_id`），不是 exe 名：
//!   · 同时开两个同名 exe → 盯的就是用户刚切过去的那一个，另一个退出不影响；
//!   · pid 被系统复用 → 句柄绑在内核的进程对象上，旧对象销毁时才 signal，
//!     复用的新进程**不会**把等待解除。`creation_token` 是第二道闸（见下）。

/* 只有 `#[cfg(test)]` 的 `drop_marker` 用得到：生产构建里没有这个字段。
   不加 cfg 就是「lib 编译报未使用、test 编译报找不到」两头挨打。 */
#[cfg(test)]
use std::sync::atomic::AtomicUsize;
use std::sync::Arc;

use windows::Win32::Foundation::{HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows::Win32::System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE};

use crate::infra::activity::windows::foreground;
use crate::infra::activity::windows::handles::OwnedHandle;

use super::WatchRegistry;

/// 一个等待片的长度。500ms 的理由：用户已接受「最多几十秒」，但把过账误差压到
/// 半秒之后，它落在「分钟粒度界面里看不见」的量级，也远低于 `min_record_seconds`
/// 的 30 秒阈值 —— 于是「用检测时刻当结束点」不再需要给 `timer_stop` 开 `at_ms` 注入口。
const WAIT_SLICE_MS: u32 = 500;

/// 等待的三种结局。**`Failed` 也走收尾**（调用方只记日志、不动计时），
/// 因为「一直等下去」会在句柄失效时变成一个永远不退出的线程。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExitOutcome {
    /// 进程真的退出了。
    Exited,
    /// 注册已被替换或被清除：本次没有资格收尾。
    Superseded,
    /// `WaitForSingleObject` 报错（句柄失效等）。
    Failed,
}

/// 一个 `PROCESS_SYNCHRONIZE` 句柄。`Drop` 由 `OwnedHandle` 负责 `CloseHandle`。
pub struct ProcessHandle {
    handle: OwnedHandle,
    /// 仅用例使用：证明 `Drop` 真的跑了（= `CloseHandle` 紧随其后）。
    /// 生产构建里这个字段不存在，零成本。
    #[cfg(test)]
    drop_marker: Option<Arc<AtomicUsize>>,
}

impl ProcessHandle {
    /// 打开一个可等待的句柄。`None` = 打不开（进程已退出 / 权限不足 / pid 非法）。
    ///
    /// **打不开就当作「已经退出」**，由调用方决定不注册 —— 绝不拿失败句柄去等，
    /// 那会立刻 signal 或永远不 signal，两种都是错的。
    pub fn open(process_id: u32) -> Option<Self> {
        if process_id == 0 {
            return None;
        }
        let raw: HANDLE =
            unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, process_id) }.ok()?;
        Some(Self {
            handle: OwnedHandle::new(raw)?,
            #[cfg(test)]
            drop_marker: None,
        })
    }

    pub fn raw(&self) -> HANDLE {
        self.handle.raw()
    }

    /// 用例专用：让这个句柄的 `Drop` 计数（断言「替换之后旧句柄被关」）。
    #[cfg(test)]
    pub fn track_drop(&mut self, marker: Arc<AtomicUsize>) {
        self.drop_marker = Some(marker);
    }
}

impl Drop for ProcessHandle {
    fn drop(&mut self) {
        /* 字段的 `Drop`（`OwnedHandle` → `CloseHandle`）在本体之后由 drop glue 执行，
           所以计数的含义是「本次析构真的发生」，关闭紧随其后、同一个析构里完成。 */
        #[cfg(test)]
        if let Some(marker) = self.drop_marker.as_ref() {
            marker.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
    }
}

/* SAFETY: `HANDLE` 是内核句柄，Win32 语义下**全进程有效**：句柄值不含线程亲和性，
   `CloseHandle` 可以在任意线程调用。搬运到等待线程（`std::thread::spawn` /
   `spawn_blocking`）正是这条链路的设计 —— 「返回即析构，线程退出与句柄回收是同一件事」。
   字段里没有别的裸指针（`drop_marker` 是 `Arc<AtomicUsize>`，本身 `Send`）。 */
unsafe impl Send for ProcessHandle {}

/// 进程创建时刻（100ns 单位的 FILETIME 原值）。
///
/// 第二道闸：句柄已经能防 PID 复用，这个值给日志与用例一个可比对的身份，
/// 也顺手覆盖「注册被复用同一 pid 的新进程误命中」这种理论场景。
/// 唯一口径是 `foreground::process_identity`（它改 [`pub`] 只为这一处调用，
/// **不许**再写第二份 `OpenProcess` 取身份的实现）。
/* 产品路径只用句柄等待，不读身份；这条是给用例的第二道闸读数口。 */
#[cfg_attr(not(test), allow(dead_code))]
pub fn creation_token(process_id: u32) -> Option<u64> {
    foreground::process_identity(process_id).map(|(created, _path)| created)
}

/// 阻塞等待进程退出或被取代。**消费 `handle`**：返回即析构（句柄回收），
/// 这条签名本身就保证不会有「等待线程退出了但句柄还挂着」的泄漏。
pub fn wait_for_exit(
    handle: ProcessHandle,
    generation: u64,
    registry: Arc<WatchRegistry>,
) -> ExitOutcome {
    loop {
        /* 代数先于等待：注册被替换之后连一次多余的等待片都不该付。 */
        if registry.generation() != generation {
            return ExitOutcome::Superseded;
        }
        match unsafe { WaitForSingleObject(handle.raw(), WAIT_SLICE_MS) } {
            WAIT_OBJECT_0 => return ExitOutcome::Exited,
            WAIT_TIMEOUT => continue,
            /* 包括 `WAIT_ABANDONED` / `WAIT_FAILED`：都不该重试，否则句柄失效时死循环。 */
            _ => return ExitOutcome::Failed,
        }
    }
}
