//! 悬浮条外观 + 手柄绑定的**唯一真源形状**（[0.12.1 归一] 单一真源改造）。
//!
//! 为什么搬进 Rust 设置表：0.12.1 的真源是「两窗各自的 localStorage」，而悬浮条窗（`main`）
//! 与分析窗（`patina`，设置页住这里）不在同一个 WebView2 数据目录（`main_window.rs` 给后者
//! 设了 `.data_directory(webview_root)`）。localStorage 按数据目录分区，两窗各读各的一份，
//! 当时只能靠 `timing:pill-prefs` 广播搬运 —— 而任何新增的「设置页写 localStorage」项都要
//! 再接一次搬运，漏一次就静默失效。现在这几个字段收进 settings KV 的一个键（整份 JSON
//! 快照），Rust 是唯一真源，localStorage 退化成首帧缓存。
//!
//! **为什么不在这里校验动作 id**（`timer.start` 这类）：id 的权威目录在前端
//! `src/lib/handleCatalog.ts`（会被写进用户配置，id 永不改名）。后端只保证**结构**合法
//! （字符串、去空白、≤64 字符），非法 id 由前端 `parseHandleBindings` 归一成「无」。
//! 这不是漏写：复制一份目录两边迟早漂移，而漂移那天没有任何东西会报错。
//!
//! 不写 `unwrap` / `expect`：release 是 `panic = "abort"`。

use serde::{Deserialize, Serialize};

/// 文字不透明度下限。**必须等于**前端 `src/lib/pillAppearance.ts` 的同名常量（改一处两处同改）。
pub const TEXT_OPACITY_MIN: f64 = 0.2;

/// 槽位里动作 id 的最大长度（字符）。目录里最长的是 `menu.countdown`（14），64 只可能是坏数据。
const ACTION_ID_MAX_LEN: usize = 64;

/// 药丸外观三项。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PillAppearance {
    /// 文字不透明度 `[0.2, 1]`
    pub text_opacity: f64,
    /// 背景板不透明度 `[0, 1]`
    pub bg_opacity: f64,
    /// 常驻形态：`bar`（悬浮条）| `dot`（小圆点）
    pub float_form: String,
}

/// 一个手柄形态的 5 个槽位；`None` = 渲染成「无」。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandleSlotBinding {
    pub left: Option<String>,
    pub right: Option<String>,
    pub middle: Option<String>,
    pub left_double: Option<String>,
    pub right_double: Option<String>,
}

/// 单个手柄形态：是否启用 + 五个槽位。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandleFormBinding {
    pub enabled: bool,
    pub slots: HandleSlotBinding,
}

/// 三个手柄形态（圆点 / 半手柄 / 手柄）。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandleBindings {
    pub dot: HandleFormBinding,
    pub half: HandleFormBinding,
    pub full: HandleFormBinding,
}

/// 完整快照 = 存在 KV 里的形状。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PillPrefs {
    pub appearance: PillAppearance,
    pub handles: HandleBindings,
}

/// 部分更新（`patch.pill`）：两个字段都可选，缺的那个保持库里不动。
///
/// 半份 patch 是**必然**发生的（外观卡只发 `appearance`，手柄面板只发 `handles`），
/// 所以写库口径是「读旧 → 覆盖 → 归一 → 写全量」，见 `merge_pill_prefs`。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PillPrefsPatch {
    pub appearance: Option<PillAppearance>,
    pub handles: Option<HandleBindings>,
}

impl Default for PillAppearance {
    fn default() -> Self {
        Self {
            text_opacity: 1.0,
            bg_opacity: 1.0,
            float_form: "bar".to_string(),
        }
    }
}

/// `NaN` / 无穷（手改坏的 JSON）按 `fallback` 处理 —— 与前端 `clamp` 的 `NaN → 上界` 同口径。
fn sane(value: f64, fallback: f64) -> f64 {
    if value.is_finite() {
        value
    } else {
        fallback
    }
}

/// 只认 `bar` / `dot`；别的（旧版没这键、手改坏、未来形态降级）一律回落悬浮条。
pub fn normalize_float_form(value: &str) -> String {
    if value == "dot" {
        "dot".to_string()
    } else {
        "bar".to_string()
    }
}

/// 槽位归一：去两端空白、空串 → `None`、超长 → `None`。
fn clean_action_id(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() || trimmed.chars().count() > ACTION_ID_MAX_LEN {
        None
    } else {
        Some(trimmed)
    }
}

impl PillAppearance {
    /// 数值夹取 + 形态回落。
    pub fn normalize(&mut self) {
        self.text_opacity = sane(self.text_opacity, 1.0).clamp(TEXT_OPACITY_MIN, 1.0);
        self.bg_opacity = sane(self.bg_opacity, 1.0).clamp(0.0, 1.0);
        self.float_form = normalize_float_form(&self.float_form);
    }
}

impl HandleSlotBinding {
    /// 五个槽位逐个归一（`pub`：单测要单验这一层，不必造整份快照）。
    pub fn normalize(&mut self) {
        for slot in [
            &mut self.left,
            &mut self.right,
            &mut self.middle,
            &mut self.left_double,
            &mut self.right_double,
        ] {
            *slot = clean_action_id(slot.take());
        }
    }
}

impl PillPrefs {
    pub fn normalize(&mut self) {
        self.appearance.normalize();
        for form in [
            &mut self.handles.dot,
            &mut self.handles.half,
            &mut self.handles.full,
        ] {
            form.slots.normalize();
        }
    }
}

/// 把半份 patch 合进既有快照（**纯函数**，不碰数据库，单测直接打它）。
///
/// 形状是「读旧 → 覆盖 → 归一」：patch 只带半份时另半份必须原样保留，否则调一次不透明度
/// 就会把手柄绑定抹回默认。归一放在合并之后 —— 旧值里的坏数据顺手被修掉。
pub fn merge_pill_prefs(old: Option<PillPrefs>, patch: &PillPrefsPatch) -> PillPrefs {
    let mut next = old.unwrap_or_default();
    if let Some(appearance) = patch.appearance.clone() {
        next.appearance = appearance;
    }
    if let Some(handles) = patch.handles.clone() {
        next.handles = handles;
    }
    next.normalize();
    next
}
