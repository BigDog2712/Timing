//! 事项 ↔ 应用绑定的业务层：校验（事项存在 / `app_key` 非空）后委托仓储。
//!
//! 校验放在这里而不是仓储：仓储只该回答「SQL 怎么写」，而「绑一个不存在的事项」
//! 是业务上的错误（前端应该提示「事项已删除」），不该由 SQL 的外键错误来表达
//! （SQLite 的外键默认还是关的，靠它守等于没守）。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::models::item_app::ItemApp;
use crate::platform::clock::now_ms;
use crate::repositories::item as item_repo;
use crate::repositories::item_app as repo;

/// `track` 只接受 0 / 1（表上有 CHECK，但先在这里翻成业务错误码：
/// 否则前端拿到的是 `DB_ERROR: 数据库操作失败`，用户不知道自己做错了什么）。
fn normalize_track(track: Option<i64>) -> AppResult<i64> {
    match track.unwrap_or(1) {
        0 => Ok(0),
        1 => Ok(1),
        _ => Err(AppError::invalid_duration()),
    }
}

fn normalize_app_key(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::item_name_empty());
    }
    Ok(trimmed.to_string())
}

pub async fn list_for_item(pool: &SqlitePool, item_id: i64) -> AppResult<Vec<ItemApp>> {
    repo::list_for_item(pool, item_id).await
}

pub async fn list_for_app(pool: &SqlitePool, app_key: &str) -> AppResult<Vec<ItemApp>> {
    repo::list_for_app(pool, &normalize_app_key(app_key)?).await
}

pub async fn bind(
    pool: &SqlitePool,
    item_id: i64,
    app_key: &str,
    track: Option<i64>,
) -> AppResult<ItemApp> {
    if item_repo::find_by_id(pool, item_id).await?.is_none() {
        return Err(AppError::item_not_found());
    }
    let key = normalize_app_key(app_key)?;
    let track = normalize_track(track)?;
    repo::bind(pool, item_id, &key, track, now_ms()).await?;
    Ok(ItemApp {
        item_id,
        app_key: key,
        track,
    })
}

pub async fn unbind(pool: &SqlitePool, item_id: i64, app_key: &str) -> AppResult<bool> {
    repo::unbind(pool, item_id, &normalize_app_key(app_key)?).await
}
