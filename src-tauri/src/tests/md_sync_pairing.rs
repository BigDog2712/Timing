//! 段对位与删除的场景用例（删首段 / 删中段）。
//!
//! 背景：配对曾经是「按索引」（`db.get(index)`）。用户删掉某一段时，后面的段会被写到
//! 前面那行上，库内两行 `started_at` 撞车；更糟的是下一轮 `file == expected` 命中短路，
//! 撞出来的重复**永远不会自愈**。现在 `claim_rows` 是「精确匹配优先 + 索引兜底」，
//! 这里把两个删除场景锁死：存活行数正确、`started_at` 不重复、文件里同一段只画一次。

use crate::services::md_sync::format::{TimerEntry, TimerInterval};
use crate::services::md_sync::{export, format, import};
use crate::tests::md_sync::{at, env, Env};
use crate::tests::support::{insert_saved, new_item};

/// 渲染一个「只有事项 测试2」的计时区块（基线与用户改后的文件体都用它构造）。
fn block(env: &Env, spans: &[(u32, u32, u32, u32)]) -> String {
    let intervals = spans
        .iter()
        .map(|&(sh, sm, eh, em)| TimerInterval::saved(at(env.date, sh, sm), at(env.date, eh, em)))
        .collect();
    format::render_timers(&[TimerEntry {
        item: "测试2".into(),
        intervals,
    }])
}

/// 库内存活 saved 行的开始时刻（升序）——重复的 `started_at` 会在这里露出来。
async fn alive_starts(env: &Env) -> Vec<i64> {
    sqlx::query_scalar(
        "SELECT started_at FROM time_records \
         WHERE status = 'saved' AND deleted_at IS NULL ORDER BY started_at ASC",
    )
    .fetch_all(&env.pool)
    .await
    .unwrap()
}

/// 渲染结果里的 `- start:` 行（同一段被画两遍就会重复）。
fn rendered_starts(body: &str) -> Vec<String> {
    body.lines()
        .filter(|line| line.contains("- start:"))
        .map(str::to_string)
        .collect()
}

/// 删首段：第二段必须靠精确匹配认回自己那行，第一段被软删，不产生撞车。
#[tokio::test]
async fn deleting_the_first_segment_keeps_the_rest_without_colliding() {
    let env = env("md-pair-del-first").await;
    let item = new_item(&env.pool, "测试2").await;
    insert_saved(
        &env.pool,
        item,
        at(env.date, 9, 0),
        at(env.date, 9, 30),
        1_800,
    )
    .await;
    insert_saved(
        &env.pool,
        item,
        at(env.date, 10, 0),
        at(env.date, 10, 30),
        1_800,
    )
    .await;

    let baseline = block(&env, &[(9, 0, 9, 30), (10, 0, 10, 30)]);
    /* 用户在文件里删掉第一段那三行，只留第二段。 */
    let edited = block(&env, &[(10, 0, 10, 30)]);

    let stats = import::apply_timers(&env.pool, env.date, &baseline, &edited)
        .await
        .unwrap();

    assert_eq!(stats.deleted, 1, "被删掉的第一段要软删");
    assert_eq!(stats.created, 0, "保留下来的第二段不该被当成新记录");
    assert_eq!(stats.updated, 0, "两边内容一样，不该有 update");
    assert_eq!(
        alive_starts(&env).await,
        vec![at(env.date, 10, 0)],
        "存活行不能出现两个 10:00"
    );

    let body = export::timers_at(&env.pool, env.date, at(env.date, 12, 0))
        .await
        .unwrap()
        .body;
    assert_eq!(
        rendered_starts(&body).len(),
        1,
        "同一段只能渲染一次：{body}"
    );
}

/// 删中段：两端的段各自精确匹配、中间的段被软删，`started_at` 不重复。
#[tokio::test]
async fn deleting_the_middle_segment_keeps_both_ends_without_colliding() {
    let env = env("md-pair-del-middle").await;
    let item = new_item(&env.pool, "测试2").await;
    for (hour, minute) in [(9, 0), (10, 0), (11, 0)] {
        insert_saved(
            &env.pool,
            item,
            at(env.date, hour, minute),
            at(env.date, hour, minute + 30),
            1_800,
        )
        .await;
    }

    let baseline = block(&env, &[(9, 0, 9, 30), (10, 0, 10, 30), (11, 0, 11, 30)]);
    /* 用户删掉中间那三行。 */
    let edited = block(&env, &[(9, 0, 9, 30), (11, 0, 11, 30)]);

    let stats = import::apply_timers(&env.pool, env.date, &baseline, &edited)
        .await
        .unwrap();

    assert_eq!(stats.deleted, 1, "只该删中间那一段");
    assert_eq!(stats.created, 0);
    assert_eq!(stats.updated, 0);
    assert_eq!(
        alive_starts(&env).await,
        vec![at(env.date, 9, 0), at(env.date, 11, 0)],
        "两端的段各自留一行，不能撞车"
    );

    let body = export::timers_at(&env.pool, env.date, at(env.date, 12, 0))
        .await
        .unwrap()
        .body;
    let starts = rendered_starts(&body);
    assert_eq!(starts.len(), 2, "两段各画一次：{body}");
    let mut unique = starts.clone();
    unique.dedup();
    assert_eq!(unique, starts, "渲染结果里不允许出现重复的 start 行");
}
