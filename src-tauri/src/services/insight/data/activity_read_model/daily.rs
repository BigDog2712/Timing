//! 日级双口径（`activity_daily_totals`）：**全设备并集** 与 **各设备之和**。
//!
//! ## 为什么是纯函数 + 表，而不是一条 SQL
//!
//! 并集必须用「按起点排序 + 前缀最大终点」，而 SQLite 里写成窗口函数（`MAX() OVER`）
//! 或 `LAG` 都很容易写成「取上一条的终点」——那在**完全嵌套**时会少算，而且一旦算错
//! 就没有任何东西会报错（只是热力图某天矮一截）。所以核心算法放在 Rust 纯函数里，
//! 用例可以直接钉住；SQL 只负责取区间与落表。
//!
//! ## 口径（design §3.2 ⑦ / §6.5）
//!
//! | 列 | 含义 | 上界 |
//! |---|---|---|
//! | `union_ms` | 全设备并集 | ≤ 24h，可以画进度条 |
//! | `device_sum_ms` | 各设备自己的墙钟之和 | 可 > 24h，**绝不许**画进度条 |
//! | `device_count` | 该天有活动的设备数 | — |
//!
//! 单设备时两者恒等，这是 P1「数字逐位不变」的支点。
//!
//! ## 只存完整的天
//!
//! 今天的"现在"每几秒变一次，落表必然滞后且无法自证，所以 `refresh_days` 跳过
//! `day_end > now` 的天，今天由读命令用同一个纯函数现算（`load_range`）。

use super::facts::resolve_activity_spans;
use super::now_ms;
use crate::infra::insight::clock::local_day_range_at;
use crate::services::insight::data::activity_read_model::{DailyDeviceTotalDto, DailyTotalsDto};
use sqlx::{Pool, Row, Sqlite, Transaction};

/// 一天的双口径结果。`devices` 是「每台设备自己的并集」，顺序按 `install_id` 稳定。
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(super) struct DayTotals {
    pub(super) union_ms: i64,
    pub(super) device_sum_ms: i64,
    pub(super) devices: Vec<(String, i64)>,
}

impl DayTotals {
    fn device_count(&self) -> i64 {
        self.devices.len() as i64
    }
}

/// 一天的并集与分设备合计。
///
/// `intervals` 是 `(device_id, start_ms, end_ms)`；半开区间，`end <= start` 的会被丢掉
/// （零长度会话在真实库里有一堆：`sessions.duration = 0`）。
///
/// 两个量都是 `i64` 毫秒：整数比较，不做浮点。
pub(super) fn compute_day<S: AsRef<str>>(intervals: &[(S, i64, i64)]) -> DayTotals {
    let mut all: Vec<(i64, i64)> = intervals
        .iter()
        .map(|(_, start_ms, end_ms)| (*start_ms, *end_ms))
        .collect();
    let union_total_ms = union_span_ms(&mut all);
    let mut device_ids: Vec<&str> = intervals.iter().map(|(device, ..)| device.as_ref()).collect();
    device_ids.sort_unstable();
    device_ids.dedup();
    let mut devices: Vec<(String, i64)> = Vec::with_capacity(device_ids.len());
    for device_id in device_ids {
        let mut spans: Vec<(i64, i64)> = intervals
            .iter()
            .filter(|(device, ..)| device.as_ref() == device_id)
            .map(|(_, start_ms, end_ms)| (*start_ms, *end_ms))
            .collect();
        devices.push((device_id.to_string(), union_span_ms(&mut spans)));
    }
    let device_sum_ms = devices.iter().map(|(_, value)| *value).sum();
    DayTotals {
        union_ms: union_total_ms,
        device_sum_ms,
        devices,
    }
}

/// 排序 + **前缀最大终点**求并集总长 —— 实现搬去 `buckets::union_span_ms`。
///
/// 搬家的理由是 T07：热力/趋势的**逐桶**并集要用同一条规则，两处各抄一份迟早会
/// 一份改成 `LAG` 一份没改（`daily_tests` 里那条变异靶子就是专门咬这个错的）。
/// 这里保留 `use` 别名，本文件的调用点一个字都不用改。
use super::buckets::union_span_ms;

/// 重建 `[from_ms, to_ms)` 覆盖到的**已关闭**本地日的日级表。
///
/// 事务由调用方持有（和 `replace_projection_range` 同一个批次一个事务）。
pub(super) async fn refresh_days(
    tx: &mut Transaction<'_, Sqlite>,
    from_ms: i64,
    to_ms: i64,
    revision: i64,
) -> Result<(), String> {
    let sampled_at_ms = now_ms();
    let (mut day_start_ms, mut day_end_ms) = local_day_range_at(from_ms)?;
    while day_start_ms < to_ms {
        if day_end_ms > sampled_at_ms {
            break;
        }
        replace_day(tx, day_start_ms, day_end_ms, revision, sampled_at_ms).await?;
        let Ok((next_start_ms, next_end_ms)) = local_day_range_at(day_end_ms) else {
            break;
        };
        day_start_ms = next_start_ms;
        day_end_ms = next_end_ms;
    }
    Ok(())
}

