//! 插件域模型（V0.3.2）：启动头 `plugin.json` 的磁盘形态 + 对外快照。
//!
//! 术语（见 `docs/plugin-spec.md`）：
//! - **启动头（bootstrap header）**：插件目录下唯一的入口文件 `plugin.json`。
//!   宿主只认这一个文件——读不到它，目录再花哨也不算插件。
//! - **贡献点（contribution）**：插件向宿主声明的能力。
//!   - v1：`quickTimers`（摸鱼菜单的预设项）；
//!   - v2：新增 `mdSync`（Markdown 双向同步的落点预设）。
//!     加新贡献点必须同时升 `apiVersion`。
//!
//! 解析策略：**宁缺毋滥**。字段不认识就忽略（向前兼容），但 `entry` / `apiVersion`
//! 不认识就拒载并留下原因——猜语义比不加载更危险。

use serde::{Deserialize, Serialize};

use crate::models::md_sync::MdSyncBinding;

/// 宿主支持的最高 apiVersion。插件写更高版本 → 拒载（不猜语义）。
///
/// v2 新增 `contributes.mdSync`；只声明 `quickTimers` 的 v1 插件继续有效。
pub const PLUGIN_API_VERSION: u32 = 2;

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

/// [v2] Markdown 同步贡献：只声明**默认落点**，真正的读写由宿主执行。
///
/// 插件不跑代码，所以路径、标题、文件模板必须全是数据；用户可在
/// 「设置 → 同步」里覆盖，覆盖值落在 `settings` KV，不写回插件目录。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MdSyncContribution {
    pub bindings: Vec<MdSyncBinding>,
}

/// 贡献点集合。全部可选——空贡献的插件也合法（只登记，不产生行为）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PluginContributes {
    pub quick_timers: Vec<QuickTimer>,
    /// [v2] 声明本插件提供 Markdown 同步落点。
    pub md_sync: Option<MdSyncContribution>,
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
    /// [v2] 本插件声明的同步落点（未生效 / 载入失败的插件不贡献）。
    pub md_sync: Option<MdSyncContribution>,
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
