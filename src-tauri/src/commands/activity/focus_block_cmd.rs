//! 事项块 / 子记录命令（活动库 + 业务库，仅桌面）。
//!
//! 四条命令构成「时间轴上看到事项，行下看到子记录」这条路：
//!
//! 1. `cmd_project_focus_blocks`：把业务库 `time_records` 投影进活动库 `focus_blocks`。
//!    跨库，所以必须同时拿 `State<AppState>`（业务库池）与 `AppHandle`（活动库池）。
//! 2. `cmd_list_focus_blocks`：按区间读块（时间轴 / 历史页）。
//! 3. `cmd_get_block_detail`：块 ∩ 应用事实 → 子记录 + 分类汇总（切片在纯函数里，
//!    见 `attribution::slice`）。
//! 4. `cmd_get_item_timeline`：双层时间轴的读模型（事项一行 + 子记录 + 空档）。
//!
//! ## 为什么投影要显式命令而不是「每次读之前自己刷新」
//!
//! 刷新是有代价的（读全表 + 写全表）。时间轴每次滚动都刷一遍会让「拖动时间轴」
//! 变成「每秒几十次跨库写」。所以拆成两个动作：写入方（计时结束、启动、用户手动
//! 点「刷新」）负责推，读方只读。
//!
//! ## 为什么 `cmd_get_item_timeline` 是个例外
//!
//! 它读之前会补一次**增量**投影。理由是推的时机没地方放：`services::timer` 跨平台，
//! 手机侧没有活动库（`insight` 整块 `#[cfg(desktop)]`），不能在 stop 里推；而这条
//! 命令本身是「打开时间轴」触发的，一次一个区间（不是滚动帧），代价被
//! `since_ms` 界定。投影失败**不阻断读取**：读到的可能是上一轮的块，比整块空白好，
//! 与设计文档 §5「失败不回滚业务库，只记待补」一致。

use tauri::{AppHandle, Runtime, State};

use crate::services::activity::data::focus_blocks::{
    self, BlockDetailDto, FocusBlockDto, ItemTimelineDto, ProjectionReport,
};
use crate::services::activity::data::sqlite_pool::wait_for_sqlite_pool;
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
        crate::infra::activity::clock::unix_timestamp_millis_i64(),
    )
    .await
}

/// 双层时间轴：一个事项一行，行下挂子记录与「未采集」空档。
#[tauri::command]
pub async fn cmd_get_item_timeline<R: Runtime>(
    state: State<'_, AppState>,
    app: AppHandle<R>,
    start_ms: i64,
    end_ms: i64,
) -> Result<Vec<ItemTimelineDto>, String> {
    let activity = wait_for_sqlite_pool(&app).await?;
    let now = crate::infra::activity::clock::unix_timestamp_millis_i64();
    /* 旧 KV 配置回填（守卫键保证只真跑一次）。放在这里而不是只等设置页点按钮：
       分类绑定为空时每个子记录都会落到 `other`，而规则 2 会给出一个**看起来正确**
       的答案 —— 用户看到的是「分类全错了」而不是「还没迁移」（设计文档 §13）。 */
    if let Err(error) =
        crate::services::activity::data::legacy_bindings::backfill(&state.pool, &activity, now).await
    {
        crate::log_warn!("legacy binding backfill failed: {error}");
    }
    /* 自愈式增量投影（理由见文件头）。失败只告警：让用户看到上一轮的块，
       比让时间轴整块空白更容易理解。 */
    if let Err(error) = focus_blocks::project(&state.pool, &activity, Some(start_ms)).await {
        crate::log_warn!("focus block projection before timeline failed: {error}");
    }
    focus_blocks::item_timeline(&activity, start_ms, end_ms, now).await
}
