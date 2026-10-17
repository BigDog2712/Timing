//! 设置域 DTO。字段与 `domain.ts::Settings` 一一对应（含 V0.2.0 新增 3 字段，DTO-03）。

use serde::{Deserialize, Serialize};

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

/// 全局快捷键映射（字符串值为 accelerator；null = 未注册，[P1]）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutMap {
    pub toggle_window: Option<String>,
    pub start_pause: Option<String>,
    pub stop: Option<String>,
    pub new_item: Option<String>,
}

/// 应用设置。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub autostart_enabled: bool,
    pub always_on_top: bool,
    pub opacity_enabled: bool,
    pub last_display_id: Option<String>,
    pub shortcuts: ShortcutMap,
    /// [V0.2.0] 主题模式（dark | light | system）
    pub theme_mode: ThemeMode,
    /// [V0.2.0] 四色可配（计时中 / 提醒 / 完成 / 小条底色）
    pub accents: AccentColors,
    /// [V0.2.0] 倒计时预设时长（秒，升序去重）
    pub countdown_presets: Vec<i64>,
    /// [V0.2.0 批 2] 倒计时到点「自动结束并保存」开关（默认 false = 仅通知 + 视觉提示，AC-62）。
    pub countdown_auto_end: bool,
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
            min_record_seconds: 5,
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
            always_on_top: true,
            opacity_enabled: true,
            last_display_id: None,
            shortcuts: ShortcutMap::default(),
            theme_mode: ThemeMode::default(),
            accents: AccentColors::default(),
            countdown_presets: default_presets(),
            countdown_auto_end: false,
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
    pub always_on_top: Option<bool>,
    #[serde(default)]
    pub opacity_enabled: Option<bool>,
    #[serde(default)]
    pub last_display_id: Option<String>,
    #[serde(default)]
    pub shortcuts: Option<ShortcutMap>,
    #[serde(default)]
    pub theme_mode: Option<ThemeMode>,
    #[serde(default)]
    pub accents: Option<AccentPatch>,
    #[serde(default)]
    pub countdown_presets: Option<Vec<i64>>,
    #[serde(default)]
    pub countdown_auto_end: Option<bool>,
}

impl SettingsPatch {
    /// 本 patch 是否触及主题 / 四色（据此决定是否广播 `theme-changed`）。
    pub fn touches_theme(&self) -> bool {
        self.theme_mode.is_some() || self.accents.is_some()
    }
}
