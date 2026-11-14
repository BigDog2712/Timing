//! 日级双口径的「逐位相等」基线（T04 的唯一硬验收）。
//!
//! 两个 `#[ignore]` 用例，**顺序不能反**：
//!
//! ```text
//! # 改动前（T03 收绿、daily.rs 还没写）
//! TIMING_PARITY_DB=D:/tmp/p1-parity.db TIMING_PARITY_OUT=D:/tmp/baseline.json \
//!   cargo +1.100.0 test --lib daily_parity -- --ignored --nocapture capture
//!
//! # 改动后
//! TIMING_PARITY_DB=D:/tmp/p1-parity.db TIMING_PARITY_OUT=D:/tmp/baseline.json \
//!   cargo +1.100.0 test --lib daily_parity -- --ignored --nocapture verify
//! ```
//!
//! `capture` 只读两样东西：`activity_hourly_effective`（每个桶的毫秒数）与
//! `sessions`（每个会话的起点），**一个字节都不碰 `daily.rs`**。这是有意的：
//! 一旦 capture 用新写的 `compute_day` 去算基线，"逐位相等"就变成了自证。
//!
//! 基线库是生产库的 `VACUUM INTO` 拷贝（**对生产零写入**），所以这里的数字是
//! 真实值：14408 条会话、31 个本地日。不用合成数据造 200 天，是因为真库够用；
//! 而"两设备完全嵌套"那种形状生产里没有（会话之间零重叠），由 `daily.rs` 的
//! 纯函数用例覆盖，并作为变异自证的靶子。

use crate::infra::insight::clock::local_day_range_at;
use crate::services::insight::data::activity_read_model;
use crate::services::insight::data::sqlite_pool::open_single_connection_sqlite_pool;
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Row, Sqlite};
use std::collections::BTreeMap;
use std::path::Path;

/// 一个本地日的基线读数。
///
/// `session_count` 按会话**起点**归属（与前端 `heatmapDays` 同口径）；`hourly_*`
/// 按桶起点归属。两者都是"改动前的读法"，这是基线该有的样子。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DayBaseline {
    day_key: String,
    hourly_sum_ms: i64,
    hourly_row_count: i64,
    session_count: i64,
    closed: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Baseline {
    projection_rows: i64,
    days: Vec<DayBaseline>,
}

#[test]
#[ignore = "captures the pre-T04 baseline; run with TIMING_PARITY_DB + TIMING_PARITY_OUT"]
fn daily_parity_capture() {
    tauri::async_runtime::block_on(async {
        let pool = open_parity_pool().await;
        drain(&pool).await;
        let baseline = measure(&pool).await;
        assert!(
            baseline.projection_rows > 0,
            "投影是空的：基线库没走到 ready，采到的 0 会让后面所有断言失去意义"
        );
        let out = std::env::var("TIMING_PARITY_OUT").expect("TIMING_PARITY_OUT must be set");
        std::fs::write(&out, serde_json::to_vec_pretty(&baseline).unwrap()).unwrap();
        let closed = baseline.days.iter().filter(|day| day.closed).count();
        println!(
            "captured {} days ({} closed) / {} projection rows -> {out}",
            baseline.days.len(),
            closed,
            baseline.projection_rows
        );
        pool.close().await;
    });
}

