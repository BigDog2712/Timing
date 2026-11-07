//! Markdown 合并语义的现状快照 · 续篇（V0.11.18，PRD C9 的第 2、3 条）。
//!
//! ## 为什么是第二个文件
//!
//! `md_sync_conflict_semantics.rs` 已经 296 行（单文件 ≤300 行硬门禁、零豁免，ADR-017），
//! 再塞两条用例必破门禁。拆的口子是**场景**：那边是「谁赢了 / 谁没被删」的五条，
//! 这里是「一端改同一段时谁赢」与「同一天两段怎么累加」两条。判据、夹具、纪律完全同一套
//! （`pub(super)` 复用，绝不复制 —— 复制一套夹具就等于复制那条「每个用例开跑前先把三种
//! kind 一次锁到临时目录」的安全底线，漏一套会写到用户的真实文档目录）。
//!
//! ## 口径：**本轮不修**（PRD §13.1 裁决 2 / §10-N13）
//!
//! 两条都是 v0.11.17 已交付行为的**照片**，不是缺陷修复。改法只有一个：**先改这个文件**，
//! 再改产品代码 —— 这样 review 时「行为变了」一定会被看见。
//! 与 `md_sync_conflict_semantics.rs` 一样，失败信息统一用 `KNOWN`。

use super::md_sync::{at, env, TIMERS_HEADING};
use super::md_sync_conflict_semantics::{body_of, live_records, rewrite, ts, KNOWN};
use crate::services;
use crate::tests::support::{insert_saved, new_item, scalar_i64};

/// 场景 6（PRD C9 第 2 条）：**一端新增、另一端修改同一段 → 修改赢（文件赢）**。
///
/// 时间线：
/// - 库里 09:00–09:30 一段；
/// - PC 端新增 11:00–11:30（只进库）；
/// - 同一时刻 MD 端把**已有的那段**改成 09:00–10:00（只进文件，`start` 不变、`end` 变了）。
///
/// 这一条与场景 1（两端各**新增**）是**不同**的两种冲突，容易被当成同一条：
/// - 场景 1：`start` 两边都不同 → 靠 `claim_rows` 的两轮配对（精确 → 顺序兜底）认领，
///   结果是「md 那段吸收 PC 那段」；
/// - 本场景：`start` 相同 → **第 1 轮精确匹配**当场认回同一行，`ended_at` 按文件改写。
///
/// 所以判据要分开钉：「同一段被改」时文件赢是**确定的**（有 start 这个锚），
/// 而「两端各加一段」时丢一段是**配对兜底的副作用**——前者可以放心依赖，
/// 后者才是主人反馈的那个缺陷面。
#[tokio::test]
async fn md_edit_of_existing_segment_wins_over_sql() {
    let env = env("conflict-edit-one").await;
    let item = new_item(&env.pool, "写代码").await;
    let nine = insert_saved(&env.pool, item, at(env.date, 9, 0), at(env.date, 9, 30), 1800).await;

    /* 第一轮：建立基线（文件 = 09:00–09:30） */
    services::md_sync::run(&env.pool).await.unwrap();
    assert!(body_of(&env, TIMERS_HEADING).contains("09:30:00"));

    /* PC 端新增一段：只进库，文件不动 */
    let eleven = insert_saved(&env.pool, item, at(env.date, 11, 0), at(env.date, 11, 30), 1800).await;

    /* MD 端改**已有那段**的结束时刻（`start` 不动 → 精确匹配会认回同一行）。
       整段重写而不是字符串替换：`  ```」这个片段在 `  ```yaml` 里也出现一次。 */
    rewrite(
        &env,
        TIMERS_HEADING,
        &format!(
            "- [ ] 写代码\n  ```yaml\n  planner:\n    log:\n      - start: {}\n        end: {}\n  ```",
            ts(env.date, 9, 0),
            ts(env.date, 10, 0)
        ),
    );

    let report = services::md_sync::run(&env.pool).await.unwrap();
    assert!(report.errors.is_empty(), "{:?}", report.errors);

    let live = live_records(&env.pool).await;
    // 实测 v0.11.17: 2 段（09:00 被改写、11:00 保留），不增不减
    assert_eq!(live.len(), 2, "{KNOWN}：改一段不会让记录变多或变少");
    assert_eq!(
        live.iter().map(|(_, start)| *start).collect::<Vec<_>>(),
        vec![at(env.date, 9, 0), at(env.date, 11, 0)]
    );
    assert_eq!(live[0].0, nine, "改的是**同一行**（id 不变），不是新建");
    assert_eq!(live[1].0, eleven, "PC 新增的那段原样保留");

    // 实测 v0.11.17: ended_at 被文件改写为 10:00（文件赢）
    let ended = scalar_i64(
        &env.pool,
        &format!("SELECT ended_at FROM time_records WHERE id = {nine}"),
    )
    .await;
    assert_eq!(
        ended,
        at(env.date, 10, 0),
        "{KNOWN}：同一段被改时文件赢（end 按 md 写）"
    );

    /* 文件侧也应是改写后的形状：两条 log、10:00 与 11:00 都在 */
    let rendered = body_of(&env, TIMERS_HEADING);
    // 实测 v0.11.17: 两条 start，10:00:00 与 11:00:00 各出现一次，09:30:00 消失
    assert_eq!(rendered.matches("- start:").count(), 2, "{rendered}");
    assert!(rendered.contains("10:00:00"), "{rendered}");
    assert!(rendered.contains("11:00:00"), "{rendered}");
    assert!(!rendered.contains("09:30:00"), "{KNOWN}：旧结束时刻不该留痕");
}

