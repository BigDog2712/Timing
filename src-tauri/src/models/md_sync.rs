//! Markdown 同步域模型（V0.4.0 起；V0.11.5 从插件贡献点改为**内核功能**）。
//!
//! 这一层只定义**数据形状与静态校验**，不碰文件、不碰数据库：
//! - `MdSyncBinding` = 一个数据种类的落点（根目录 + 相对文件模板 + 标题行）；
//! - `MdSyncConfig` = 内核默认值 + 用户在「设置 → 同步」里覆盖后的最终配置；
//! - `MdSyncView` = 设置页一次拿全的视图（配置、运行状态、今日日期）；
//! - `MdSyncReport` = 一次同步的结果（给命令返回与事件载荷共用）。
//!
//! 字段与 `src/types/domain/mdSync.ts` 逐字对应（`rename_all = "camelCase"`）。

use std::path::{Component, Path};

use serde::{Deserialize, Serialize};

/// 单个插件最多声明多少个落点（防止误写一长串）。
pub const MD_SYNC_MAX_BINDINGS: usize = 8;
/// 相对文件模板长度上限。
pub const MD_SYNC_FILE_MAX_LEN: usize = 260;
/// 标题行长度上限。
pub const MD_SYNC_HEADING_MAX_LEN: usize = 120;
/// 根目录长度上限。
pub const MD_SYNC_ROOT_MAX_LEN: usize = 512;

/// 同步的数据种类。
///
/// ## 为什么加 `todos` 不升 `apiVersion`
///
/// `apiVersion` 描述的是**宿主支持哪些贡献点**（v1 `quickTimers` / v2 `mdSync`），
/// 而 kind 是 `mdSync` 贡献点内部的枚举，属于该贡献点的横向扩展：
/// 不声明 `todos` 的插件完全不受影响，`bindings` 的 schema 也没变。
///
/// 反过来的兼容性同样是「明确失败」：不认识 `todos` 的老宿主会在反序列化这个枚举时
/// 报错、拒载插件并给出原因，而不是静默忽略一个落点——这正是 `models::plugin`
/// 声明的「宁缺毋滥」。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MdSyncKind {
    /// `time_records` → 事项计时（Planner 格式的清单 + YAML log），按 `started_at` 归日。
    #[default]
    Timers,
    /// `notes` → 便利贴（表格，带隐藏的行 id），按「当天动过」归日。
    Notes,
    /// `todos` → 待办事项（清单 + 隐藏的行 id），未完成且计划时间不在当天。
    Todos,
}

impl MdSyncKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Timers => "timers",
            Self::Notes => "notes",
            Self::Todos => "todos",
        }
    }

    /// 设置页标题（也用于状态文案）。
    pub const fn label(self) -> &'static str {
        match self {
            Self::Timers => "事项计时",
            Self::Notes => "便利贴",
            Self::Todos => "待办事项",
        }
    }
}

/// 一个落点：把某类数据写进 `root/file` 的 `heading` 标题下。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MdSyncBinding {
    pub kind: MdSyncKind,
    /// 是否参与同步。false = 留在配置里但不写文件、也不读文件。
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// 落点根目录（绝对路径；支持 `%USERPROFILE%` / `~`）。空 = 还没配置。
    #[serde(default)]
    pub root: String,
    /// 相对文件模板，支持 `{date}` / `{yyyy}` / `{MM}` / `{dd}`。空 = 还没配置。
    #[serde(default)]
    pub file: String,
    /// 目标标题行（含 `#` 前缀，如 `#### 事项计时`）。
    #[serde(default)]
    pub heading: String,
}

impl MdSyncBinding {
    pub fn is_configured(&self) -> bool {
        !self.root.trim().is_empty()
            && !self.file.trim().is_empty()
            && !self.heading.trim().is_empty()
    }

    /// 配置里的稳定身份（同一文件可以有两个不同标题的落点）。
    pub fn key(&self) -> String {
        format!(
            "{}|{}|{}|{}",
            self.kind.as_str(),
            self.root.trim(),
            self.file.trim(),
            self.heading.trim()
        )
    }

