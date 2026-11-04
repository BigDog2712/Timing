//! 插件域模型（V0.3.2）：启动头 `plugin.json` 的磁盘形态 + 对外快照。
//!
//! 术语（见 `docs/plugin-spec.md`）：
//! - **启动头（bootstrap header）**：插件目录下唯一的入口文件 `plugin.json`。
//!   宿主只认这一个文件——读不到它，目录再花哨也不算插件。
//! - **贡献点（contribution）**：插件向宿主声明的能力。
//!   - v1：`quickTimers`（摸鱼菜单的预设项）；
//!   - v3：`panels`（声明式面板：独立窗口里的一块界面 + 按钮触发的宿主动作）。
//!     加新贡献点必须同时升 `apiVersion`。
//!
//! [v2 撤回] 曾经的 `mdSync` 贡献点已移除。Markdown 同步是**宿主内建功能**：
//! 它要读写任意路径、后台定时、写库，属于特权能力，不该由插件当配置携带者。
//! 落点由用户在「设置 → 同步」直接改，出厂默认值在 `services::md_sync::config`。
//! 老插件里多写的 `mdSync` 字段会被静默忽略——解析策略本就是「字段不认识就忽略」。
//!
//! 解析策略：**宁缺毋滥**。字段不认识就忽略（向前兼容），但 `entry` / `apiVersion`
//! 不认识就拒载并留下原因——猜语义比不加载更危险。

use serde::{Deserialize, Serialize};

use crate::models::plugin_panel::Panel;

/// 宿主支持的最高 apiVersion。插件写更高版本 → 拒载（不猜语义）。
///
/// v2 曾引入 `contributes.mdSync`，现已撤回；v3 新增 `contributes.panels`。
/// 只声明 `quickTimers` 的 v1 插件继续有效——它不写 `apiVersion: 3` 就不会被当 v3 解析，
/// 而 `panels` 又是可选字段，所以老插件不需要任何改动。
pub const PLUGIN_API_VERSION: u32 = 3;

/// 启动头文件名（固定，不可配置）。
pub const MANIFEST_FILE: &str = "plugin.json";

/// 单条快捷计时 = 摸鱼菜单的一行（贡献点 `quickTimers` 的元素）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuickTimer {
    /// 事项名。不存在时由前端按名新建。
    pub item: String,
    /// 目标时长（分钟）。1..=1440。
    pub minutes: u32,
}

/// 启动方式。v1 只执行 `Manifest`（宿主按声明解释）；
/// `Script` 是预留位——现在明确拒载，好过假装支持。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    #[default]
    Manifest,
    Script,
}

/// 贡献点集合。全部可选——空贡献的插件也合法（只登记，不产生行为）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PluginContributes {
    pub quick_timers: Vec<QuickTimer>,
    /// [v3] 声明式面板。`apiVersion: 3` 才认，低版本写了也不生效（校验层拒绝）。
    pub panels: Vec<Panel>,
}

/// 磁盘上的启动头（严格按本结构解析）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub api_version: u32,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub entry: EntryKind,
    /// 目录级开关：false = 保留在盘上但不生效（用户可手改）。
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub contributes: PluginContributes,
}

fn default_enabled() -> bool {
    true
}

/// 插件来源。同 id 冲突时按 Dev > Exe > User 先到先得。
///
/// [V0.3.2 修正] 没有 `Builtin`：摸鱼菜单的出厂预设是**应用内置功能**（见
/// `services::plugin::builtin_quick_timers`），不是插件——它没有目录、不参与
/// 启停，也不该出现在「插件」列表里冒充一个包。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PluginSource {
    /// 调试构建：仓库根的 `plugins/`。
    Dev,
    /// 随包分发：exe 同级 `plugins/`。
    Exe,
    /// 用户目录：`%APPDATA%/com.tickbar.app/plugins`（可写）。
    User,
}

impl PluginSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Dev => "dev",
            Self::Exe => "exe",
            Self::User => "user",
        }
    }
}

/// 对外快照：载入失败的插件同样返回（`error` 非空、`enabled=false`），
/// 让设置页能把「为什么没生效」直接说清楚，而不是静默消失。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub api_version: u32,
    pub description: String,
    pub source: String,
    /// 插件目录（磁盘绝对路径）。
    pub dir: String,
    pub enabled: bool,
    pub error: Option<String>,
    pub quick_timers: Vec<QuickTimer>,
    /// [v3] 本插件声明的面板（停用 / 载入失败的插件不贡献）。
    pub panels: Vec<Panel>,
}

/// `plugin_list` 的返回：插件 + 用户插件目录（设置页据此显示与「打开目录」）。
///
/// [V0.3.2] `quick_timers` 是**已合并去重**的最终菜单项——聚合规则只写在
/// `services::plugin` 一处，前端不再自己算，免得两边口径悄悄分叉。
///
/// [V0.3.4] 删掉 `builtin` 字段（ADR-023）：设置页不再展示任何内置功能，
/// 出厂预设只在 `services::plugin::list` 内部当合并底座用，不必随 IPC 出门。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginListResult {
    pub dir: String,
    pub plugins: Vec<PluginInfo>,
    pub quick_timers: Vec<QuickTimer>,
}

impl PluginInfo {
    /// 有效的快捷计时项（失败或停用的插件不贡献任何东西）。
    pub fn active_quick_timers(&self) -> &[QuickTimer] {
        if self.enabled && self.error.is_none() {
            &self.quick_timers
        } else {
            &[]
        }
    }
}