/// 场景 7（PRD C9 第 3 条）：**同一天、同事项、两段计时的累加口径**（ADR-043 拆分口径）。
///
/// 这是主人「两端各计时会互相覆盖」那条反馈的**量化面**：ADR-043 明确「跨零点的会话在结束
/// 时分段落库」，也就是说「同一事项两条相邻记录」是**预期形状**，不是脏数据。于是：
///
/// - 两段**各自独立**留在 SQL（`id` 不同、`accumulated_sec` 各 1800）；
/// - 导出的日记里是**同一个事项下的两条 `log`**，不是两条事项、也不是合并成一条；
/// - 两轮同步之后仍然两条（幂等，不会「越同步越合并」）；
/// - 总时长 = 两段之和（3600 秒）——「累加」靠的是多条记录相加，**不是**把时间拼进一条。
///
/// 反过来说：只要有一步把两段并成一条，总时长就会掉到 1800，而且用户的日记上看着「少了一段」
/// —— 那正是本轮**不修**的那个缺陷面的量化表达。
#[tokio::test]
async fn same_item_two_segments_same_day_stay_additive() {
    let env = env("conflict-two-segments").await;
    let item = new_item(&env.pool, "写代码").await;
    let first = insert_saved(&env.pool, item, at(env.date, 9, 0), at(env.date, 9, 30), 1800).await;
    let second = insert_saved(&env.pool, item, at(env.date, 11, 0), at(env.date, 11, 30), 1800).await;

    services::md_sync::run(&env.pool).await.unwrap();

    let live = live_records(&env.pool).await;
    // 实测 v0.11.17: 2 行独立记录（ADR-043 的预期形状）
    assert_eq!(live.len(), 2, "{KNOWN}：两段各是一条记录，不合并");
    assert_eq!(live[0].0, first);
    assert_eq!(live[1].0, second);

    // 实测 v0.11.17: 累加 = 1800 + 1800 = 3600 秒（不是 1800）
    let total = scalar_i64(
        &env.pool,
        &format!(
            "SELECT COALESCE(SUM(accumulated_sec), 0) FROM time_records \
             WHERE item_id = {item} AND status = 'saved' AND deleted_at IS NULL"
        ),
    )
    .await;
    assert_eq!(total, 3600, "{KNOWN}：总时长必须是两段之和");

    /* 文件侧：同一事项一个 `log:` 列表、两条 start（不是两个事项） */
    let rendered = body_of(&env, TIMERS_HEADING);
    // 实测 v0.11.17: 两条 start、09:00 与 11:00 都在、事项行只出现一次
    assert_eq!(rendered.matches("- start:").count(), 2, "{rendered}");
    assert!(rendered.contains("09:00:00"), "{rendered}");
    assert!(rendered.contains("11:00:00"), "{rendered}");
    assert_eq!(
        rendered.matches("- [ ] 写代码").count(),
        1,
        "{KNOWN}：同一个事项只出现一次（两段挂在它的 log 里）\n{rendered}"
    );

    /* 第二轮：幂等 —— 不合并、不丢段（「越同步越少」是最糟的形状） */
    services::md_sync::run(&env.pool).await.unwrap();
    let again = live_records(&env.pool).await;
    // 实测 v0.11.17: 仍是 2 行、id 与顺序都不变
    assert_eq!(again, live, "{KNOWN}：第二轮同步不该动这两段");
    let total_again = scalar_i64(
        &env.pool,
        &format!(
            "SELECT COALESCE(SUM(accumulated_sec), 0) FROM time_records \
             WHERE item_id = {item} AND status = 'saved' AND deleted_at IS NULL"
        ),
    )
    .await;
    assert_eq!(total_again, 3600, "{KNOWN}：第二轮之后总时长仍守恒");
}
