//! 设置业务：settings 表读写 + 默认值；autostart 实际状态由命令层经注册表回填。

use std::collections::HashMap;

use sqlx::SqlitePool;

use crate::error::AppResult;
use crate::infra::clock::now_ms;
use crate::models::constants::*;
use crate::models::settings::{
    ReferenceSettings, ReferenceSettingsPatch, Settings, SettingsPatch, ShortcutMap,
};
use crate::repositories::settings as repo;
use crate::services::theme;

/// 首次读取时写入默认值（schema.sql 尾部登记的键）。
pub async fn ensure_defaults(pool: &SqlitePool) -> AppResult<()> {
    let now = now_ms();
    if repo::get_value(pool, KEY_ALWAYS_ON_TOP).await?.is_none() {
        repo::set_value(pool, KEY_ALWAYS_ON_TOP, bool_str(true), now).await?;
    }
    if repo::get_value(pool, KEY_OPACITY_ENABLED).await?.is_none() {
        repo::set_value(pool, KEY_OPACITY_ENABLED, bool_str(true), now).await?;
    }
    if repo::get_value(pool, KEY_LAST_ITEM_ID).await?.is_none() {
        repo::set_value(pool, KEY_LAST_ITEM_ID, &SYSTEM_ITEM_ID.to_string(), now).await?;
    }
    Ok(())
}

pub async fn get_reference(pool: &SqlitePool) -> AppResult<ReferenceSettings> {
    let map = repo::get_all(pool).await?;
    let mut value = ReferenceSettings::default();
    macro_rules! read {
        ($field:ident, $key:expr, $ty:ty) => {
            if let Some(raw) = map.get($key) {
                if let Ok(parsed) = raw.parse::<$ty>() {
                    value.$field = parsed;
                }
            }
        };
    }
    read!(ui_scale, "timing.ui_scale", f64);
    read!(plate_opacity, "timing.plate_opacity", f64);
    read!(
        default_countdown_minutes,
        "timing.default_countdown_minutes",
        i64
    );
    read!(max_minutes, "timing.max_minutes", i64);
    read!(merge_gap_minutes, "timing.merge_gap_minutes", i64);
    read!(min_record_seconds, "timing.min_record_seconds", i64);
    read!(remind_advance_minutes, "timing.remind_advance_minutes", i64);
    for (key, target) in [
        ("timing.auto_write_on_stop", &mut value.auto_write_on_stop),
        (
            "timing.auto_bind_first_todo",
            &mut value.auto_bind_first_todo,
        ),
        ("timing.pending_enabled", &mut value.pending_enabled),
        (
            "timing.light_remind_default_on",
            &mut value.light_remind_default_on,
        ),
        ("timing.quick_find_enabled", &mut value.quick_find_enabled),
        (
            "timing.timer_window_enabled",
            &mut value.timer_window_enabled,
        ),
        (
            "timing.extension_auto_start",
            &mut value.extension_auto_start,
        ),
        (
            "timing.desktop_menu_enabled",
            &mut value.desktop_menu_enabled,
        ),
    ] {
        if let Some(raw) = map.get(key) {
            *target = raw == "true";
        }
    }
    if let Some(v) = map.get("timing.default_pause_reason") {
        value.default_pause_reason = v.clone();
    }
    if let Some(v) = map.get("timing.highlight_color") {
        value.highlight_color = v.clone();
    }
    Ok(value)
}

pub async fn update_reference(
    pool: &SqlitePool,
    patch: &ReferenceSettingsPatch,
) -> AppResult<ReferenceSettings> {
    let now = now_ms();
    macro_rules! write_num {
        ($field:ident, $key:expr) => {
            if let Some(v) = patch.$field {
                repo::set_value(pool, $key, &v.to_string(), now).await?;
            }
        };
    }
    write_num!(ui_scale, "timing.ui_scale");
    write_num!(plate_opacity, "timing.plate_opacity");
    write_num!(
        default_countdown_minutes,
        "timing.default_countdown_minutes"
    );
    write_num!(max_minutes, "timing.max_minutes");
    write_num!(merge_gap_minutes, "timing.merge_gap_minutes");
    write_num!(min_record_seconds, "timing.min_record_seconds");
    write_num!(remind_advance_minutes, "timing.remind_advance_minutes");
    macro_rules! write_bool {
        ($field:ident, $key:expr) => {
            if let Some(v) = patch.$field {
                repo::set_value(pool, $key, bool_str(v), now).await?;
            }
        };
    }
    write_bool!(auto_write_on_stop, "timing.auto_write_on_stop");
    write_bool!(auto_bind_first_todo, "timing.auto_bind_first_todo");
    write_bool!(pending_enabled, "timing.pending_enabled");
    write_bool!(light_remind_default_on, "timing.light_remind_default_on");
    write_bool!(quick_find_enabled, "timing.quick_find_enabled");
    write_bool!(timer_window_enabled, "timing.timer_window_enabled");
    write_bool!(extension_auto_start, "timing.extension_auto_start");
    write_bool!(desktop_menu_enabled, "timing.desktop_menu_enabled");
    if let Some(v) = patch.default_pause_reason.as_deref() {
        repo::set_value(pool, "timing.default_pause_reason", v, now).await?;
    }
    if let Some(v) = patch.highlight_color.as_deref() {
        repo::set_value(pool, "timing.highlight_color", v, now).await?;
    }
    get_reference(pool).await
}

