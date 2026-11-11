//! 补记（P1-01）：`services::record::backfill` 的 8 条可变异判据 + 命令层接线。
//! 判据本体见 `docs/fusion/FUSION-ARCH-P1-v1.md` §6.1，每条都写明「改坏哪一行 → 本用例转红」。
//! 从 `tests/record.rs` 拆出（后者 271 行，再塞 10 条必破 300 行上限）；夹具全部复用
//! `tests/support.rs` 的既有写法（`fresh_pool` / `new_item` / `scalar_i64`），不自创一套。

use crate::error::ErrorCode;
use crate::platform::clock::{day_bounds, now_ms};
use crate::repositories::record_session as session;
use crate::services::{record, timer};
use crate::tests::support::{expect_err, fresh_pool, new_item, scalar_i64};

/// 库里 `time_records` 的总行数（含 active / 已软删，用来断言「一行都没多」）。
async fn total_rows(pool: &sqlx::SqlitePool) -> i64 {
    scalar_i64(pool, "SELECT COUNT(*) FROM time_records").await
}

/// 判据 1：不跨天的一段只落一行，且形状与 `record_session::finalize` 完全一致。
///
/// 变异：把 `accumulated_sec` 写成 0（或写成毫秒 `ended - started`）→ 本用例红。
#[tokio::test]
async fn backfill_writes_one_saved_row() {
    let pool = fresh_pool("p1-backfill-row").await;
    let item = new_item(&pool, "写周报").await;
    let now = now_ms();
    let started = now - 600_000;
    let ended = now - 60_000;

    let rows = record::backfill(&pool, item, started, ended, None)
        .await
        .unwrap();
    assert_eq!(rows.len(), 1, "不跨天应只落一行");

    let row = &rows[0];
    assert_eq!(row.status, "saved", "补记恒为 saved，绝不产生 active");
    assert_eq!(row.running_since, None, "saved 行不许带计时段起点");
    assert_eq!(row.accumulated_sec, (ended - started) / 1000, "累计秒 = 区间毫秒 / 1000");
    assert_eq!(row.mode, "countup", "补记不产生倒计时");
    assert_eq!(row.target_sec, None, "countup 行没有目标秒数");
    assert_eq!(row.started_at, started);
    assert_eq!(row.ended_at, Some(ended));
    assert_eq!(row.item_id, item);
    assert_eq!(total_rows(&pool).await, 1, "库里只多这一行");
}

/// 判据 2：`ended == started` 与 `ended < started` **都**拒（`INVALID_DURATION`）。
///
/// 变异：把 `ended_at <= started_at` 里的 `<=` 改回 `<`（放行相等）→ 本用例红。
#[tokio::test]
async fn backfill_rejects_zero_or_negative_span() {
    let pool = fresh_pool("p1-backfill-span").await;
    let item = new_item(&pool, "写周报").await;
    let base = now_ms() - 600_000;

    let zero = record::backfill(&pool, item, base, base, None).await;
    assert_eq!(expect_err(zero), ErrorCode::InvalidDuration, "相等要拒：0 长度记录没有意义");
    let inverted = record::backfill(&pool, item, base, base - 1_000, None).await;
    assert_eq!(expect_err(inverted), ErrorCode::InvalidDuration, "倒挂要拒");
    assert_eq!(total_rows(&pool).await, 0, "被拒时一行都不许落");
}

/// 判据 3：未来时间必拒（`started_at` 在未来 / `ended_at` 在未来，两个方向都拒）。
///
/// 变异：删掉 `started_at >= now || ended_at > now` 这两个条件 → 本用例红。
#[tokio::test]
async fn backfill_rejects_future() {
    let pool = fresh_pool("p1-backfill-future").await;
    let item = new_item(&pool, "写周报").await;
    let now = now_ms();

    assert_eq!(
        expect_err(record::backfill(&pool, item, now + 60_000, now + 120_000, None).await),
        ErrorCode::InvalidDuration,
        "起点在未来要拒（补记是补过去的账）"
    );
    assert_eq!(
        expect_err(record::backfill(&pool, item, now - 60_000, now + 60_000, None).await),
        ErrorCode::InvalidDuration,
        "终点在未来要拒"
    );
    assert_eq!(total_rows(&pool).await, 0);
}