async fn replace_day(
    tx: &mut Transaction<'_, Sqlite>,
    day_start_ms: i64,
    day_end_ms: i64,
    revision: i64,
    sampled_at_ms: i64,
) -> Result<(), String> {
    let totals = day_totals_in_tx(tx, day_start_ms, day_end_ms, sampled_at_ms).await?;
    let day_key = day_key_of(day_start_ms)?;
    sqlx::query("DELETE FROM activity_daily_totals WHERE day_key = ?")
        .bind(&day_key)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to clear daily totals for {day_key}: {error}"))?;
    insert_row(tx, &day_key, "*", &totals, revision, sampled_at_ms).await?;
    for (device_id, union_ms) in &totals.devices {
        let scoped = DayTotals {
            union_ms: *union_ms,
            device_sum_ms: *union_ms,
            devices: Vec::new(),
        };
        insert_row(tx, &day_key, device_id, &scoped, revision, sampled_at_ms).await?;
    }
    Ok(())
}

async fn insert_row(
    tx: &mut Transaction<'_, Sqlite>,
    day_key: &str,
    device_scope: &str,
    totals: &DayTotals,
    revision: i64,
    sampled_at_ms: i64,
) -> Result<(), String> {
    let device_count = if device_scope == "*" {
        totals.device_count()
    } else {
        1
    };
    sqlx::query(
        "INSERT INTO activity_daily_totals(
           day_key, device_scope, union_ms, device_sum_ms, device_count, computed_revision,
           updated_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(day_key)
    .bind(device_scope)
    .bind(totals.union_ms)
    .bind(totals.device_sum_ms)
    .bind(device_count)
    .bind(revision)
    .bind(sampled_at_ms)
    .execute(&mut **tx)
    .await
    .map(|_| ())
    .map_err(|error| format!("failed to store daily totals for {day_key}/{device_scope}: {error}"))
}

/// 从**事实**取真实区间（不是从小时投影行反推几何）。
///
/// 这里踩过一个坑，写下来免得后人再踩：`activity_hourly_effective` 只有
/// `(bucket_start_ms, effective_duration_ms)`，**位置信息已经丢了**——同一小时里
/// 两个应用都从 `bucket_start` 起算，看起来就是「并发」。生产库 2026-10-15 的真值是
/// 会话加总 20,617,254 ms、并集也是 20,617,254 ms（会话本来就首尾相接），而按投影行
/// 当区间算出来的并集只有 12,094,169 ms——差的 40% 全是虚构出来的重叠。
///
/// 所以日级口径与投影写侧共用同一套事实读取与优先级裁剪（`load_fact_candidates` +
/// `resolve_activity_precedence`），只是把结果按本地日裁剪后再求并集。
async fn day_totals_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    day_start_ms: i64,
    day_end_ms: i64,
    sampled_at_ms: i64,
) -> Result<DayTotals, String> {
    let spans = resolve_activity_spans(tx, day_start_ms, day_end_ms, sampled_at_ms).await?;
    Ok(compute_day(&spans))
}

/// 读一批本地日的双口径。**今天现算**（不落表），其余读表。
pub(super) async fn load_range(
    pool: &Pool<Sqlite>,
    day_keys: &[String],
    sampled_at_ms: i64,
) -> Result<Vec<DailyTotalsDto>, String> {
    let (today_start_ms, today_end_ms) = local_day_range_at(sampled_at_ms)?;
    let today_key = day_key_of(today_start_ms)?;
    let mut response = Vec::with_capacity(day_keys.len());
    for day_key in day_keys {
        if *day_key == today_key {
            let mut tx = pool
                .begin()
                .await
                .map_err(|error| format!("failed to begin daily totals read: {error}"))?;
            let totals =
                day_totals_in_tx(&mut tx, today_start_ms, today_end_ms, sampled_at_ms).await?;
            tx.commit()
                .await
                .map_err(|error| format!("failed to finish daily totals read: {error}"))?;
            response.push(to_dto(day_key.clone(), &totals));
            continue;
        }
        let rows = sqlx::query(
            "SELECT device_scope, union_ms, device_sum_ms, device_count
             FROM activity_daily_totals WHERE day_key = ? ORDER BY device_scope",
        )
        .bind(day_key)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to read daily totals for {day_key}: {error}"))?;
        let Some(overall) = rows.iter().find(|row| row.get::<String, _>("device_scope") == "*")
        else {
            continue;
        };
        let devices = rows
            .iter()
            .filter(|row| row.get::<String, _>("device_scope") != "*")
            .map(|row| DailyDeviceTotalDto {
                device_id: row.get("device_scope"),
                union_ms: row.get("union_ms"),
            })
            .collect();
        response.push(DailyTotalsDto {
            day_key: day_key.clone(),
            union_ms: overall.get("union_ms"),
            device_sum_ms: overall.get("device_sum_ms"),
            device_count: overall.get("device_count"),
            devices,
        });
    }
    Ok(response)
}

fn to_dto(day_key: String, totals: &DayTotals) -> DailyTotalsDto {
    DailyTotalsDto {
        day_key,
        union_ms: totals.union_ms,
        device_sum_ms: totals.device_sum_ms,
        device_count: totals.device_count(),
        devices: totals
            .devices
            .iter()
            .map(|(device_id, union_ms)| DailyDeviceTotalDto {
                device_id: device_id.clone(),
                union_ms: *union_ms,
            })
            .collect(),
    }
}

/// 本地日的 `YYYY-MM-DD`（与 md 同步的 `{date}.md`、`app_usage.local_date` 同口径）。
fn day_key_of(day_start_ms: i64) -> Result<String, String> {
    use chrono::TimeZone;
    chrono::Local
        .timestamp_millis_opt(day_start_ms)
        .single()
        .map(|local| local.format("%Y-%m-%d").to_string())
        .ok_or_else(|| format!("invalid local day start {day_start_ms}"))
}