#[test]
#[ignore = "verifies the daily table against the captured baseline; run with TIMING_PARITY_DB"]
fn daily_parity_verify() {
    tauri::async_runtime::block_on(async {
        let out = std::env::var("TIMING_PARITY_OUT").expect("TIMING_PARITY_OUT must be set");
        let baseline: Baseline =
            serde_json::from_slice(&std::fs::read(&out).expect("baseline file is missing")).unwrap();
        let pool = open_parity_pool().await;
        // 基线库的投影是 capture 那次建的，日表当时还不存在。这里把小时模型置回 invalid
        // 强制**全量重建**：既填出日表，又顺手证明「同一份事实重算一遍，小时读数逐位不变」。
        sqlx::query(
            "UPDATE read_model_state SET state = 'invalid' WHERE model_name = 'activity_hourly'",
        )
        .execute(&pool)
        .await
        .unwrap();
        drain(&pool).await;

        // ① 小时投影本身没被 T04 改动：行数与逐日读数必须与基线一模一样。
        let after = measure(&pool).await;
        assert_eq!(after.projection_rows, baseline.projection_rows);
        assert_eq!(after.days, baseline.days, "hourly read changed");

        // ② 已关闭日的日级表与基线逐位相等（整数比较，不是浮点）。
        let stored: Vec<(String, i64, i64)> = sqlx::query_as(
            "SELECT day_key, union_ms, device_sum_ms FROM activity_daily_totals
             WHERE device_scope = '*' ORDER BY day_key",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        let closed: Vec<&DayBaseline> = baseline.days.iter().filter(|day| day.closed).collect();
        assert_eq!(
            stored.iter().map(|(key, ..)| key.clone()).collect::<Vec<_>>(),
            closed.iter().map(|day| day.day_key.clone()).collect::<Vec<_>>(),
            "closed-day set in activity_daily_totals must match the baseline exactly"
        );
        for (index, (day_key, union_ms, device_sum_ms)) in stored.iter().enumerate() {
            let expected = closed[index].hourly_sum_ms;
            assert_eq!(*union_ms, expected, "{day_key}: union_ms");
            assert_eq!(*device_sum_ms, expected, "{day_key}: device_sum_ms");
        }

        // ③ 今天不落表：今天的"现在"每几秒都在变，落表必然滞后且无法自证。
        let today = day_key_of(now_ms()).unwrap();
        assert!(
            !stored.iter().any(|(day_key, ..)| *day_key == today),
            "{today} must be computed on demand, not stored"
        );
        println!(
            "verified {} closed days against {out} ({} projection rows)",
            stored.len(),
            baseline.projection_rows
        );
        pool.close().await;
    });
}

async fn open_parity_pool() -> Pool<Sqlite> {
    let path = std::env::var("TIMING_PARITY_DB").expect("TIMING_PARITY_DB must point at a copy");
    open_single_connection_sqlite_pool(Path::new(&path), false)
        .await
        .unwrap()
}

/// 反复驱动读模型维护直到没有活可干（全量回填是 7 天一批）。
async fn drain(pool: &Pool<Sqlite>) {
    for _ in 0..1000 {
        if !activity_read_model::maintain_once(pool).await.unwrap() {
            return;
        }
    }
    panic!("read model maintenance did not converge");
}

async fn measure(pool: &Pool<Sqlite>) -> Baseline {
    let mut days: BTreeMap<String, DayBaseline> = BTreeMap::new();
    let rows = sqlx::query("SELECT bucket_start_ms, effective_duration_ms FROM activity_hourly_effective")
        .fetch_all(pool)
        .await
        .unwrap();
    for row in &rows {
        let bucket_start_ms: i64 = row.get("bucket_start_ms");
        let duration_ms: i64 = row.get("effective_duration_ms");
        let entry = day_entry(&mut days, bucket_start_ms);
        entry.hourly_sum_ms += duration_ms;
        entry.hourly_row_count += 1;
    }
    for row in sqlx::query("SELECT start_time FROM sessions")
        .fetch_all(pool)
        .await
        .unwrap()
    {
        day_entry(&mut days, row.get("start_time")).session_count += 1;
    }
    Baseline {
        projection_rows: rows.len() as i64,
        days: days.into_values().collect(),
    }
}

/// 取（或建）某个时刻所属本地日的条目，并顺手把「今天以前 = 已关闭」判定算好。
fn day_entry<'a>(
    days: &'a mut BTreeMap<String, DayBaseline>,
    at_ms: i64,
) -> &'a mut DayBaseline {
    let (day_start_ms, day_end_ms) = local_day_range_at(at_ms).unwrap();
    let day_key = day_key_of(day_start_ms).unwrap();
    days.entry(day_key.clone())
        .or_insert_with(|| DayBaseline {
            day_key,
            hourly_sum_ms: 0,
            hourly_row_count: 0,
            session_count: 0,
            closed: day_end_ms <= now_ms(),
        })
}

fn day_key_of(at_ms: i64) -> Result<String, String> {
    use chrono::TimeZone;
    chrono::Local
        .timestamp_millis_opt(at_ms)
        .single()
        .map(|local| local.format("%Y-%m-%d").to_string())
        .ok_or_else(|| format!("invalid local timestamp {at_ms}"))
}

fn now_ms() -> i64 {
    crate::infra::insight::clock::unix_timestamp_millis_i64()
}
