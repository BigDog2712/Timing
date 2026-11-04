//! 插件面板（apiVersion 3）：声明式 UI 落点 + 受限动作。
//!
//! ## 为什么是「声明」而不是「代码」
//!
//! 插件依旧不执行任何代码（ADR-033 的边界不动）。面板由宿主渲染，块类型是**固定枚举**，
//! 数据源与动作也各有白名单——插件能决定的只有「放什么块、调哪个已有能力、参数填什么」。
//!
//! 这条线划得很死，原因是它决定了**插件失败时会发生什么**：一个写错的 `panel.json`
//! 会被 `validate_panels` 挡在加载阶段并给出具体原因，而不是在渲染到一半时崩掉整个窗口。
//!
//! ## 参数为什么是具名字段而不是任意 JSON
//!
//! 让插件往 `params` 里塞任意 JSON，校验就退化成「宿主得理解每种动作的参数形状」——
//! 等于把类型检查从编译期搬到了运行期，且没有编译期兜底。`QueryParams` / `ActionParams`
//! 把可用参数写成具名字段：多写一个字段不报错（向前兼容），但**用到的每个字段都必须是
//! 声明过的类型**，宿主只按声明去读。

use serde::{Deserialize, Serialize};

/// 单个插件最多几个面板。三个够表达「概览 / 详情 / 设置」这种结构，再多菜单放不下。
pub const MAX_PANELS: usize = 3;
/// 单个面板最多几块。超过这个数已经不是面板，是应用。
pub const MAX_BLOCKS: usize = 12;
/// 一组按钮最多几个。
pub const MAX_ACTIONS: usize = 6;
/// 单个文本块的最大字符数。
pub const MAX_TEXT_CHARS: usize = 2000;
/// 面板标题最大字符数。
pub const MAX_TITLE_CHARS: usize = 40;
/// 面板尺寸区间（逻辑像素）。
pub const MIN_PANEL_W: f64 = 280.0;
pub const MAX_PANEL_W: f64 = 720.0;
pub const MIN_PANEL_H: f64 = 240.0;
pub const MAX_PANEL_H: f64 = 900.0;

/// 宿主支持的数据源。**白名单即契约**：写别的名字 = 校验失败，不是静默空列表。
pub const SOURCES: [&str; 2] = ["records.byItem", "todos.pending"];

/// 宿主支持的动作。同上，写别的名字 = 校验失败。
pub const ACTIONS: [&str; 4] = ["timer.start", "timer.pause", "todo.add", "note.create"];

/// 一个面板。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Panel {
    /// 面板 id（同一插件内唯一）。窗口 label 用它：`panel-{pluginId}-{panelId}`。
    pub id: String,
    pub title: String,
    /// 宽高留空则用 [320, 460]。
    #[serde(default)]
    pub width: Option<f64>,
    #[serde(default)]
    pub height: Option<f64>,
    #[serde(default)]
    pub blocks: Vec<PanelBlock>,
}

impl Panel {
    pub fn width_or_default(&self) -> f64 {
        self.width.unwrap_or(320.0).clamp(MIN_PANEL_W, MAX_PANEL_W)
    }

    pub fn height_or_default(&self) -> f64 {
        self.height.unwrap_or(460.0).clamp(MIN_PANEL_H, MAX_PANEL_H)
    }
}

/// 面板里的一块内容。`type` 判别四种形态。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PanelBlock {
    /// 静态段落。插件想写说明、免责声明、使用提示都放这里。
    Text { text: String },
    /// 带条形的统计列表（时长排行之类）。数据来自 `source`。
    Stats {
        source: String,
        #[serde(default)]
        label: String,
        #[serde(default)]
        params: QueryParams,
    },
    /// 纯文本列表。数据来自 `source`。
    List {
        source: String,
        #[serde(default)]
        label: String,
        #[serde(default)]
        params: QueryParams,
    },
    /// 一组按钮，每个按钮触发一个宿主动作。
    Actions {
        #[serde(default)]
        items: Vec<PanelAction>,
    },
}

/// 数据块可用的查询参数。字段全是可选——不填就用宿主的默认范围。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QueryParams {
    /// `records.byItem`：统计最近多少天（1..=365，默认 7）。
    pub days: Option<u32>,
    /// `todos.pending`：最多返回几条（1..=50，默认 8）。
    pub limit: Option<u32>,
}

/// 按钮：显示 `label`，点击执行 `action`。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelAction {
    pub label: String,
    pub action: String,
    #[serde(default)]
    pub params: ActionParams,
}

/// 动作可用参数。每个动作只读它自己声明的那几个，其余忽略。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ActionParams {
    /// `timer.start`：事项名（不存在则新建）。
    pub item: Option<String>,
    /// `todo.add`：待办标题。
    pub title: Option<String>,
    /// `note.create`：便利贴正文。
    pub content: Option<String>,
}

