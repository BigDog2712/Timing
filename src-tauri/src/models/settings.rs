//! 设置域 DTO。字段与 `domain.ts::Settings` 一一对应（含 V0.2.0 新增 3 字段，DTO-03）。

use serde::{Deserialize, Serialize};

use std::collections::HashMap;

use crate::models::constants::RECENT_ITEMS_DEFAULT;
use crate::models::moyu::{default_presets as default_moyu_presets, MoyuPreset};
use crate::models::theme::{default_presets, AccentColors, AccentPatch, ThemeMode};

/// Timing v1.7.3 参考设置（独立于现有 Settings，便于渐进接线）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceSettings {
    pub ui_scale: f64,
    pub plate_opacity: f64,
    pub default_countdown_minutes: i64,
    pub max_minutes: i64,
    pub auto_write_on_stop: bool,
    pub auto_bind_first_todo: bool,
    pub default_pause_reason: String,
    pub merge_gap_minutes: i64,
    pub min_record_seconds: i64,
    pub pending_enabled: bool,
    pub remind_advance_minutes: i64,
    pub light_remind_default_on: bool,
    pub quick_find_enabled: bool,
    pub timer_window_enabled: bool,
    pub extension_auto_start: bool,
    pub highlight_color: String,
    pub desktop_menu_enabled: bool,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceSettingsPatch {
    pub ui_scale: Option<f64>,
    pub plate_opacity: Option<f64>,
    pub default_countdown_minutes: Option<i64>,
    pub max_minutes: Option<i64>,
    pub auto_write_on_stop: Option<bool>,
    pub auto_bind_first_todo: Option<bool>,
    pub default_pause_reason: Option<String>,
    pub merge_gap_minutes: Option<i64>,
    pub min_record_seconds: Option<i64>,
    pub pending_enabled: Option<bool>,
    pub remind_advance_minutes: Option<i64>,
    pub light_remind_default_on: Option<bool>,
    pub quick_find_enabled: Option<bool>,
    pub timer_window_enabled: Option<bool>,
    pub extension_auto_start: Option<bool>,
    pub highlight_color: Option<String>,
    pub desktop_menu_enabled: Option<bool>,
}

/// 应用设置。
///
/// V0.3.3：`alwaysOnTop` / `opacityEnabled` / `shortcuts` 三个字段随功能下架
/// （窗口恒定置顶、感知壁纸开关删除、全局快捷键整体下架，见 ADR-022）。
/// V0.3.4：`countdownAutoEnd` 随开关下架——倒计时到点恒结束并保存（见 ADR-023）。
/// 数据库里的历史 key 行保留只读不删——没人再读它即无害。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub autostart_enabled: bool,
    pub last_display_id: Option<String>,
    /// [V0.2.0] 主题模式（dark | light | system）
    pub theme_mode: ThemeMode,
    /// [V0.2.0] 四色可配（计时中 / 提醒 / 完成 / 小条底色）
    pub accents: AccentColors,
    /// [V0.2.0] 倒计时预设时长（秒，升序去重）
    pub countdown_presets: Vec<i64>,
    /// [V0.3.9] 常用摸鱼（应用内置，顺序即展示顺序）
    pub moyu_presets: Vec<MoyuPreset>,
    /// [V0.3.9] 常用事项框是否展示「最近编辑」分组
    pub items_show_recent: bool,
    /// [V0.3.9] 最近编辑条数（1..=10）
    pub items_recent_count: i64,
    /// [V0.3.9] 常用事项的默认倒计时时长（itemId → 分钟）。
    /// 有值 = 点它起倒计时；无值 = 正计时。
    pub items_timers: HashMap<i64, i64>,
}

impl Default for ReferenceSettings {
    fn default() -> Self {
        Self {
            ui_scale: 1.0,
            plate_opacity: 0.9,
            default_countdown_minutes: 25,
            max_minutes: 120,
            auto_write_on_stop: true,
            auto_bind_first_todo: false,
            default_pause_reason: String::new(),
            merge_gap_minutes: 5,
            // [V0.3.4] 最短记录时长默认 30 秒（原 5 秒）：低于此值的手动结束不产生记录，
            // 出厂值直接落在「一次有意义的计时」的量级上，用户很少需要下调（ADR-023）。
            min_record_seconds: 30,
            pending_enabled: true,
            remind_advance_minutes: 10,
            light_remind_default_on: true,
            quick_find_enabled: true,
            timer_window_enabled: false,
            extension_auto_start: false,
            highlight_color: "#4DA3E8".to_string(),
            desktop_menu_enabled: true,
        }
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            autostart_enabled: false,
            last_display_id: None,
            theme_mode: ThemeMode::default(),
            accents: AccentColors::default(),
            countdown_presets: default_presets(),
            moyu_presets: default_moyu_presets(),
            items_show_recent: true,
            items_recent_count: RECENT_ITEMS_DEFAULT,
            items_timers: HashMap::new(),
        }
    }
}

/// `update_settings` 的部分更新字段（`Partial<Settings>`）。
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    #[serde(default)]
    pub autostart_enabled: Option<bool>,
    #[serde(default)]
    pub last_display_id: Option<String>,
    #[serde(default)]
    pub theme_mode: Option<ThemeMode>,
    #[serde(default)]
    pub accents: Option<AccentPatch>,
    #[serde(default)]
    pub countdown_presets: Option<Vec<i64>>,
    #[serde(default)]
    pub moyu_presets: Option<Vec<MoyuPreset>>,
    #[serde(default)]
    pub items_show_recent: Option<bool>,
    #[serde(default)]
    pub items_recent_count: Option<i64>,
    #[serde(default)]
    pub items_timers: Option<HashMap<i64, i64>>,
}

impl SettingsPatch {
    /// 本 patch 是否触及主题 / 四色（据此决定是否广播 `theme-changed`）。
    pub fn touches_theme(&self) -> bool {
        self.theme_mode.is_some() || self.accents.is_some()
    }
}
