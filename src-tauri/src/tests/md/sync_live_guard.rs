//! 导入路径的两条护栏（QA 回归发现的数据丢失路径）。
//!
//! - **P1**：删除必须按「基线里有、现在没了」的 `(事项, 开始时刻)` 判定。旧实现是
//!   `db.iter().skip(intervals.len())` 按数量截断，用户在**停止计时的同一个 tick 里**
//!   改文件时，刚停止的那条会顶到数量之外被软删。
//! - **P2**：用户手写 `ongoing: true` 不能被当成宿主占位段静默剔除（那会连带软删记录）。
//!
//! 这些用例直接调 `import::apply_timers` 并显式给出基线 / 新体：与 `run()` 走的是同一个
//! 函数，但不依赖系统时钟，断言能落到具体时刻。

use crate::services;
use crate::services::md_sync::format::{self, TimerEntry, TimerInterval};
use crate::services::md_sync::{export, import};
use super::sync::{at, env, Env};
use super::sync_live::{day, pin_start};
use crate::tests::support::{insert_saved, new_item, scalar_i64};

/// 某条记录的 `(status, ended_at, deleted_at)`，用来确认「被改 / 没被动过」。
async fn shape(env: &Env, id: i64) -> (String, Option<i64>, Option<i64>) {
    sqlx::query_as("SELECT status, ended_at, deleted_at FROM time_records WHERE id = ?")
        .bind(id)
        .fetch_one(&env.pool)
        .await
        .unwrap()
}

async fn alive_rows(env: &Env, status: &str) -> i64 {
    scalar_i64(
        &env.pool,
        &format!(
            "SELECT COUNT(*) FROM time_records \
             WHERE status = '{status}' AND deleted_at IS NULL"
        ),
    )
    .await
}

fn saved_entry(item: &str, intervals: Vec<TimerInterval>) -> TimerEntry {
    TimerEntry {
        item: item.into(),
        intervals,
    }
}

/// P1：停止计时 + 同一 tick 内改文件 → 刚停止的会话必须活着，用户改的时间要进库。
#[tokio::test]
async fn stop_and_edit_in_the_same_tick_keeps_the_stopped_record() {
    let env = env("md-guard-stop-edit").await;
    let item = new_item(&env.pool, "测试2").await;
    let earlier = insert_saved(
        &env.pool,
        item,
        at(env.date, 9, 0),
        at(env.date, 9, 30),
        1_800,
    )
    .await;
    /* 10:00 开始的这条此刻还在计时，稍后模拟「同一 tick 内被停止」。 */
    let stopped = services::timer::start(&env.pool, Some(item)).await.unwrap();
    pin_start(&env, stopped.id, at(env.date, 10, 0)).await;

    /* 基线 = 上一轮宿主写出的内容：09:00–09:30 + 10:00–14:57（实时占位段）。 */
    let baseline = export::timers_at(&env.pool, env.date, at(env.date, 14, 57))
        .await
        .unwrap()
        .body;
    assert!(baseline.contains("ongoing: true"), "{baseline}");

    /* 用户点了停止：active 变 saved（这就是 `timer::stop` 的落库结果）。 */
    let stop_at = at(env.date, 14, 57) + 30_000;
    sqlx::query(
        "UPDATE time_records SET status = 'saved', ended_at = ?, running_since = NULL, \
         accumulated_sec = ? WHERE id = ?",
    )
    .bind(stop_at)
    .bind(17_730)
    .bind(stopped.id)
    .execute(&env.pool)
    .await
    .unwrap();

    /* 同一个 tick 内用户又把文件里 09:30 改成 09:35。 */
    let edited = baseline.replace(
        &format!("end: {} 09:30:00", day(&env)),
        &format!("end: {} 09:35:00", day(&env)),
    );
    assert_ne!(baseline, edited, "用例前提：文件确实被改了");

    let stats = import::apply_timers(&env.pool, env.date, &baseline, &edited)
        .await
        .unwrap();

    assert_eq!(stats.deleted, 0, "刚停止的会话不该被软删");
    assert_eq!(stats.updated, 1, "只有用户改的那一段被更新");
    assert_eq!(stats.created, 0, "实时占位段不该被插成新记录");

    /* 库内存活 2 行，且两行各自的内容都对。 */
    assert_eq!(alive_rows(&env, "saved").await, 2);
    let (_, earlier_end, earlier_deleted) = shape(&env, earlier).await;
    assert_eq!(earlier_end, Some(at(env.date, 9, 35)));
    assert_eq!(earlier_deleted, None);
    let (status, stopped_end, stopped_deleted) = shape(&env, stopped.id).await;
    assert_eq!(status, "saved");
    assert_eq!(
        stopped_end,
        Some(stop_at),
        "刚停止那条的结束时刻必须原样保留"
    );
    assert_eq!(stopped_deleted, None, "刚停止那条不能被写入 deleted_at");
}

