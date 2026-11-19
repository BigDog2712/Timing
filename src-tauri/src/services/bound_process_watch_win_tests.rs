//! `bound_process_watch` 的**真进程端到端**：退出 → 结束这一段；失配 → 绝不碰计时。
//!
//! 纯判据矩阵与替换不泄漏在 `bound_process_watch_tests.rs`。
//!
//! ## 本文件的两条主线
//!
//!   1. **真实进程**：真的 spawn 一个子进程、真的用 `OpenProcess` + `WaitForSingleObject`
//!      等它退出、真的把库里的计时停掉。**不许拿 mock 句柄代替** —— 那等于只证了纯函数，
//!      Win32 那一段一行都没跑。
//!   2. **失配不停**：注册的是 A 段，等到进程退出时当前 active 已经换成 B 段 →
//!      计时**必须没被停**，注册表**必须被清**。这条是「段级校验」的靶子。

use std::process::{Child, Command, Stdio};
use std::sync::Arc;

use crate::services::bound_process_watch::{
    creation_token, wait_for_exit, ExitOutcome, ProcessHandle, SegmentRef, SettleOutcome,
    WatchRegistry,
};
use crate::tests::support::fresh_pool;

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

/* ---------------------------------------------------------------------------
① 真实进程：退出 → 结束这一段
--------------------------------------------------------------------------- */

#[tokio::test]
async fn bound_process_real_exit_ends_the_auto_started_segment() {
    let pool = fresh_pool("bound-watch-stop").await;
    /* 阈值降到 0：让这一段是一次**保存**，而不是被 `min_record_seconds`(默认 30s) 丢弃。
    `discarded` 的语义另有专属用例（`timer_threshold`），别在这里混着证。 */
    crate::repositories::settings::set_value(&pool, "timing.min_record_seconds", "0", 1)
        .await
        .expect("写设置");

    let record = crate::services::timer::start(&pool, Some(1))
        .await
        .expect("种子事项 1 应能开始计时");
    assert!(record.running_since.is_some(), "start 之后必须是计时中");

    let child = spawn_child();
    let process_id = child.id();
    let handle = ProcessHandle::open(process_id).expect("父进程握着句柄，OpenProcess 应成功");
    assert!(
        creation_token(process_id).is_some(),
        "创建时刻要拿得到（PID 复用的第二道闸）"
    );

    let registry = Arc::new(WatchRegistry::new());
    let generation = registry.register(
        SegmentRef {
            item_id: 1,
            started_at: record.started_at,
        },
        process_id,
    );

    let wait_registry = Arc::clone(&registry);
    let outcome =
        tokio::task::spawn_blocking(move || wait_for_exit(handle, generation, wait_registry))
            .await
            .expect("等待线程不应 panic");
    assert_eq!(outcome, ExitOutcome::Exited, "子进程退出必须被判成 Exited");

    let settle =
        crate::services::bound_process_watch::settle_after_exit(&pool, &registry, generation).await;
    match settle {
        SettleOutcome::Stopped {
            record_id,
            discarded,
        } => {
            assert_eq!(record_id, record.id, "结束的必须是刚才那一段");
            assert!(!discarded, "阈值已设 0，不该被丢弃");
        }
        other => panic!("段对得上时必须结束这一段，实际 {other:?}"),
    }

    let state = crate::services::timer::state(&pool).await.expect("读状态");
    assert_eq!(state.status, "idle", "用户看到的必须是「停了」");
    assert!(state.session.is_none());
    assert!(registry.snapshot().is_none(), "收尾后注册表必须清空");

    drop(child);
}

/* ---------------------------------------------------------------------------
② 失配不停：注册着 A 段，退出时当前已经是 B 段
--------------------------------------------------------------------------- */

#[tokio::test]
async fn bound_process_exit_does_not_stop_a_different_segment_on_the_same_item() {
    let pool = fresh_pool("bound-watch-mismatch").await;
    /* 阈值不动（默认 30s）：这一段本来就短，无论如何都进不了记录列表——
    本用例只看「有没有被停」，不看落库形态。 */
    let first = crate::services::timer::start(&pool, Some(1))
        .await
        .expect("开始第一段");

    let child = spawn_child();
    let process_id = child.id();
    let handle = ProcessHandle::open(process_id).expect("OpenProcess 应成功");

    let registry = Arc::new(WatchRegistry::new());
    let generation = registry.register(
        SegmentRef {
            item_id: 1,
            started_at: first.started_at,
        },
        process_id,
    );

    /* 用户手动换了一段：先 pause 再 end_and_start（与 `startOrSwitch` 同一条路径）。
    关键点是**同一事项**也照样换段 —— 段级校验就是为了这个。 */
    let other_item = crate::services::item::create(&pool, "另一件事", None)
        .await
        .expect("建事项");
    crate::services::timer::pause(&pool)
        .await
        .expect("分段前必须非运行中");
    crate::services::timer::switch(
        &pool,
        other_item.id,
        crate::models::enums::SwitchMode::EndAndStart,
    )
    .await
    .expect("切到另一段");
    let second = crate::services::timer::state(&pool)
        .await
        .expect("读状态")
        .session
        .expect("切换之后必须有会话");
    assert_ne!(
        second.started_at, first.started_at,
        "前提：切换必须开出一条新段（否则本用例什么都没证）"
    );

    let wait_registry = Arc::clone(&registry);
    let outcome =
        tokio::task::spawn_blocking(move || wait_for_exit(handle, generation, wait_registry))
            .await
            .expect("等待线程不应 panic");
    assert_eq!(outcome, ExitOutcome::Exited);

    assert_eq!(
        crate::services::bound_process_watch::settle_after_exit(&pool, &registry, generation).await,
        SettleOutcome::SegmentMismatch,
        "段已经变了：只清注册表，不动计时"
    );

    let state = crate::services::timer::state(&pool).await.expect("读状态");
    assert_eq!(state.status, "running", "用户手动那一段**必须还在跑**");
    assert_eq!(
        state.session.as_ref().map(|session| session.id),
        Some(second.id),
        "被保住的必须是用户手动开的这一段"
    );
    assert!(
        registry.snapshot().is_none(),
        "失配也要清注册表，不能留着下次误伤"
    );

    drop(child);
}
