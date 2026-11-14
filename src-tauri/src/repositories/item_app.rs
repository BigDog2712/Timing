//! 事项 ↔ 应用绑定仓库（`item_app` 表，业务库）。
//!
//! ## 为什么在这里而不是活动库
//!
//! 绑定属于「意图」层（我打算在做学习SQL时用 chrome），与事项同库才能在一个事务里
//! 完成「删事项 → 绑定跟着走」。活动库那边只消费 `focus_blocks` 的投影，不需要读绑定。
//!
//! ## 幂等
//!
//! `UNIQUE(item_id, app_key)` + `ON CONFLICT DO UPDATE`：重复绑定同一个应用只改 `track`，
//! 不再插一行。前端「勾选应用」的交互天然会重复调用它。

use sqlx::SqlitePool;

use crate::error::AppResult;
use crate::models::item_app::ItemApp;

const COLS: &str = "item_id, app_key, track";

/// 某个事项绑定的全部应用。
pub async fn list_for_item(pool: &SqlitePool, item_id: i64) -> AppResult<Vec<ItemApp>> {
    let sql = format!("SELECT {COLS} FROM item_app WHERE item_id = ?1 ORDER BY app_key ASC");
    Ok(sqlx::query_as::<_, ItemApp>(&sql)
        .bind(item_id)
        .fetch_all(pool)
        .await?)
}

/// 某个应用被哪些事项绑定（反向查询：设置页要展示「chrome 参与了哪些事项」）。
pub async fn list_for_app(pool: &SqlitePool, app_key: &str) -> AppResult<Vec<ItemApp>> {
    let sql = format!("SELECT {COLS} FROM item_app WHERE app_key = ?1 ORDER BY item_id ASC");
    Ok(sqlx::query_as::<_, ItemApp>(&sql)
        .bind(app_key)
        .fetch_all(pool)
        .await?)
}

/// 绑定（已存在则只更新 `track`）。
///
/// `device_id` 必须显式写：`uid`（`b:<device>:<id>`）由 AFTER INSERT 触发器按它发，
/// 漏了它 → uid 恒 NULL → 这条绑定永远不同步，且零报错。
pub async fn bind(pool: &SqlitePool, item_id: i64, app_key: &str, track: i64, now: i64) -> AppResult<()> {
    let device_id = crate::services::identity::install_id().unwrap_or_default();
    sqlx::query(
        "INSERT INTO item_app(item_id, app_key, track, created_at, updated_at, device_id)
         VALUES (?1, ?2, ?3, ?4, ?4, ?5)
         ON CONFLICT(item_id, app_key) DO UPDATE SET track = excluded.track, updated_at = excluded.updated_at",
    )
    .bind(item_id)
    .bind(app_key)
    .bind(track)
    .bind(now)
    .bind(device_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// 解绑。返回是否真的删掉了一行（前端据此决定要不要提示「本来就没绑」）。
pub async fn unbind(pool: &SqlitePool, item_id: i64, app_key: &str) -> AppResult<bool> {
    let result = sqlx::query("DELETE FROM item_app WHERE item_id = ?1 AND app_key = ?2")
        .bind(item_id)
        .bind(app_key)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}
