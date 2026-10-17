//! 设置域 DTO。字段与 `domain.ts::Settings` 一一对应（含 V0.2.0 新增 3 字段，DTO-03）。

use serde::{Deserialize, Serialize};

use crate::models::theme::{default_presets, AccentColors, AccentPatch, ThemeMode};

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
