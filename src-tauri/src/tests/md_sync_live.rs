//! 事项计时区块里的「进行中」段（V0.4.1 修复）。
//!
//! 用户口径：「正在计时的记录不会出现在日记的事项计时区块里」。
//!
//! 覆盖四条：①active 记录被导出，end 是合理的当前时刻（不是 null、不在未来）；
//! ②停止后 saved 接管同一段，不重复出现；③导入路径不会把进行中的「当前时刻」
//! 写回数据库（既不插新记录、也不改 active 行）；④渲染在设定粒度内稳定
//! （同一分钟内多次调用文本完全一致 → 不会每次 tick 都写盘）。

use crate::infra::md_file;
use crate::models::md_sync::MdSyncKind;
use crate::services;
use crate::services::md_sync::{export, format};
use crate::tests::md_sync::{at, binding, env, file_for, save_binding, Env, TIMERS_HEADING};
use crate::tests::support::{insert_saved, new_item, scalar_i64};

/// 把 active 会话的开始时刻钉到指定毫秒（当前计时段一起改，保证仍算「正在跑」）。
///
/// 计时状态机自己写 `now`，用例要断言到具体时刻，必须把它改成确定值。
pub(super) async fn pin_start(env: &Env, record_id: i64, started_at: i64) {
    sqlx::query("UPDATE time_records SET started_at = ?, running_since = ? WHERE id = ?")
        .bind(started_at)
        .bind(started_at)
        .bind(record_id)
        .execute(&env.pool)
        .await
        .unwrap();
}

async fn save_timers_binding(env: &Env) {
    save_binding(
        &env.pool,
        binding(MdSyncKind::Timers, &env.vault, "{date}.md", TIMERS_HEADING),
    )
    .await;
}

pub(super) fn day(env: &Env) -> String {
    env.date.format("%Y-%m-%d").to_string()
}

/// 当前 active 行的（ended_at, accumulated_sec）——用来验证导入没有改动它。
async fn active_shape(env: &Env) -> (Option<i64>, i64) {
    sqlx::query_as("SELECT ended_at, accumulated_sec FROM time_records WHERE status = 'active'")
        .fetch_one(&env.pool)
        .await
        .unwrap()
}

/// ① active 记录被导出，end 落在「现在」这一分钟里。
#[tokio::test]
async fn running_record_is_exported_with_live_end() {
    let env = env("md-live-export").await;
    let item = new_item(&env.pool, "测试2").await;
    let record = services::timer::start(&env.pool, Some(item)).await.unwrap();
    pin_start(&env, record.id, at(env.date, 9, 18)).await;

    let now = at(env.date, 14, 33) + 20_000;
    let exported = export::timers_at(&env.pool, env.date, now).await.unwrap();
    let day = day(&env);

    assert!(exported.body.contains("- [ ] 测试2"), "{}", exported.body);
    assert!(
        exported
            .body
            .contains(&format!("      - start: {day} 09:18:00")),
        "{}",
        exported.body
    );
    assert!(
        exported
            .body
            .contains(&format!("        end: {day} 14:33:00")),
        "end 应等于「当前时刻」对齐到整分钟：{}",
        exported.body
    );
    assert!(exported.body.contains("        ongoing: true"));

    /* 渲染出来的东西必须能被自己解析回去（实时段带标记往返）。 */
    let parsed = format::parse_timers(&exported.body);
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].intervals.len(), 1);
    assert!(parsed[0].intervals[0].ongoing);
    assert_eq!(parsed[0].intervals[0].start_ms, at(env.date, 9, 18));
    assert_eq!(parsed[0].intervals[0].end_ms, at(env.date, 14, 33));
}

/// ② 停止后由 saved 记录接管同一段，区块里不会出现两条。
#[tokio::test]
async fn stopped_record_takes_over_without_duplicating_the_segment() {
    let env = env("md-live-stop").await;
    let item = new_item(&env.pool, "测试2").await;
    let record = services::timer::start(&env.pool, Some(item)).await.unwrap();
    pin_start(&env, record.id, at(env.date, 9, 18)).await;

    services::timer::stop(&env.pool).await.unwrap();
    /* 结束时刻由状态机写「现在」，用例改成确定值再断言渲染结果。 */
    sqlx::query(
        "UPDATE time_records SET started_at = ?, ended_at = ?, accumulated_sec = ? WHERE id = ?",
    )
    .bind(at(env.date, 9, 18))
    .bind(at(env.date, 14, 35))
    .bind(19_020)
    .bind(record.id)
    .execute(&env.pool)
    .await
    .unwrap();

    let exported = export::timers_at(&env.pool, env.date, at(env.date, 14, 36))
        .await
        .unwrap();
    let day = day(&env);

    assert!(
        exported
            .body
            .contains(&format!("        end: {day} 14:35:00")),
        "{}",
        exported.body
    );
    assert!(
        !exported.body.contains("ongoing: true"),
        "停止后不应再出现实时标记：{}",
        exported.body
    );
    assert_eq!(exported.body.matches("- [ ] 测试2").count(), 1);
    assert_eq!(exported.body.matches("- start:").count(), 1);
}

