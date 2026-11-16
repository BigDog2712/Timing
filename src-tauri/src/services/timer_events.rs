//! 计时事件接线：把 `services::timer` 的状态变更落成 `timer_ops` 事件。
//!
//! ## 只做两件事
//!
//! 1. 把墙钟时刻修正成**与累计秒同源**的语义时刻（见 [`elapsed_at`]）；
//! 2. 在**调用方的事务里**追加事件。
//!
//! ## 为什么必须同事务（S3 定案，2026-11-16）
//!
//! 原先这里的口径是「事件写失败只记 WARN、不阻断计时」，理由是「本地状态在
//! `time_records`，事件只是远端副本」。那个理由漏了一件事：**状态行与事件流是同一份
//! 事实的两个投影**。状态写成功、事件写失败之后，本机看到的是一段正常的暂停，
//! 对端 fold 出来的是「这台设备还在跑」—— 没有报错、没有日志给用户看、两天后时长对不上。
//! 那不是「牺牲远端换本机可用」，是**两端各自记了一份互相矛盾的账**。
//!
//! 所以现在两个写入装进同一个事务：要么都成，要么都不成并向上返回错误。代价是
//! 磁盘写不进去时「暂停」会失败 —— 这是正确代价，因为它同时也意味着这一段本来也存不下来。
//!
//! ⚠️ 允许「不适用」但不允许「静默丢」：设备身份没认领、会话还没有 uid 时
//! `append_for_record` 返回 `Ok(None)`（见 `repositories::timer_ops_event`），
//! 那不是失败，不该让用户按不动暂停。
//!
//! ## 为什么 `at_ms` 不能用裸 `clock::now_ms()`
//!
//! 累计秒用的是**单调时钟**（`timer_time::elapsed_ms`，锚点存在时不看墙钟）。若事件
//! 时刻取裸墙钟，fold 出来的 `accumulated_ms` 与 `time_records.accumulated_sec` 会在
//! NTP 校时 / 手动改时之后**差出一段**，而且两边都不报错。所以 `at_ms` 一律写成
//! 「段起点 + 单调流逝」，见 [`elapsed_at`]。这样同一条会话在单设备上 fold 出来的
//! 秒数与既有实现**逐位相同**（用例 `fold_matches_time_records` 钉住这一点）。

use sqlx::SqliteConnection;

use crate::error::AppResult;
use crate::services::timer_ops::TimerOpKind;

/// 把墙钟时刻修正成「与 `live_duration` 同源」的语义时刻。
///
/// `started_at_ms` 是**当前正在跑的段**的起点（`running_since`），不是会话起点：
/// 暂停过的会话有多个段，只有当前段有流逝。
///
/// 负流逝（时钟回拨）按 0 处理 —— 与 `floor_sec` 同一条兜底规则。
pub fn elapsed_at(segment_start_ms: i64, wall_now_ms: i64) -> i64 {
    let elapsed = crate::services::timer_time::elapsed_ms(segment_start_ms, wall_now_ms);
    segment_start_ms.saturating_add(elapsed.max(0))
}

/// 结束 / 暂停的语义时刻。
///
/// 有运行段时 =「段起点 + 单调流逝」；暂停中（`None`）直接用墙钟 —— 此时没有段在跑，
/// 再拿会话起点去加流逝会把**暂停的那段时间**算进事件时刻，fold 出来的 `ended_at`
/// 就比 `time_records.ended_at` 晚了整整一段暂停时长。
pub fn end_at(running_since: Option<i64>, wall_now_ms: i64) -> i64 {
    match running_since {
        Some(segment_start) => elapsed_at(segment_start, wall_now_ms),
        None => wall_now_ms,
    }
}

/// 在**调用方的事务**里追加一条事件。
///
/// 返回 `Ok(())` 包含「跳过」（设备身份未认领 / 会话没有 uid）：那不是失败。
/// 真正的写入错误原样向上抛，由调用方的事务回滚 —— 状态行与事件流必须一起落。
pub async fn record(
    conn: &mut SqliteConnection,
    record_id: i64,
    kind: TimerOpKind,
    at_ms: i64,
    payload: Option<&str>,
) -> AppResult<()> {
    crate::repositories::timer_ops_event::append_for_record(conn, record_id, kind, at_ms, payload)
        .await?;
    Ok(())
}

