//! md 覆盖提醒的裁决落库（T03 / 架构 §1.4 §7）。
//!
//! 这里只验**不需要真 vault**的那条路：`Deferred`（「暂不处理」）。
//! A/B 两路要真写 md 文件与业务库（`import_and_render` / `render_expected`），
//! 属集成面，留给 T05 的全链自证；但 Deferred 恰恰是最容易写错的一条——
//! 写成「删掉条目」就等于用户点「暂不处理」时把这次冲突永久丢弃，两端从此各走各的。
//!
//! 另外钉住审计的两条纪律：
//! 1. **每选一次多一行**（不是 upsert），否则「谁在什么时候改了什么」查不出来；
//! 2. `direction` 落的是词汇值（`deferred`），不是枚举名（`Deferred`）——
//!    迁移 0012 的列注释与前端文案都以词汇值为准。

use crate::services::md_sync::decision::{self, ConflictState};
use crate::services::md_sync::audit;
use crate::services::md_sync::decision::registry;
use crate::models::md_sync::{Decision, MdSyncBinding, MdSyncKind};
use crate::tests::support::{fresh_pool, scalar_i64, scalar_opt_str};

fn binding() -> MdSyncBinding {
    MdSyncBinding {
        kind: MdSyncKind::Timers,
        enabled: true,
        root: "/tmp/vault-t03".into(),
        file: "{date}.md".into(),
        heading: "#### 事项计时".into(),
    }
}

fn day() -> chrono::NaiveDate {
    chrono::NaiveDate::from_ymd_opt(2026, 11, 16).expect("2026-11-16 是合法日期")
}

fn register(b: &MdSyncBinding) -> String {
    decision::register(
        b,
        day(),
        "/tmp/vault-t03/2026-11-16.md".into(),
        "old body".into(),
        "new body".into(),
        ConflictState::AwaitingDecision,
    );
    b.key()
}

#[tokio::test]
async fn audit_record_appends_one_row_per_decision() {
    let pool = fresh_pool("t03-audit-append").await;
    audit::record(&pool, MdSyncKind::Timers, "#### 事项计时", "keep_timing", 1_000)
        .await
        .expect("第一次审计应写入");
    audit::record(&pool, MdSyncKind::Timers, "#### 事项计时", "deferred", 2_000)
        .await
        .expect("第二次审计应写入");

    assert_eq!(
        scalar_i64(&pool, "SELECT COUNT(*) FROM md_decision_audit").await,
        2,
        "每次选择一行，不是按区块 upsert"
    );
    assert_eq!(
        scalar_opt_str(
            &pool,
            "SELECT direction FROM md_decision_audit ORDER BY id DESC LIMIT 1"
        )
        .await
        .as_deref(),
        Some("deferred"),
        "direction 落词汇值"
    );
}

/// **刻意持锁跨 await**：这把锁的语义就是「整个用例期间独占全局注册表」，中途放开
/// 就等于没锁（别的用例会插进 `clear` 与 `resolve` 之间，看到的条目数就随机了）。
/// `#[tokio::test]` 默认 current_thread，future 不换线程 ⇒ 不存在跨线程解锁；
/// 持锁期间 await 的只有数据库（在 sqlx 自己的线程上），不会与这把锁互相等待。
#[allow(clippy::await_holding_lock)]
#[tokio::test]
async fn deferred_writes_audit_and_keeps_conflict_pending() {
    /* 注册表是全局单例，与单测共用同一进程 ⇒ 必须拿同一把锁（见 registry::test_guard）。 */
    let _g = registry::test_guard();
    registry::clear();
    let pool = fresh_pool("t03-deferred").await;
    let b = binding();
    let id = register(&b);

    let outcome = decision::resolve(&pool, &id, Decision::Deferred)
        .await
        .expect("Deferred 裁决应成功");

    assert_eq!(outcome.direction, "pending", "回执方向是 pending");
    assert_eq!(outcome.imported, 0, "暂不处理不得导入任何行");
    assert!(!outcome.exported, "暂不处理不得改写 md");

    assert_eq!(
        scalar_i64(&pool, "SELECT COUNT(*) FROM md_decision_audit").await,
        1,
        "裁决都要留审计，包括暂不处理"
    );
    assert_eq!(
        scalar_opt_str(&pool, "SELECT direction FROM md_decision_audit").await.as_deref(),
        Some("deferred"),
        "审计方向与 Decision::as_str 一致"
    );

    let all = decision::pending();
    assert_eq!(all.len(), 1, "条目必须还在——暂不处理不是丢弃");
    assert_eq!(all[0].id, id);
    assert_eq!(
        all[0].state,
        ConflictState::PendingDecision,
        "暂不处理后回到挂起，不再弹窗"
    );
    assert!(
        decision::awaiting().is_empty(),
        "挂起的不进可弹窗集合，否则用户会被同一个冲突反复打扰"
    );

    registry::clear();
}

#[tokio::test]
async fn resolve_unknown_conflict_is_an_error_not_a_silent_ok() {
    let pool = fresh_pool("t03-unknown").await;
    let err = decision::resolve(&pool, "timers|/tmp|x.md|#### nope", Decision::KeepTiming)
        .await
        .expect_err("不存在的冲突必须报错");
    let text = err.to_string();
    assert!(
        text.contains("已处理") || text.contains("MD_SYNC_CONFIG_INVALID"),
        "错误要说明「已处理或不存在」，实际：{text}"
    );
    assert_eq!(
        scalar_i64(&pool, "SELECT COUNT(*) FROM md_decision_audit").await,
        0,
        "裁决失败不得留半条审计"
    );
}
