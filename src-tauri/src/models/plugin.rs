//! 插件域模型（V0.3.2 起；V0.11.5 升到 API v3）。
//!
//! 术语（见 `docs/plugin-spec.md`）：
//! - **启动头（bootstrap header）**：插件目录下唯一的入口文件 `plugin.json`。
//!   宿主只认这一个文件——读不到它，目录再花哨也不算插件。
//! - **贡献点（contribution）**：插件向宿主声明的能力。
//!   - v1：`quickTimers`（摸鱼菜单的预设项）；
//!   - v2：`mdSync`（Markdown 双向同步的落点预设）——**[v3] 已下架**；
//!   - v3：只升了版本号并定下 `permissions` / `engines` / `author` / `homepage` /
//!     `dependencies` 几个字段的**形状**，运行时一个都不实现（不解析、不校验）。
//!     加新贡献点必须同时升 `apiVersion`，并在 `docs/plugin-spec.md` 补一节。
//!
//! 解析策略：**宁缺毋滥**。字段不认识就忽略（向前兼容），但 `entry` / `apiVersion`
//! 不认识就拒载并留下原因——猜语义比不加载更危险。

use serde::{Deserialize, Serialize};

/// 宿主支持的最高 apiVersion。插件写更高版本 → 拒载（不猜语义）。
///
/// v2 新增 `contributes.mdSync`；v3 下架 `mdSync`（已归内核），并把
/// `permissions` / `engines` / `author` / `homepage` / `dependencies` 写进规格。
/// 只声明 `quickTimers` 的 v1 插件继续有效。
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
    /// **[v3] Markdown 同步已归内核**（默认落点在 `models/md_sync_config.rs`）。
    ///
    /// 字段名刻意保留（`rename_all` 会渲染成 `mdSync`），类型选 `serde_json::Value`：
    /// 要能「看见它存在」并据此给一条黄字警告，但**不解析内容**——
    /// 解析等于还在支持它，下一个版本又会有人把落点写回来。
    pub md_sync: Option<serde_json::Value>,
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
    /* ---- [v3] 以下五个字段**本轮只定义形状**：不解析、不校验、不展示（docs/plugin-spec.md §10.1）。
    用 `serde_json::Value` 而不是具体结构，是为了「不解析」这件事在类型上就成立 ——
    写成 `BTreeMap<String, String>` 之类的具体类型，下一次就会有人顺手拿它做判断。 ---- */
    /// [v3] 声明性能力清单（写给人看，不是限制）。
    #[serde(default)]
    pub permissions: Vec<String>,
    /// [v3] 兼容声明，形如 `{ "timing": "^0.11" }`。缺省 = `{}`（不是 `null`）。
    #[serde(default = "default_object")]
    pub engines: serde_json::Value,
    /// [v3] 展示用作者名。
    #[serde(default)]
    pub author: String,
    /// [v3] 展示用主页（http(s)）。
    #[serde(default)]
    pub homepage: String,
    /// [v3] 依赖声明，形如 `{ "<plugin-id>": "^1.0" }`。缺省 = `{}`（不是 `null`）。
    #[serde(default = "default_object")]
    pub dependencies: serde_json::Value,
}

fn default_enabled() -> bool {
    true
}

/// [v3] `engines` / `dependencies` 的缺省值：空对象 `{}`。
///
/// 不能用 `#[serde(default)]`（那是 `Value::Null`）：`docs/plugin-spec.md` §10.2 写的默认值
/// 是 `{}`，且 v0.11.6 做硬校验时 `{}` 是「没声明」的自然形态，`null` 还得单独分支。
/// 取值口径与「不解析」并不矛盾：这里只定形状，不读里面的键。
pub(crate) fn default_object() -> serde_json::Value {
    serde_json::json!({})
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
    /// 用户目录：`%APPDATA%/com.timing.app/plugins`（可写）。
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
    /// [v3] 非致命提示（黄字，**插件仍生效**）。
    ///
    /// 与 `error` 是两个视觉层级：`error` = 该插件没生效，`warnings` = 生效但有东西
    /// 被忽略了（例如 v3 清单里还写着 `contributes.mdSync`）。
    pub warnings: Vec<String>,
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
