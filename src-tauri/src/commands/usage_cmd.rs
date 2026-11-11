//! 应用使用统计的 IPC 入口（0.13.0，两条命令）。
//!
//! ## 平台分叉写在**一处**
//! 桌面没有 `UsageStatsManager`，也没有原生桥；两条命令在桌面上必须「在契约里存在、
//! 但如实说没这个能力」。判据是 `usage_stats_get` 回 `supported: false`，而不是报错 ——
//! 报错会让界面上出现一条红字，而这本来就不是故障。
//!
//! ## 为什么未授权是**错误码**而不是 `granted: false`
//! 「没有权限」是一个需要界面**换一整套呈现**的状态（空态 + 去授权的按钮），不是一次
//! 普通的空结果。用 `USAGE_PERMISSION_DENIED` 表达，前端只能按这一条分支处理；
//! 若塞进 `granted: false`，每个调用方都要自己记得判，总会漏一处，漏了就是「显示 0 分钟」。

use tauri::{AppHandle, State};

use crate::error::AppResult;
use crate::models::usage::UsageDay;
use crate::state::AppState;

/* 只有安卓构建才有原生桥与「未授权」这条错误；桌面上这些名字根本不存在，
   所以导入必须跟着 `cfg(mobile)` 走，否则桌面 `cargo check` 直接报 unresolved import。 */
#[cfg(mobile)]
use tauri::Manager;
#[cfg(mobile)]
use crate::error::{AppError, ErrorCode};
#[cfg(mobile)]
use crate::infra::native_bridge::NativeBridge;
#[cfg(mobile)]
use crate::models::usage::UsageDayReply;
#[cfg(mobile)]
use crate::services::usage;

/// 取某一天的排行。`date` 是本地日 `yyyy-MM-dd`。
#[tauri::command]
pub async fn usage_stats_get(
    app: AppHandle,
    state: State<'_, AppState>,
    date: String,
) -> AppResult<UsageDay> {
    #[cfg(mobile)]
    {
        let bridge = app
            .try_state::<NativeBridge<tauri::Wry>>()
            .ok_or_else(|| AppError::io("原生桥未注册：TimingNativePlugin 没有加载"))?;

        /* 窗口 = 本地日 [00:00, 次日 00:00)。Rust 侧算好再传下去：Kotlin 不做本地日推算，
           两边各算一次必然在时区/夏令时上分叉（与 md 同步镜像根同一条教训）。 */
        let (from, to) = local_day_bounds(&date)?;
        let reply: UsageDayReply = bridge
            .call("usageDay", serde_json::json!({ "from": from, "to": to }))
            .await?;

        if !reply.granted {
            return Err(AppError::new(
                ErrorCode::UsagePermissionDenied,
                "还没有「使用情况访问」权限",
            ));
        }

        usage::rollup(&state.pool, &date, &reply.rows).await?;
    }

    #[cfg(not(mobile))]
    {
        let _ = (&app, &date, &state);
        return Ok(UsageDay {
            supported: false,
            date,
            total_sec: 0,
            rows: Vec::new(),
        });
    }

    #[cfg(mobile)]
    {
        let rows = usage::read(&state.pool, &date).await?;
        let total_sec = rows.iter().map(|row| row.sec.max(0)).sum();
        Ok(UsageDay {
            supported: true,
            date,
            total_sec,
            rows,
        })
    }
}

/// 跳到系统「使用情况访问」页。桌面是空操作。
#[tauri::command]
pub async fn usage_stats_settings(app: AppHandle) -> AppResult<()> {
    #[cfg(mobile)]
    {
        let bridge = app
            .try_state::<NativeBridge<tauri::Wry>>()
            .ok_or_else(|| AppError::io("原生桥未注册：TimingNativePlugin 没有加载"))?;
        let _: serde_json::Value = bridge
            .call("usageOpenSettings", serde_json::json!({}))
            .await?;
        return Ok(());
    }
    #[cfg(not(mobile))]
    {
        let _ = app;
        Ok(())
    }
}

/// `yyyy-MM-dd` 的本地日边界（毫秒）。
///
/// 解析失败一律 `INVALID_DURATION`？不 —— 那是时长语义。这里用 `IO_ERROR` 反而误导。
/// 选 `DB_ERROR` 也不对。**用 `INVALID_DURATION` 的邻居**：本项目错误码里没有「参数格式」，
/// 所以退回最接近的 `INVALID_DURATION` 并在消息里写清是日期，代价是错误码语义略宽
/// （已知，见 ADR-063 的「不加第 19 个码」说明）。
#[cfg(mobile)]
fn local_day_bounds(date: &str) -> AppResult<(i64, i64)> {
    use chrono::{Local, NaiveDate};
    let day = NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|error| {
        AppError::new(
            ErrorCode::InvalidDuration,
            format!("日期格式应为 yyyy-MM-dd：{date}（{error}）"),
        )
    })?;
    let start = day
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| AppError::new(ErrorCode::InvalidDuration, "日期无零点"))?;
    let start_ms = start
        .and_local_timezone(Local)
        .single()
        .map(|value| value.timestamp_millis())
        .ok_or_else(|| AppError::new(ErrorCode::InvalidDuration, "本地时区无法定位零点"))?;
    Ok((start_ms, start_ms + 24 * 60 * 60 * 1000))
}
