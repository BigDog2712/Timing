//! 事项块 / 子记录命令（活动库 + 业务库，仅桌面）。
//!
//! 三条命令构成「时间轴上点开一个块，看到它的子记录」这条路：
//!
//! 1. `cmd_project_focus_blocks`：把业务库 `time_records` 投影进活动库 `focus_blocks`。
//!    跨库，所以必须同时拿 `State<AppState>`（业务库池）与 `AppHandle`（活动库池）。
//! 2. `cmd_list_focus_blocks`：按区间读块（时间轴 / 历史页）。
//! 3. `cmd_get_block_detail`：块 ∩ 应用事实 → 子记录 + 分类汇总（切片在纯函数里，
//!    见 `attribution::slice`）。
//!
//! ## 为什么投影要显式命令而不是「每次读之前自己刷新」
//!
//! 刷新是有代价的（读全表 + 写全表）。时间轴每次滚动都刷一遍会让「拖动时间轴」
//! 变成「每秒几十次跨库写」。所以拆成两个动作：写入方（计时结束、启动、用户手动
//! 点「刷新」）负责推，读方只读。

use tauri::{AppHandle, Runtime, State};

use crate::services::insight::data::focus_blocks::{
    self, BlockDetailDto, FocusBlockDto, ProjectionReport,
};
use crate::services::insight::data::sqlite_pool::wait_for_sqlite_pool;
use crate::state::AppState;

/// 投影块。`since_ms` 为空 = 全量重推（修复用）。
#[tauri::command]
pub async fn cmd_project_focus_blocks<R: Runtime>(
    state: State<'_, AppState>,
    app: AppHandle<R>,
    since_ms: Option<i64>,
) -> Result<ProjectionReport, String> {
    let activity = wait_for_sqlite_pool(&app).await?;
    focus_blocks::project(&state.pool, &activity, since_ms).await
}

/// 按区间读块（与区间相交即返回，包含进行中的块）。
#[tauri::command]
pub async fn cmd_list_focus_blocks<R: Runtime>(
    app: AppHandle<R>,
    start_ms: i64,
    end_ms: i64,
) -> Result<Vec<FocusBlockDto>, String> {
    let activity = wait_for_sqlite_pool(&app).await?;
    focus_blocks::list_blocks(&activity, start_ms, end_ms).await
}

/// 一个块的详情：块 + 子记录 + 按分类汇总。
#[tauri::command]
pub async fn cmd_get_block_detail<R: Runtime>(
    app: AppHandle<R>,
    block_uid: String,
) -> Result<BlockDetailDto, String> {
    let activity = wait_for_sqlite_pool(&app).await?;
    focus_blocks::block_detail(
        &activity,
        &block_uid,
        crate::infra::insight::clock::unix_timestamp_millis_i64(),
    )
    .await
}