/// 开新会话后追加 `start`。`mode` / `target_sec` 进 `payload`：折叠端要用它们判定
/// 倒计时是否已到点，而它们不是「状态」—— 是 `start` 这条事件自带的参数。
pub async fn record_start(
    conn: &mut SqliteConnection,
    record_id: i64,
    at_ms: i64,
    mode: &str,
    target_sec: Option<i64>,
) -> AppResult<()> {
    let payload = crate::repositories::timer_ops::payload_for_start(mode, target_sec);
    record(conn, record_id, TimerOpKind::Start, at_ms, Some(&payload)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 语义时刻永远不早于段起点。
    ///
    /// 这条**不**断言具体数值：单调锚点是进程级全局状态，别的用例可能给同一个
    /// 起点设过锚点，写死一个数就会变成「谁先跑谁说了算」的 flake。
    #[test]
    fn elapsed_at_never_precedes_the_segment_start() {
        assert!(elapsed_at(5_000, 1_000) >= 5_000, "时钟回拨必须钳到段起点");
        let value = elapsed_at(1_000, 5_000);
        assert!(
            (1_000..=5_000).contains(&value),
            "语义时刻必须落在 [段起点, 墙钟现在] 之内，实际 {value}"
        );
    }

    /// 暂停中结束：没有运行段可参照，直接用墙钟。
    ///
    /// 这条会咬住「拿 `record.started_at` 当段起点」的写法：一条 10:00 开始、
    /// 10:10 暂停、11:00 结束的会话，用会话起点去加流逝会算出「11:00 那一秒之前又多跑了
    /// 一小时」—— 也就是把暂停的 50 分钟算进了事件时刻。
    #[test]
    fn end_at_uses_the_wall_clock_when_nothing_is_running() {
        assert_eq!(end_at(None, 42_000), 42_000);
    }
}

/* 接线验收（桌面独占）：`services::timer` 的每个动作都必须留下一条事件。
   手机端目前没有计时事件写入方（P3 的宿主建库命令还没接），所以整块挂 `desktop`。 */
#[cfg(all(test, desktop))]
mod wiring_tests {
    use sqlx::SqlitePool;

    /// 全新业务库 + 本机身份（顺带认领事项的 `device_id` / `uid`）。
    async fn fixture() -> (SqlitePool, String) {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::infra::migrate::migrate(&pool).await.unwrap();
        let install_id = crate::services::device::startup_business_identity(&pool)
            .await
            .unwrap();
        (pool, install_id)
    }

    async fn kinds(pool: &SqlitePool) -> Vec<(String, String, String)> {
        sqlx::query_as("SELECT kind, device_id, day_key FROM timer_ops ORDER BY id")
            .fetch_all(pool)
            .await
            .unwrap()
    }

    /// 一次完整的「开始 → 暂停 → 继续 → 结束」，事件流里必须有对应的五条。
    ///
    /// 键的是**两个零报错的失效形态**：
    /// 1. 接线漏了一个动作 → 对端永远看不到那次暂停，时长会多出整段；
    /// 2. `device_id` 写成空串 → `uid` 恒 NULL → 事件永不被导出，也没有任何报错。
    ///
    /// 第 2 条只能靠这一点断言抓（`uid` 本身要靠触发器发，空 `device_id` 时它不触发）。
    #[test]
    fn timer_actions_record_events_with_the_local_device() {
        tauri::async_runtime::block_on(async {
            let (pool, install_id) = fixture().await;

            crate::services::timer::start(&pool, Some(1)).await.unwrap();
            crate::services::timer::pause(&pool).await.unwrap();
            crate::services::timer::resume(&pool).await.unwrap();
            crate::services::timer::stop(&pool).await.unwrap();

            let rows = kinds(&pool).await;
            let sequence: Vec<&str> = rows.iter().map(|row| row.0.as_str()).collect();
            /* 真实时钟下这段会话只跑了毫秒级，`should_ignore` 会把它判成「太短」，
               于是 `stop` 之后再补一条 `drop`。序列里两条都接受，但**必须都在**。 */
            assert_eq!(
                sequence,
                ["start", "pause", "resume", "stop", "drop"],
                "每个计时动作都要留下一条事件，实际 {sequence:?}"
            );

            for (kind, device, day) in &rows {
                assert_eq!(
                    device, &install_id,
                    "`{kind}` 的 device_id 必须是本机身份（空串 = 永远不同步）"
                );
                assert_eq!(day.len(), 10, "`{kind}` 的 day_key 必须是 YYYY-MM-DD");
            }

            // uid 全部由触发器发出：这是「事件可导出」的唯一凭据。
            let missing: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM timer_ops WHERE uid IS NULL")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(missing, 0, "每条事件都必须有 uid");
        });
    }

    /// 结束之后，事件流折叠出来的块必须与 `time_records` 说同一件事。
    ///
    /// 这是「两套表示不分叉」的护栏：将来任何一处改了状态却没写事件（或反过来），
    /// 这条就会红。`accumulated_sec` 在真实时钟下必然是 0（毫秒级会话），所以判据落在
    /// 起止时刻与状态上 —— 时长口径由 `repositories::timer_ops_tests` 那套可控时钟钉。
    #[test]
    fn folded_block_agrees_with_time_records() {
        tauri::async_runtime::block_on(async {
            let (pool, _) = fixture().await;
            crate::services::timer::start(&pool, Some(1)).await.unwrap();
            crate::services::timer::stop(&pool).await.unwrap();

            let session_uid: String =
                sqlx::query_scalar("SELECT session_uid FROM timer_ops ORDER BY id LIMIT 1")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let block = crate::repositories::timer_ops::fold(&pool, &session_uid)
                .await
                .unwrap()
                .block
                .expect("会话必须有 start 事件");

            let (status, started_at, ended_at, accumulated_sec): (String, i64, Option<i64>, i64) =
                sqlx::query_as(
                    "SELECT status, started_at, ended_at, accumulated_sec
                       FROM time_records WHERE uid = ?1",
                )
                .bind(&session_uid)
                .fetch_one(&pool)
                .await
                .unwrap();

            assert_eq!(block.started_at_ms, started_at, "起点必须一致");
            assert_eq!(block.ended_at_ms, ended_at, "终点必须一致");
            assert_eq!(block.ended_at_ms.is_some(), status == "saved", "状态必须一致");
            assert_eq!(
                block.accumulated_sec(),
                accumulated_sec,
                "累计秒（向下取整）必须一致"
            );
        });
    }
}