/// 判据 4：同参数调两次 → 库里仍只有 1 行，第二次返回的是同一条。
///
/// 变异：删掉 `find_backfill_duplicate` 那一段（幂等查）→ 2 行 → 本用例红。
#[tokio::test]
async fn backfill_is_idempotent() {
    let pool = fresh_pool("p1-backfill-idem").await;
    let item = new_item(&pool, "写周报").await;
    let now = now_ms();
    let started = now - 900_000;
    let ended = now - 300_000;

    let first = record::backfill(&pool, item, started, ended, None)
        .await
        .unwrap();
    let second = record::backfill(&pool, item, started, ended, None)
        .await
        .unwrap();
    assert_eq!(second.len(), 1, "幂等命中返回一条");
    assert_eq!(second[0].id, first[0].id, "返回的是已存在的那一条");
    assert_eq!(total_rows(&pool).await, 1, "同参两次只许一行");
}

/// 判据 5：23:40 → 00:20 跨本地零点 → 2 行，累计秒守恒，第一行结束在次日零点。
///
/// 变异：改成单段 INSERT（不调 `split_by_day`）→ 1 行 → 本用例红。
///
/// 取「两天前」的日界：不管用例在几点跑，零点两侧都稳在过去（凌晨 0:00–0:20 跑也不会
/// 命中「未来时间必拒」），判据与运行时刻无关。
#[tokio::test]
async fn backfill_splits_across_local_midnight() {
    let pool = fresh_pool("p1-backfill-midnight").await;
    let item = new_item(&pool, "写周报").await;
    let base = chrono::Local::now()
        .date_naive()
        .checked_sub_days(chrono::Days::new(2))
        .expect("两天前的日期恒存在");
    /* `day_bounds(day).1` = 该日的**次日**本地零点，与 `split_by_day` 内部同一口径。 */
    let midnight = day_bounds(base).1;
    let started = midnight - 20 * 60 * 1000;
    let ended = midnight + 20 * 60 * 1000;

    let rows = record::backfill(&pool, item, started, ended, None)
        .await
        .unwrap();
    assert_eq!(rows.len(), 2, "跨零点应拆成两段");

    let mut ordered = rows.clone();
    ordered.sort_by_key(|r| r.started_at);
    assert_eq!(ordered[0].started_at, started);
    assert_eq!(ordered[0].ended_at, Some(midnight), "第一行结束在次日本地零点");
    assert_eq!(ordered[1].started_at, midnight);
    assert_eq!(ordered[1].ended_at, Some(ended));
    let sum: i64 = ordered.iter().map(|r| r.accumulated_sec).sum();
    assert_eq!(sum, 2400, "分段不得改变总时长（40 分钟 = 2400 秒）");
    assert_eq!(ordered[0].accumulated_sec, 1200);
    assert_eq!(ordered[1].accumulated_sec, 1200);
}

/// 判据 6：10 秒的段照样落 1 行——补记**不过**「最短记录时长」这道闸。
///
/// 变异：在服务里调 `timer_stop::should_ignore` 判短即丢 → 0 行 → 本用例红。
#[tokio::test]
async fn backfill_ignores_min_record_threshold() {
    let pool = fresh_pool("p1-backfill-threshold").await;
    let item = new_item(&pool, "写周报").await;
    /* 阈值用出厂默认值（30s），不做任何写设置——正是要证明补记不受它约束（ADR-023）。 */
    let threshold = crate::services::settings::get_reference(&pool)
        .await
        .unwrap()
        .min_record_seconds;
    assert!(threshold > 10, "前置：阈值须大于 10 秒，实为 {threshold}");

    let now = now_ms();
    let rows = record::backfill(&pool, item, now - 20_000, now - 10_000, None)
        .await
        .unwrap();
    assert_eq!(rows.len(), 1, "10 秒的补记也要落库（显式保存不过阈值）");
    assert_eq!(rows[0].accumulated_sec, 10);
}

/// 判据 7：库里存在同名未完成待办时，补记**不动**它。
///
/// 变异：在服务里调 `todo::soft_delete_for_saved_record` → 待办被软删 → 本用例红。
/// 理由：那个联动的前提是「用户刚刚亲手结束」，而补记的是过去的账，同名待办很可能
/// 今天还要做；静默软删没有撤销入口（FUSION-ARCH-P1-v1 §3.2）。
#[tokio::test]
async fn backfill_does_not_touch_todos() {
    let pool = fresh_pool("p1-backfill-todo").await;
    let item = new_item(&pool, "写周报").await;
    let todo = crate::services::todo::create(&pool, "写周报", None, None, None)
        .await
        .unwrap();
    let now = now_ms();

    record::backfill(&pool, item, now - 600_000, now - 60_000, None)
        .await
        .unwrap();
    assert_eq!(
        scalar_i64(
            &pool,
            &format!("SELECT deleted_at IS NULL FROM todos WHERE id={}", todo.id)
        )
        .await,
        1,
        "补记绝不许软删同名待办（无撤销入口 = 不可逆的数据丢失）"
    );
}