    /// 静态校验：只拦「写下去一定会出错」的形状，不猜用户意图。
    pub fn validate(&self) -> Result<(), String> {
        let root = self.root.trim();
        if root.chars().count() > MD_SYNC_ROOT_MAX_LEN {
            return Err(format!("根目录超过 {MD_SYNC_ROOT_MAX_LEN} 个字符"));
        }
        if root.contains(['\n', '\r']) {
            return Err("根目录不能换行".into());
        }

        let file = self.file.trim();
        if file.is_empty() {
            return Err("文件模板不能为空".into());
        }
        if file.chars().count() > MD_SYNC_FILE_MAX_LEN {
            return Err(format!("文件模板超过 {MD_SYNC_FILE_MAX_LEN} 个字符"));
        }
        if file.contains(['\n', '\r']) {
            return Err("文件模板不能换行".into());
        }
        let path = Path::new(file);
        if path.is_absolute()
            || file.starts_with('/')
            || file.starts_with('\\')
            || file.chars().nth(1) == Some(':')
        {
            return Err("文件模板必须是相对路径（不要带盘符）".into());
        }
        if path.components().any(|c| {
            matches!(
                c,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            return Err("文件模板不能包含 .. 或盘符".into());
        }

        let heading = self.heading.trim();
        if heading.is_empty() {
            return Err("标题不能为空".into());
        }
        if heading.chars().count() > MD_SYNC_HEADING_MAX_LEN {
            return Err(format!("标题超过 {MD_SYNC_HEADING_MAX_LEN} 个字符"));
        }
        if heading.contains(['\n', '\r']) {
            return Err("标题不能换行".into());
        }
        let hashes = heading.chars().take_while(|ch| *ch == '#').count();
        let title = heading.get(hashes..).unwrap_or("").trim();
        if !(1..=6).contains(&hashes) || title.is_empty() {
            return Err("标题必须是「# 标题文字」的形式（如 #### 事项计时）".into());
        }
        Ok(())
    }
}

/// 同步配置结构在 `md_sync_config.rs`（V0.11.3 拆出，守住单文件 300 行）。
pub use crate::models::md_sync_config::MdSyncConfig;

/// 单个落点的运行状态（设置页原样展示，不臆造「成功」）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdSyncBindingStatus {
    pub kind: MdSyncKind,
    /// 解析后的绝对路径（`{date}` 已换成今天）。未配置时为 `""`。
    pub path: String,
    pub exists: bool,
    pub last_error: Option<String>,
    pub last_sync_at: Option<i64>,
    /// `"export"`（SQL → MD）/ `"import"`（MD → SQL）/ `"none"`。
    pub last_direction: Option<String>,
}

impl MdSyncBindingStatus {
    pub fn empty(kind: MdSyncKind) -> Self {
        Self {
            kind,
            path: String::new(),
            exists: false,
            last_error: None,
            last_sync_at: None,
            last_direction: None,
        }
    }
}

/// 全局运行状态。内存态：进程重启后由第一次同步重新填。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdSyncStatus {
    pub last_sync_at: Option<i64>,
    pub last_error: Option<String>,
    pub bindings: Vec<MdSyncBindingStatus>,
}

/// `md_sync_get` / `md_sync_save` 的返回：设置页一次拿全。
///
/// [V0.11.5] 去掉 `installed` / `plugin_id` / `plugin_name` / `plugin_version`：
/// 同步已是内核功能，没有「插件装没装」这回事了。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdSyncView {
    /// 今天（本地时区，`YYYY-MM-DD`），前端用它做路径预览。
    pub today: String,
    pub config: MdSyncConfig,
    pub status: MdSyncStatus,
}

/// 一次同步的结果。命令返回它，`md-sync:changed` 事件也用它做载荷。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdSyncReport {
    pub at: i64,
    /// 写文件的落点数（不是行数）。
    pub exported: u32,
    /// 从 MD 改到 SQL 的记录 / 便利贴条数。
    pub imported: u32,
    /// 有变化的种类（事件消费者据此决定刷新哪些 store）。
    pub kinds: Vec<MdSyncKind>,
    pub errors: Vec<String>,
}

impl MdSyncReport {
    pub fn new(at: i64) -> Self {
        Self {
            at,
            ..Default::default()
        }
    }

    pub fn touched(&self) -> bool {
        self.imported > 0
    }

    pub fn note_imported(&mut self, kind: MdSyncKind, count: u32) {
        if count == 0 {
            return;
        }
        self.imported += count;
        if !self.kinds.contains(&kind) {
            self.kinds.push(kind);
        }
    }
}

fn default_true() -> bool {
    true
}

#[cfg(test)]
#[path = "md_sync_test.rs"]
mod tests;