/// P2 ①：用户手写 `ongoing: true` 标在**唯一段**上 → 当普通数据导入，不软删。
#[tokio::test]
async fn handwritten_marker_on_the_only_segment_is_imported_not_deleted() {
    let env = env("md-guard-hand-1").await;
    let item = new_item(&env.pool, "测试2").await;
    let id = insert_saved(
        &env.pool,
        item,
        at(env.date, 9, 0),
        at(env.date, 9, 30),
        1_800,
    )
    .await;

    let baseline = format::render_timers(&[saved_entry(
        "测试2",
        vec![TimerInterval::saved(
            at(env.date, 9, 0),
            at(env.date, 9, 30),
        )],
    )]);
    /* 用户在 end 后面手写一行 `ongoing: true`，同时把结束时间改成 09:45。 */
    let edited = baseline.replace(
        &format!("end: {} 09:30:00", day(&env)),
        &format!("end: {} 09:45:00\n        ongoing: true", day(&env)),
    );
    assert_ne!(baseline, edited, "用例前提：文件确实被改了");

    let stats = import::apply_timers(&env.pool, env.date, &baseline, &edited)
        .await
        .unwrap();

    assert_eq!(stats.deleted, 0, "用户手写的标记不该导致软删");
    assert_eq!(stats.updated, 1, "时间要按用户写的入库");
    assert_eq!(stats.created, 0);
    assert_eq!(alive_rows(&env, "saved").await, 1);
    let (_, ended, deleted) = shape(&env, id).await;
    assert_eq!(ended, Some(at(env.date, 9, 45)));
    assert_eq!(deleted, None);
}

/// P2 ②：标记写在**多段的末段**上 → 同样不软删，两段都留着。
#[tokio::test]
async fn handwritten_marker_on_the_last_of_several_segments_is_imported() {
    let env = env("md-guard-hand-2").await;
    let item = new_item(&env.pool, "测试2").await;
    insert_saved(
        &env.pool,
        item,
        at(env.date, 9, 0),
        at(env.date, 9, 30),
        1_800,
    )
    .await;
    let second = insert_saved(
        &env.pool,
        item,
        at(env.date, 10, 0),
        at(env.date, 10, 30),
        1_800,
    )
    .await;

    let baseline = format::render_timers(&[saved_entry(
        "测试2",
        vec![
            TimerInterval::saved(at(env.date, 9, 0), at(env.date, 9, 30)),
            TimerInterval::saved(at(env.date, 10, 0), at(env.date, 10, 30)),
        ],
    )]);
    let edited = baseline.replace(
        &format!("end: {} 10:30:00", day(&env)),
        &format!("end: {} 10:40:00\n        ongoing: true", day(&env)),
    );

    let stats = import::apply_timers(&env.pool, env.date, &baseline, &edited)
        .await
        .unwrap();

    assert_eq!(stats.deleted, 0, "末段带手写标记不该让任何一段被删");
    assert_eq!(stats.updated, 1);
    assert_eq!(alive_rows(&env, "saved").await, 2);
    let (_, ended, deleted) = shape(&env, second).await;
    assert_eq!(ended, Some(at(env.date, 10, 40)));
    assert_eq!(deleted, None);
}

/// trusted 的来源 (b)：基线为空（进程刚重启）时，仍按库里 active 行识别占位段。
#[tokio::test]
async fn first_sync_without_baseline_uses_the_active_row_as_trusted() {
    let env = env("md-guard-restart").await;
    let item = new_item(&env.pool, "测试2").await;
    insert_saved(
        &env.pool,
        item,
        at(env.date, 9, 0),
        at(env.date, 9, 30),
        1_800,
    )
    .await;
    let active = services::timer::start(&env.pool, Some(item)).await.unwrap();
    pin_start(&env, active.id, at(env.date, 10, 0)).await;

    /* 文件里是上一轮宿主的输出（带占位段），但基线在重启后丢了 → old_body = ""。 */
    let file_body = export::timers_at(&env.pool, env.date, at(env.date, 14, 57))
        .await
        .unwrap()
        .body;
    assert!(file_body.contains("ongoing: true"), "{file_body}");

    let stats = import::apply_timers(&env.pool, env.date, "", &file_body)
        .await
        .unwrap();

    assert_eq!(stats.created, 0, "占位段不该被插成新记录");
    assert_eq!(stats.deleted, 0);
    assert_eq!(alive_rows(&env, "saved").await, 1);
    assert_eq!(alive_rows(&env, "active").await, 1);
    let (status, ended, _) = shape(&env, active.id).await;
    assert_eq!(status, "active");
    assert_eq!(ended, None, "active 行不该被写结束时刻");
}
