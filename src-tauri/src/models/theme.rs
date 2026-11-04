//! 主题 / 四色 / 倒计时预设 DTO（Spec §5.4、ADR-012）。
//!
//! 默认值全部取自 `models::constants`（**唯一**允许出现色值字面量的位置，DTO-05），
//! 本文件与服务层一律引用常量，不写裸 hex。

use serde::{Deserialize, Deserializer, Serialize};

use crate::models::constants::{
    COUNTDOWN_PRESETS_MAX, DEFAULT_ACCENT_DONE, DEFAULT_ACCENT_RUNNING, DEFAULT_ACCENT_WARN,
    DEFAULT_COUNTDOWN_PRESETS, DEFAULT_THEME_MODE,
};

/// 主题模式（`domain.ts::ThemeMode`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemeMode {
    Dark,
    Light,
    System,
}

impl ThemeMode {
    /// 字符串值（与 `domain.ts` 联合类型一致）。
    /// 序列化走 serde；此方法供需要字符串字面量的调用方使用（Wave B 起）。
    #[allow(dead_code)]
    pub const fn as_str(self) -> &'static str {
        match self {
            ThemeMode::Dark => "dark",
            ThemeMode::Light => "light",
            ThemeMode::System => "system",
        }
    }

    /// 解析字符串值；非法返回 `None`。
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "dark" => Some(ThemeMode::Dark),
            "light" => Some(ThemeMode::Light),
            "system" => Some(ThemeMode::System),
            _ => None,
        }
    }
}

impl Default for ThemeMode {
    /// 默认模式取自 `constants::DEFAULT_THEME_MODE`（单一事实来源）。
    fn default() -> Self {
        ThemeMode::parse(DEFAULT_THEME_MODE).unwrap_or(ThemeMode::Dark)
    }
}

/// `theme_get` / `theme_set` 返回（= `domain.ts::ThemeSettings`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ThemeSettings {
    pub mode: ThemeMode,
}

/// 四色可配（用户数据，非设计令牌）。`bar = None` 表示「跟随主题令牌」。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccentColors {
    pub running: String,
    pub warn: String,
    pub done: String,
    pub bar: Option<String>,
}

impl Default for AccentColors {
    fn default() -> Self {
        Self {
            running: DEFAULT_ACCENT_RUNNING.to_string(),
            warn: DEFAULT_ACCENT_WARN.to_string(),
            done: DEFAULT_ACCENT_DONE.to_string(),
            bar: None,
        }
    }
}

/// `accent_set` 的部分更新（`Partial<AccentColors>`）。
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub struct AccentPatch {
    #[serde(default)]
    pub running: Option<String>,
    #[serde(default)]
    pub warn: Option<String>,
    #[serde(default)]
    pub done: Option<String>,
    /// 三态语义：字段缺省 = 不修改；显式 `null` = 重置为「跟随主题」；值 = 设置该色。
    #[serde(default, deserialize_with = "double_option")]
    pub bar: Option<Option<String>>,
}

/// 区分「字段缺省」与「显式 null」——serde 默认会把 `null` 折叠成 `None`，此处保留两层。
fn double_option<'de, D>(de: D) -> Result<Option<Option<String>>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Some(Option::<String>::deserialize(de)?))
}

/// `theme-changed` 事件载荷（= `ThemeSettings & { accents }`，广播所有窗口，K-21）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ThemeChanged {
    pub mode: ThemeMode,
    pub accents: AccentColors,
}

/// 合法色值：`#RRGGBB`（hex 大小写均可）。
pub fn is_valid_hex(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 7 && bytes[0] == b'#' && bytes[1..].iter().all(|b| b.is_ascii_hexdigit())
}

/// 归一化倒计时预设：仅保留 `> 0`、去重、升序、截断到上限（Spec §5.3）。
pub fn normalize_presets(presets: impl IntoIterator<Item = i64>) -> Vec<i64> {
    let mut out: Vec<i64> = presets.into_iter().filter(|sec| *sec > 0).collect();
    out.sort_unstable();
    out.dedup();
    out.truncate(COUNTDOWN_PRESETS_MAX);
    out
}

/// 默认倒计时预设。
pub fn default_presets() -> Vec<i64> {
    DEFAULT_COUNTDOWN_PRESETS.to_vec()
}
