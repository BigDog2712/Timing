//! `bound_process_watch` 的**纯判据**与**替换语义**（不需要子进程与数据库的部分）。
//!
//! 真进程端到端（真 spawn / 真句柄 / 真停表）在 `bound_process_watch_win_tests.rs`。
//!
//! ## 本文件的两条主线
//!
//!   1. **纯函数矩阵**：`should_stop` 四条 —— 独立于线程与 Win32 存在。这条决定
//!      「应用退出时该不该停」，判错一次就是「用户手动计的时被一个应用退出停掉」。
//!   2. **替换不泄漏**：连续注册两个 pid → 旧等待线程必须自行退出（代数生效），
//!      旧句柄必须被关闭（`Drop` 真的跑了）。
//!
//! ## 为什么句柄打不开也照样能测
//!
//! 子进程是用 `std::process::Child` 起的，父进程（本测试进程）因此一直握着它的进程句柄，
//! 内核的进程对象在 `Child` 被 drop 之前不会被回收。所以哪怕子进程已经退出，
//! `OpenProcess` 仍然成功，`WaitForSingleObject` 立刻 signal —— 用例不依赖「子进程活多久」
//! 这个不确定量。

use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use crate::services::bound_process_watch::{
    should_stop, wait_for_exit, ExitOutcome, ProcessHandle, Registration, SegmentRef,
    WatchRegistry,
};

/// 起一个短命子进程（`ping -n 4` 约 3 秒；没有 `ping` 时 `cmd` 秒退，两种都可接受）。
///
/// 刻意**不**断言它活多久：本文件所有用例的正确性只依赖「父进程握着它的句柄」。
fn spawn_child() -> Child {
    Command::new("cmd.exe")
        .args(["/C", "ping", "-n", "4", "127.0.0.1"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("应能起一个短命子进程（沙箱禁止 spawn 时这一行会 panic，见文件头）")
}

fn registration(item_id: i64, started_at: i64, process_id: u32, generation: u64) -> Registration {
    Registration {
        segment: SegmentRef {
            item_id,
            started_at,
        },
        process_id,
        generation,
    }
}

/* ---------------------------------------------------------------------------
   ① 纯函数矩阵
   --------------------------------------------------------------------------- */

#[test]
fn bound_process_should_stop_requires_item_and_segment_to_both_match() {
    let registered = registration(7, 1_000, 42, 1);

    /* 事项对 + 段对：这是唯一该停的情形 */
    assert!(should_stop(
        Some(&registered),
        Some(SegmentRef {
            item_id: 7,
            started_at: 1_000,
        })
    ));

    /* 事项错：用户手动开了别的事项，不该被这个应用的退出停掉 */
    assert!(!should_stop(
        Some(&registered),
        Some(SegmentRef {
            item_id: 8,
            started_at: 1_000,
        })
    ));

    /* 事项对但段错：同一事项的新一段——**这条就是「只比 item_id」会漏的那个洞** */
    assert!(!should_stop(
        Some(&registered),
        Some(SegmentRef {
            item_id: 7,
            started_at: 2_000,
        })
    ));

    /* 无注册：手动开始的计时永远不该被这条链路碰 */
    assert!(!should_stop(
        None,
        Some(SegmentRef {
            item_id: 7,
            started_at: 1_000,
        })
    ));

    /* 无 active 会话（用户已经手动结束）：没有可停的东西 */
    assert!(!should_stop(Some(&registered), None));
}

#[test]
fn bound_process_registry_supersedes_older_generation_without_stealing_the_new_one() {
    let registry = WatchRegistry::new();
    let first = registry.register(SegmentRef { item_id: 1, started_at: 10 }, 100);
    let second = registry.register(SegmentRef { item_id: 2, started_at: 20 }, 200);

    assert_ne!(first, second, "每次注册都必须推进代数");
    assert_eq!(registry.generation(), second);
    assert_eq!(registry.snapshot().expect("有注册").process_id, 200);

    /* 旧代数取不走 —— 而且**不许**顺手把新注册清掉（那会让这次接管永远不结束） */
    assert!(registry.take_if_current(first).is_none());
    assert_eq!(registry.snapshot().expect("新注册必须还在").process_id, 200);

    /* 当代取得走，取走即消费（同一段不会被收尾两次） */
    assert!(registry.take_if_current(second).is_some());
    assert!(registry.snapshot().is_none());
}

/* ---------------------------------------------------------------------------
   ② 替换不泄漏
   --------------------------------------------------------------------------- */

#[test]
fn bound_process_replacement_retires_the_old_thread_and_closes_its_handle() {
    let registry = Arc::new(WatchRegistry::new());

    let first_child = spawn_child();
    let mut first_handle = ProcessHandle::open(first_child.id()).expect("OpenProcess 应成功");
    let dropped = Arc::new(AtomicUsize::new(0));
    first_handle.track_drop(Arc::clone(&dropped));
    let first_generation = registry.register(
        SegmentRef { item_id: 1, started_at: 10 },
        first_child.id(),
    );

    let old_registry = Arc::clone(&registry);
    let old_thread =
        std::thread::spawn(move || wait_for_exit(first_handle, first_generation, old_registry));

    /* 注册被替换（用户切到了另一个绑定应用） */
    let second_child = spawn_child();
    let second_handle = ProcessHandle::open(second_child.id()).expect("OpenProcess 应成功");
    let second_generation = registry.register(
        SegmentRef { item_id: 2, started_at: 20 },
        second_child.id(),
    );

    let old_outcome = old_thread.join().expect("旧线程应正常结束，而不是卡住");
    assert_eq!(
        old_outcome,
        ExitOutcome::Superseded,
        "代数变了，旧线程必须自行退出（否则句柄与线程会一直挂着）"
    );
    assert_eq!(
        dropped.load(Ordering::SeqCst),
        1,
        "旧句柄必须被关闭：`wait_for_exit` 消费 `ProcessHandle`，返回即析构"
    );
    assert_eq!(
        registry.snapshot().expect("新注册还在").generation,
        second_generation
    );

    /* 收尾：清掉注册，让第二个线程也退出，别把线程留给下一个用例 */
    registry.clear();
    let new_registry = Arc::clone(&registry);
    let new_thread =
        std::thread::spawn(move || wait_for_exit(second_handle, second_generation, new_registry));
    assert_eq!(
        new_thread.join().expect("新线程也应正常结束"),
        ExitOutcome::Superseded,
        "清除同样推进代数"
    );

    drop(first_child);
    drop(second_child);
}