/// 校验一组面板。返回第一条错误的可读原因（与清单校验同一套「宁缺毋滥」策略）。
pub fn validate_panels(panels: &[Panel]) -> Result<(), String> {
    if panels.len() > MAX_PANELS {
        return Err(format!("panels 最多 {MAX_PANELS} 个"));
    }
    let mut seen: Vec<&str> = Vec::new();
    for panel in panels {
        validate_id(&panel.id, "panel.id")?;
        if seen.contains(&panel.id.as_str()) {
            return Err(format!("panel.id「{}」重复", panel.id));
        }
        seen.push(&panel.id);
        if panel.title.trim().is_empty() {
            return Err(format!("panel「{}」的 title 不能为空", panel.id));
        }
        if panel.title.chars().count() > MAX_TITLE_CHARS {
            return Err(format!("panel.title 最多 {MAX_TITLE_CHARS} 字"));
        }
        if let Some(w) = panel.width {
            if !(MIN_PANEL_W..=MAX_PANEL_W).contains(&w) {
                return Err(format!("panel.width 必须在 {MIN_PANEL_W}..={MAX_PANEL_W}"));
            }
        }
        if let Some(h) = panel.height {
            if !(MIN_PANEL_H..=MAX_PANEL_H).contains(&h) {
                return Err(format!("panel.height 必须在 {MIN_PANEL_H}..={MAX_PANEL_H}"));
            }
        }
        if panel.blocks.is_empty() {
            return Err(format!("panel「{}」至少要有一块内容", panel.id));
        }
        if panel.blocks.len() > MAX_BLOCKS {
            return Err(format!("panel.blocks 最多 {MAX_BLOCKS} 块"));
        }
        for block in &panel.blocks {
            validate_block(panel.id.as_str(), block)?;
        }
    }
    Ok(())
}

fn validate_block(panel_id: &str, block: &PanelBlock) -> Result<(), String> {
    match block {
        PanelBlock::Text { text } => {
            if text.trim().is_empty() {
                return Err(format!("panel「{panel_id}」有空的文本块"));
            }
            if text.chars().count() > MAX_TEXT_CHARS {
                return Err(format!("文本块最多 {MAX_TEXT_CHARS} 字"));
            }
        }
        PanelBlock::Stats { source, params, .. } | PanelBlock::List { source, params, .. } => {
            if !SOURCES.contains(&source.as_str()) {
                return Err(format!(
                    "未知数据源「{source}」；可用：{}",
                    SOURCES.join(" / ")
                ));
            }
            if let Some(days) = params.days {
                if days == 0 || days > 365 {
                    return Err("params.days 必须在 1..=365".into());
                }
            }
            if let Some(limit) = params.limit {
                if limit == 0 || limit > 50 {
                    return Err("params.limit 必须在 1..=50".into());
                }
            }
        }
        PanelBlock::Actions { items } => {
            if items.is_empty() {
                return Err(format!("panel「{panel_id}」的按钮组是空的"));
            }
            if items.len() > MAX_ACTIONS {
                return Err(format!("按钮组最多 {MAX_ACTIONS} 个"));
            }
            for item in items {
                if item.label.trim().is_empty() {
                    return Err("按钮 label 不能为空".into());
                }
                if !ACTIONS.contains(&item.action.as_str()) {
                    return Err(format!(
                        "未知动作「{}」；可用：{}",
                        item.action,
                        ACTIONS.join(" / ")
                    ));
                }
                validate_action_params(&item.action, &item.params)?;
            }
        }
    }
    Ok(())
}

/// 动作参数按动作分别要求：缺参数应该在这里就报，而不是点下去才发现没反应。
fn validate_action_params(action: &str, params: &ActionParams) -> Result<(), String> {
    let non_empty = |value: &Option<String>| value.as_deref().is_some_and(|v| !v.trim().is_empty());
    match action {
        "timer.start" => {
            if !non_empty(&params.item) {
                return Err("timer.start 需要 params.item".into());
            }
        }
        "todo.add" => {
            if !non_empty(&params.title) {
                return Err("todo.add 需要 params.title".into());
            }
        }
        "note.create" if !non_empty(&params.content) => {
            return Err("note.create 需要 params.content".into());
        }
        _ => {}
    }
    Ok(())
}

/// id 规则与插件 id 一致：小写字母、数字、`-`、`_`，且非空。
fn validate_id(value: &str, field: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("{field} 不能为空"));
    }
    if value.len() > 32 {
        return Err(format!("{field} 最多 32 字符"));
    }
    if !value
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
    {
        return Err(format!("{field} 只能用小写字母、数字、- 和 _"));
    }
    Ok(())
}

#[cfg(test)]
#[path = "plugin_panel_test.rs"]
mod tests;
