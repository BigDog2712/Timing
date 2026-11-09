//! 悬浮条快照的组装（[V0.11.27]）。
//!
//! 位置在 `services` 而不是 `app`：`app::events` 与 `bootstrap` 都要用它，而两边都只能
//! 依赖 services；放 `app` 会被 `bootstrap` 反向依赖成环。
//!
//! 为什么单独一个文件而不是塞进 `services/timer.rs`：那边 257 行，离 300 行门禁只剩一次
//! 「顺手加个函数」的距离（这个仓已经因为贴线被拦过四次）。

use sqlx::SqlitePool;

use crate::error::AppResult;
use crate::models::overlay::OverlaySnapshot;
use crate::models::timer::TimerState;
use crate::repositories::item as item_repo;

/// 组装一份可直接推给安卓悬浮服务的快照。
///
/// 事项名缺失（事项被删 / 待机）落空串——悬浮条会退化成只显示时长，不给用户看
/// 「未命名」这种占位词。
///
/// 桌面目标上唯一的调用方（`app::overlay_push::push`）是空实现，所以这里会报
/// `dead_code`。**不整段 `cfg` 掉**：一旦 `cfg` 掉，这个函数就永远只在手机包里有，
/// 桌面 `cargo test` 编不到它，下一个人重构时编译器也不提醒他调用点已经断了。
#[cfg_attr(desktop, allow(dead_code))]
pub async fn snapshot(pool: &SqlitePool, state: &TimerState) -> AppResult<OverlaySnapshot> {
    let item = match state.session.as_ref() {
        Some(record) => item_repo::find_by_id(pool, record.item_id)
            .await?
            .map(|it| it.name)
            .unwrap_or_default(),
        None => String::new(),
    };
    Ok(OverlaySnapshot::of(state, &item))
}
