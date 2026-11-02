//! 主题 / 四色 / 倒计时预设业务（settings 键读写 + hex 校验）。
//!
//! 存储编码：值为 **JSON 文本**（模式字符串 / hex 字符串 / `null` / 秒数数组），
//! 与 `schema-V0.2.0.sql` 的种子一致；读取失败一律回落令牌默认值（不抛错）。

use serde::de::DeserializeOwned;
use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::models::constants::*;
use crate::models::theme::{
    default_presets, is_valid_hex, normalize_presets, AccentColors, AccentPatch, ThemeChanged,
    ThemeMode, ThemeSettings,
};
use crate::platform::clock::now_ms;
use crate::repositories::settings as repo;

/// 读取主题设置。
pub async fn settings(pool: &SqlitePool) -> AppResult<ThemeSettings> {
    Ok(ThemeSettings {
        mode: mode(pool).await?,
    })
}

/// 组装 `theme-changed` 事件载荷（主题模式 + 四色），供广播使用。
pub async fn changed(pool: &SqlitePool) -> AppResult<ThemeChanged> {
    Ok(ThemeChanged {
        mode: mode(pool).await?,
        accents: accents(pool).await?,
    })
}

/// 读取主题模式（缺失 / 损坏 → 默认）。
pub async fn mode(pool: &SqlitePool) -> AppResult<ThemeMode> {
    Ok(read::<ThemeMode>(pool, KEY_THEME_MODE)
        .await?
        .unwrap_or_default())
}

/// 写入主题模式。
pub async fn set_mode(pool: &SqlitePool, mode: ThemeMode) -> AppResult<ThemeMode> {
    let encoded = encode(&mode)?;
    repo::set_value(pool, KEY_THEME_MODE, &encoded, now_ms()).await?;
    Ok(mode)
}

/// 读取四色（未配 / 损坏 → 令牌默认值；`bar` 可空 = 跟随主题）。
pub async fn accents(pool: &SqlitePool) -> AppResult<AccentColors> {
    let fallback = AccentColors::default();
    let running = read::<String>(pool, KEY_ACCENT_RUNNING)
        .await?
        .unwrap_or(fallback.running);
    let warn = read::<String>(pool, KEY_ACCENT_WARN)
        .await?
        .unwrap_or(fallback.warn);
    let done = read::<String>(pool, KEY_ACCENT_DONE)
        .await?
        .unwrap_or(fallback.done);
    // 双层 Option：字段写成 JSON `null` ⇒ bar = None（跟随主题）
    let bar = read::<Option<String>>(pool, KEY_ACCENT_BAR)
        .await?
        .flatten();
    Ok(AccentColors {
        running,
        warn,
        done,
        bar,
    })
}

/// 部分更新四色；非法 hex → `INVALID_COLOR`。
///
/// **先整体校验、后统一落盘**：任一色值非法则整批拒绝，避免半成功状态。
pub async fn set_accents(pool: &SqlitePool, patch: &AccentPatch) -> AppResult<AccentColors> {
    let running = validate_opt(&patch.running)?;
    let warn = validate_opt(&patch.warn)?;
    let done = validate_opt(&patch.done)?;
    let bar = match patch.bar.as_ref() {
        // 显式传值：校验后写入（null ⇒ 跟随主题）
        Some(Some(value)) => Some(Some(validate_hex(value)?)),
        Some(None) => Some(None),
        None => None,
    };

    let now = now_ms();
    if let Some(value) = running {
        repo::set_value(pool, KEY_ACCENT_RUNNING, &encode(&value)?, now).await?;
    }
    if let Some(value) = warn {
        repo::set_value(pool, KEY_ACCENT_WARN, &encode(&value)?, now).await?;
    }
    if let Some(value) = done {
        repo::set_value(pool, KEY_ACCENT_DONE, &encode(&value)?, now).await?;
    }
    if let Some(value) = bar {
        let encoded = match value {
            Some(hex) => encode(&hex)?,
            None => "null".to_string(),
        };
        repo::set_value(pool, KEY_ACCENT_BAR, &encoded, now).await?;
    }
    accents(pool).await
}

/// 读取倒计时预设（缺失 / 空 / 损坏 → 默认）。
pub async fn presets(pool: &SqlitePool) -> AppResult<Vec<i64>> {
    let parsed = read::<Vec<i64>>(pool, KEY_COUNTDOWN_PRESETS).await?;
    Ok(match parsed {
        Some(list) if !list.is_empty() => normalize_presets(list),
        _ => default_presets(),
    })
}

/// 覆盖倒计时预设（去重 + 升序 + 仅正数 + 上限；全部非法 → 回落默认）。
pub async fn set_presets(pool: &SqlitePool, presets: Vec<i64>) -> AppResult<Vec<i64>> {
    let normalized = normalize_presets(presets);
    let stored = if normalized.is_empty() {
        default_presets()
    } else {
        normalized
    };
    repo::set_value(pool, KEY_COUNTDOWN_PRESETS, &encode(&stored)?, now_ms()).await?;
    Ok(stored)
}

/* --------------------------------- 内部 --------------------------------- */

/// 读取并 JSON 解码单个键；缺失或解码失败返回 `None`。
async fn read<T: DeserializeOwned>(pool: &SqlitePool, key: &str) -> AppResult<Option<T>> {
    let raw = repo::get_value(pool, key).await?;
    Ok(raw.and_then(|value| serde_json::from_str::<T>(&value).ok()))
}

/// JSON 编码。
fn encode<T: serde::Serialize>(value: &T) -> AppResult<String> {
    serde_json::to_string(value).map_err(AppError::db)
}

/// 校验可选色值：`Some` 时须为合法 hex。
fn validate_opt(value: &Option<String>) -> AppResult<Option<String>> {
    value.as_deref().map(validate_hex).transpose()
}

/// 校验单个色值：须为 `#RRGGBB`。
fn validate_hex(value: &str) -> AppResult<String> {
    if is_valid_hex(value) {
        Ok(value.to_string())
    } else {
        Err(AppError::invalid_color())
    }
}