/// 读取全部设置（不含注册表回填）。
pub async fn get(pool: &SqlitePool) -> AppResult<Settings> {
    let map = repo::get_all(pool).await?;
    Ok(Settings {
        autostart_enabled: flag(&map, KEY_AUTOSTART_ENABLED, false),
        always_on_top: flag(&map, KEY_ALWAYS_ON_TOP, true),
        opacity_enabled: flag(&map, KEY_OPACITY_ENABLED, true),
        last_display_id: opt(&map, KEY_LAST_DISPLAY_ID),
        shortcuts: ShortcutMap {
            toggle_window: opt(&map, KEY_SHORTCUT_TOGGLE_WINDOW),
            start_pause: opt(&map, KEY_SHORTCUT_START_PAUSE),
            stop: opt(&map, KEY_SHORTCUT_STOP),
            new_item: opt(&map, KEY_SHORTCUT_NEW_ITEM),
        },
        // [V0.2.0] 主题 / 四色 / 倒计时预设（DTO-03：与 domain.ts 字段一一对应）
        theme_mode: theme::mode(pool).await?,
        accents: theme::accents(pool).await?,
        countdown_presets: theme::presets(pool).await?,
        countdown_auto_end: countdown_auto_end(pool).await?,
    })
}

/// 部分更新，返回合并后全量。
pub async fn update(pool: &SqlitePool, patch: &SettingsPatch) -> AppResult<Settings> {
    let now = now_ms();
    if let Some(v) = patch.autostart_enabled {
        repo::set_value(pool, KEY_AUTOSTART_ENABLED, bool_str(v), now).await?;
    }
    if let Some(v) = patch.always_on_top {
        repo::set_value(pool, KEY_ALWAYS_ON_TOP, bool_str(v), now).await?;
    }
    if let Some(v) = patch.opacity_enabled {
        repo::set_value(pool, KEY_OPACITY_ENABLED, bool_str(v), now).await?;
    }
    if let Some(v) = patch.last_display_id.as_deref() {
        repo::set_value(pool, KEY_LAST_DISPLAY_ID, v, now).await?;
    }
    if let Some(map) = patch.shortcuts.as_ref() {
        write_opt(
            pool,
            KEY_SHORTCUT_TOGGLE_WINDOW,
            map.toggle_window.as_deref(),
            now,
        )
        .await?;
        write_opt(
            pool,
            KEY_SHORTCUT_START_PAUSE,
            map.start_pause.as_deref(),
            now,
        )
        .await?;
        write_opt(pool, KEY_SHORTCUT_STOP, map.stop.as_deref(), now).await?;
        write_opt(pool, KEY_SHORTCUT_NEW_ITEM, map.new_item.as_deref(), now).await?;
    }
    // [V0.2.0] 主题相关字段复用 theme 服务（含 hex 校验与预设归一）
    if let Some(mode) = patch.theme_mode {
        theme::set_mode(pool, mode).await?;
    }
    if let Some(accents) = patch.accents.as_ref() {
        theme::set_accents(pool, accents).await?;
    }
    if let Some(presets) = patch.countdown_presets.as_ref() {
        theme::set_presets(pool, presets.clone()).await?;
    }
    if let Some(enabled) = patch.countdown_auto_end {
        repo::set_value(pool, KEY_COUNTDOWN_AUTO_END, bool_str(enabled), now).await?;
    }
    get(pool).await
}

/// 持久化最近使用事项 id。
pub async fn set_last_item_id(pool: &SqlitePool, id: i64) -> AppResult<()> {
    repo::set_value(pool, KEY_LAST_ITEM_ID, &id.to_string(), now_ms()).await
}

/// 读取最近使用事项 id（默认 1 = 未归类）。
pub async fn get_last_item_id(pool: &SqlitePool) -> AppResult<i64> {
    Ok(repo::get_value(pool, KEY_LAST_ITEM_ID)
        .await?
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(SYSTEM_ITEM_ID))
}

/// 持久化置顶开关。
pub async fn set_always_on_top(pool: &SqlitePool, enabled: bool) -> AppResult<()> {
    repo::set_value(pool, KEY_ALWAYS_ON_TOP, bool_str(enabled), now_ms()).await
}

/// 持久化自启标记（以实际生效状态为准）。
pub async fn set_autostart_flag(pool: &SqlitePool, enabled: bool) -> AppResult<()> {
    repo::set_value(pool, KEY_AUTOSTART_ENABLED, bool_str(enabled), now_ms()).await
}

/// 读取倒计时「自动结束并保存」开关（缺省 / 损坏 → false，AC-62 默认关闭）。
pub async fn countdown_auto_end(pool: &SqlitePool) -> AppResult<bool> {
    Ok(repo::get_value(pool, KEY_COUNTDOWN_AUTO_END)
        .await?
        .map(|v| v == "true")
        .unwrap_or(false))
}

/// 持久化窗口位置（逻辑像素，K-6）。
pub async fn set_window_position(pool: &SqlitePool, x: f64, y: f64) -> AppResult<()> {
    let now = now_ms();
    repo::set_value(pool, KEY_WINDOW_X, &x.to_string(), now).await?;
    repo::set_value(pool, KEY_WINDOW_Y, &y.to_string(), now).await?;
    Ok(())
}

fn bool_str(v: bool) -> &'static str {
    if v {
        "true"
    } else {
        "false"
    }
}

fn opt(map: &HashMap<String, String>, key: &str) -> Option<String> {
    map.get(key).cloned().filter(|v| !v.is_empty())
}

fn flag(map: &HashMap<String, String>, key: &str, default: bool) -> bool {
    opt(map, key).map(|v| v == "true").unwrap_or(default)
}

async fn write_opt(pool: &SqlitePool, key: &str, value: Option<&str>, now: i64) -> AppResult<()> {
    repo::set_value(pool, key, value.unwrap_or(""), now).await
}