/// ③ 导入路径不会把进行中的「当前时刻」写回数据库。
#[tokio::test]
async fn importing_never_writes_the_live_placeholder_back() {
    let env = env("md-live-import").await;
    let item = new_item(&env.pool, "测试2").await;
    insert_saved(
        &env.pool,
        item,
        at(env.date, 9, 0),
        at(env.date, 9, 30),
        1_800,
    )
    .await;
    /* 与线上现场一致：同一天里既有已保存记录，也有一条还在跑的会话。
    实时段的开始时刻钉在今日 0 点：`sync_all` 内部用系统时钟算「现在」，
    只有把起点放到当天最早才在任何时刻跑都成立（见下方 skip 说明）。 */
    let active = services::timer::start(&env.pool, Some(item)).await.unwrap();
    pin_start(&env, active.id, at(env.date, 0, 0)).await;
    save_timers_binding(&env).await;

    /* 实时段要求「当前时刻已经跨过开始那一分钟」才有长度。只有测试正好跑在每天头一分钟
    时这个前提不成立（那样整段实时区间还没成型），跳过而不是留一条假失败。 */
    if format::floor_to_minute(crate::platform::clock::now_ms()) <= at(env.date, 0, 0) {
        return;
    }

    services::md_sync::run(&env.pool, &env.app_data)
        .await
        .unwrap();
    let file = file_for(&env);
    let text = std::fs::read_to_string(&file).unwrap();
    assert!(text.contains("ongoing: true"), "{text}");

    let before = active_shape(&env).await;

    /* 用户只改了已保存段的结束时间（09:30 → 09:45），没有碰进行中的那段。 */
    let body = md_file::body_in_text(&text, TIMERS_HEADING).unwrap();
    let body = body.replace(
        &format!("end: {} 09:30:00", day(&env)),
        &format!("end: {} 09:45:00", day(&env)),
    );
    let edited = md_file::replace_in_text(&text, TIMERS_HEADING, &body);
    std::fs::write(&file, edited).unwrap();

    let report = services::md_sync::run(&env.pool, &env.app_data)
        .await
        .unwrap();
    assert!(report.errors.is_empty(), "{:?}", report.errors);
    assert!(report.kinds.contains(&MdSyncKind::Timers));

    /* 已保存段按用户的编辑更新。 */
    let saved: (i64, i64) = sqlx::query_as(
        "SELECT started_at, ended_at FROM time_records \
         WHERE status = 'saved' AND deleted_at IS NULL",
    )
    .fetch_one(&env.pool)
    .await
    .unwrap();
    assert_eq!(saved, (at(env.date, 9, 0), at(env.date, 9, 45)));

    /* 没有多出一条假记录。 */
    let saved_rows = scalar_i64(
        &env.pool,
        "SELECT COUNT(*) FROM time_records WHERE status = 'saved' AND deleted_at IS NULL",
    )
    .await;
    assert_eq!(saved_rows, 1, "实时段不该被插成一条新记录");

    /* active 行原封不动：ended_at 仍为空，累计秒数没被整分钟的假 end 改写。 */
    assert_eq!(
        active_shape(&env).await,
        before,
        "实时段回灌会改写 active 记录的时长"
    );
}

/// ④ 渲染稳定：同一分钟内多次调用（模拟 2s 轮询）文本完全一致；跨分钟才变。
#[tokio::test]
async fn rendering_is_stable_within_the_minute_and_moves_once_per_minute() {
    let env = env("md-live-stable").await;
    let item = new_item(&env.pool, "测试2").await;
    let record = services::timer::start(&env.pool, Some(item)).await.unwrap();
    pin_start(&env, record.id, at(env.date, 9, 18)).await;

    let base = at(env.date, 14, 33);
    let first = export::timers_at(&env.pool, env.date, base + 5_000)
        .await
        .unwrap()
        .body;
    let second = export::timers_at(&env.pool, env.date, base + 55_000)
        .await
        .unwrap()
        .body;
    assert_eq!(
        first, second,
        "同一分钟内文本必须一致，否则每 2s 都会重写整篇日记"
    );

    let next_minute = export::timers_at(&env.pool, env.date, base + 61_000)
        .await
        .unwrap()
        .body;
    assert_ne!(first, next_minute, "跨分钟应更新到新的整分钟");
    assert!(
        next_minute.contains(&format!("        end: {} 14:34:00", day(&env))),
        "{next_minute}"
    );
}

/// 暂停中的会话仍然在区块里（冻结在「已计到的位置」），不会随当前时刻越长越长。
#[tokio::test]
async fn paused_session_stays_visible_with_a_frozen_end() {
    let env = env("md-live-paused").await;
    let item = new_item(&env.pool, "测试2").await;
    let record = services::timer::start(&env.pool, Some(item)).await.unwrap();
    pin_start(&env, record.id, at(env.date, 9, 18)).await;
    services::timer::pause(&env.pool).await.unwrap();
    /* 暂停后 running_since 为空；累计固定成 30 分钟，渲染才有确定值。 */
    sqlx::query("UPDATE time_records SET accumulated_sec = 1800 WHERE id = ?")
        .bind(record.id)
        .execute(&env.pool)
        .await
        .unwrap();

    let early = export::timers_at(&env.pool, env.date, at(env.date, 14, 33))
        .await
        .unwrap()
        .body;
    let late = export::timers_at(&env.pool, env.date, at(env.date, 15, 33))
        .await
        .unwrap()
        .body;
    assert_eq!(early, late, "暂停期间区块不应继续增长");
    assert!(
        early.contains(&format!("        end: {} 09:48:00", day(&env))),
        "{early}"
    );
    assert!(early.contains("        ongoing: true"));
    assert_eq!(
        scalar_i64(
            &env.pool,
            "SELECT COUNT(*) FROM time_records WHERE status = 'saved' AND deleted_at IS NULL",
        )
        .await,
        0
    );
}
