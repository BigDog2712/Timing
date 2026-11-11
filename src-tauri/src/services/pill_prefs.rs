//! 悬浮条外观 / 手柄绑定的持久化（[0.12.1 归一]）。
//!
//! 单独成文件的理由只有一个：`services/settings.rs` 只剩 2 行余量（单文件 ≤300 行门禁）。
//! 语义仍是 settings 域的一部分 —— `settings::get` / `settings::update` 直接调这里，
//! 别处不许再读写这个键（唯一真源只有一份写入口）。
//!
//! 键是**一个** KV：整份快照 JSON。不用三个键（外观 / 手柄）是因为半份写入的合并口径
//! 必须只有一处，两个键就要写两遍「读旧 → 覆盖 → 归一」。

use serde::Serialize;
use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::models::pill_prefs::{merge_pill_prefs, PillPrefs, PillPrefsPatch};
use crate::repositories::settings as repo;

/// KV 键。字面量全仓只出现这一行。
const KEY_PILL_PREFS: &str = "timing.pill_prefs";

/// 读整份快照。键缺失 / JSON 损坏 → `None`（前端据此判断「库里没写过」，做一次迁移）。
///
/// 解码失败不报错是刻意的：药丸启动不能因为一段坏配置就崩，回落默认比抛错好。
pub async fn read(pool: &SqlitePool) -> AppResult<Option<PillPrefs>> {
    let raw = repo::get_value(pool, KEY_PILL_PREFS).await?;
    Ok(raw.and_then(|value| serde_json::from_str::<PillPrefs>(&value).ok()))
}

/// 写入半份 patch：读旧 → 覆盖 → 归一 → **写全量**。
///
/// 写全量而不是「只更新 patch 里给的字段」：前端两个卡各自只发一半，只写一半会让另半份
/// 回默认（用户调一次不透明度就丢手柄绑定）。合并与归一的唯一实现在 `merge_pill_prefs`。
pub async fn write(pool: &SqlitePool, patch: &PillPrefsPatch, now: i64) -> AppResult<()> {
    let merged = merge_pill_prefs(read(pool).await?, patch);
    let encoded = encode(&merged)?;
    repo::set_value(pool, KEY_PILL_PREFS, &encoded, now).await
}

fn encode<T: Serialize>(value: &T) -> AppResult<String> {
    serde_json::to_string(value).map_err(AppError::db)
}