/// 判据 8：存在进行中的会话时补记 → 该会话的 id 与累计秒一个都不变。
///
/// 变异：补记里顺手调 `end_and_start` / `set_accum_and_running` → id 或累计秒变 → 本用例红。
#[tokio::test]
async fn backfill_does_not_disturb_active_session() {
    let pool = fresh_pool("p1-backfill-active").await;
    let running = new_item(&pool, "写代码").await;
    let other = new_item(&pool, "写周报").await;
    timer::start(&pool, Some(running)).await.unwrap();
    let before = session::find_active(&pool)
        .await
        .unwrap()
        .expect("前置：应有进行中的会话");

    let now = now_ms();
    record::backfill(&pool, other, now - 600_000, now - 60_000, None)
        .await
        .unwrap();

    let after = session::find_active(&pool)
        .await
        .unwrap()
        .expect("补记不许结束进行中的会话");
    assert_eq!(after.id, before.id, "补记不许切换 / 重建 active 会话");
    assert_eq!(after.accumulated_sec, before.accumulated_sec, "不许折账");
    assert_eq!(after.running_since, before.running_since, "锚点不许被复位");
    assert_eq!(
        total_rows(&pool).await,
        2,
        "一条 active + 一条补记的 saved，各就各位"
    );
}

/// 事项不存在 / 已软删 → `ITEM_NOT_FOUND`（不新增错误码，§2.3）。
#[tokio::test]
async fn backfill_rejects_missing_or_deleted_item() {
    let pool = fresh_pool("p1-backfill-item").await;
    let now = now_ms();

    assert_eq!(
        expect_err(record::backfill(&pool, 9999, now - 600_000, now - 60_000, None).await),
        ErrorCode::ItemNotFound,
        "事项不存在"
    );

    let item = new_item(&pool, "写周报").await;
    crate::services::item::delete(&pool, item).await.unwrap();
    assert_eq!(
        expect_err(record::backfill(&pool, item, now - 600_000, now - 60_000, None).await),
        ErrorCode::ItemNotFound,
        "已软删的事项同样按不存在处理"
    );
    assert_eq!(total_rows(&pool).await, 0);
}

/// 命令层接线：`create_record` 必须打脏标记（S6）并广播（S7）。
///
/// 两半，缺一不可：
/// ① **行为**：`mark_record_dirty()` 让 `dirty::seq()` 恰好 +1（漏打 = +0）；
/// ② **接线**：源码里 `after_backfill` 先 `mark_record_dirty()` 再 `emit_timer_state`，
///    且 `create_record` 的成功路径上调 `after_backfill`（删掉任一句 → 本用例红）。
///
/// 为什么用源码判据补一半：`AppHandle` 在本仓库造不出来（`tauri` 未开 `test` feature，
/// 仓库里同类判据一律列为人工验证），广播那一句没有别的机械证据可钉。
#[test]
fn create_record_marks_dirty_and_broadcasts() {
    use crate::commands::record_cmd::mark_record_dirty;
    use crate::services::md_sync::dirty;

    let before = dirty::seq();
    mark_record_dirty();
    assert_eq!(dirty::seq(), before + 1, "补记必须打一次记录域脏标记");

    let source = include_str!("../commands/record_cmd.rs");
    let code: Vec<&str> = source
        .lines()
        .map(str::trim)
        .filter(|line| !line.starts_with("//") && !line.starts_with("///"))
        .collect();
    let mark_at = code
        .iter()
        .position(|line| line.contains("mark_record_dirty();"))
        .expect("after_backfill 里必须有 mark_record_dirty() 调用");
    let emit_at = code
        .iter()
        .position(|line| line.contains("events::emit_timer_state("))
        .expect("after_backfill 里必须有 emit_timer_state 调用");
    assert!(mark_at < emit_at, "先打脏标记、再广播（顺序反了会让观察线程抢跑）");
    assert!(
        code.iter().any(|line| line.contains("after_backfill(&app, &state.pool)")),
        "create_record 的成功路径上必须调 after_backfill"
    );
    assert!(
        code.iter().any(|line| line.contains("state.pool, item_id, started_at, ended_at")),
        "create_record 必须把四个入参原样交给服务层"
    );
}
